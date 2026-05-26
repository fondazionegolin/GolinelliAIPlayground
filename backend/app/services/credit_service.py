from datetime import datetime, timedelta, timezone
from typing import Optional, List
from sqlalchemy import select, or_, and_
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID

from app.models.credits import CreditLimit, CreditTransaction
from app.models.enums import CreditTransactionType, LimitLevel, TenantType
from app.core.pricing import calculate_cost


def _next_month_start(now: datetime) -> datetime:
    try:
        return now.replace(month=now.month + 1, day=1, hour=0, minute=0, second=0, microsecond=0)
    except ValueError:
        return now.replace(year=now.year + 1, month=1, day=1, hour=0, minute=0, second=0, microsecond=0)


class CreditService:

    # ── Limit creation helpers ──────────────────────────────────────────────

    def _make_monthly_limit(
        self,
        tenant_id,
        level: LimitLevel,
        amount_cap: float,
        *,
        teacher_id=None,
        class_id=None,
        session_id=None,
        student_id=None,
    ) -> CreditLimit:
        now = datetime.now(timezone.utc)
        return CreditLimit(
            tenant_id=tenant_id,
            level=level,
            teacher_id=teacher_id,
            class_id=class_id,
            session_id=session_id,
            student_id=student_id,
            amount_cap=amount_cap,
            current_usage=0.0,
            period_start=now,
            period_end=_next_month_start(now),
            reset_frequency="MONTHLY",
        )

    async def ensure_teacher_limit(
        self,
        db: AsyncSession,
        tenant_id,
        teacher_id,
        amount_cap: float = 3.0,
    ) -> CreditLimit:
        """Crea il limite mensile per un docente (INDIVIDUAL) se non esiste già."""
        existing = (await db.execute(
            select(CreditLimit).where(
                CreditLimit.tenant_id == tenant_id,
                CreditLimit.level == LimitLevel.TEACHER,
                CreditLimit.teacher_id == teacher_id,
            )
        )).scalar_one_or_none()
        if existing:
            return existing
        limit = self._make_monthly_limit(tenant_id, LimitLevel.TEACHER, amount_cap, teacher_id=teacher_id)
        db.add(limit)
        return limit

    async def ensure_student_pool_limit(
        self,
        db: AsyncSession,
        tenant_id,
        amount_cap: float = 10.0,
    ) -> CreditLimit:
        """Crea il STUDENT_POOL mensile per un tenant INDIVIDUAL se non esiste già."""
        existing = (await db.execute(
            select(CreditLimit).where(
                CreditLimit.tenant_id == tenant_id,
                CreditLimit.level == LimitLevel.STUDENT_POOL,
            )
        )).scalar_one_or_none()
        if existing:
            return existing
        limit = self._make_monthly_limit(tenant_id, LimitLevel.STUDENT_POOL, amount_cap)
        db.add(limit)
        return limit

    async def ensure_school_global_limit(
        self,
        db: AsyncSession,
        tenant_id,
        amount_cap: float = 10.0,
    ) -> CreditLimit:
        """Crea/aggiorna il GLOBAL mensile per un tenant SCHOOL."""
        existing = (await db.execute(
            select(CreditLimit).where(
                CreditLimit.tenant_id == tenant_id,
                CreditLimit.level == LimitLevel.GLOBAL,
            )
        )).scalar_one_or_none()
        if existing:
            return existing
        limit = self._make_monthly_limit(tenant_id, LimitLevel.GLOBAL, amount_cap)
        db.add(limit)
        return limit

    async def set_limit_cap(
        self,
        db: AsyncSession,
        tenant_id,
        level: LimitLevel,
        amount_cap: float,
        teacher_id=None,
    ) -> CreditLimit:
        """Aggiorna il cap di un limite esistente (usato dall'admin)."""
        stmt = select(CreditLimit).where(
            CreditLimit.tenant_id == tenant_id,
            CreditLimit.level == level,
        )
        if teacher_id:
            stmt = stmt.where(CreditLimit.teacher_id == teacher_id)
        limit = (await db.execute(stmt)).scalar_one_or_none()
        if limit:
            limit.amount_cap = amount_cap
            db.add(limit)
            return limit
        # Crea se non esiste
        limit = self._make_monthly_limit(
            tenant_id, level, amount_cap, teacher_id=teacher_id
        )
        db.add(limit)
        return limit

    # ── Core: get applicable limits ─────────────────────────────────────────

    async def get_applicable_limits(
        self,
        db: AsyncSession,
        tenant_id: UUID,
        teacher_id: Optional[UUID] = None,
        class_id: Optional[UUID] = None,
        session_id: Optional[UUID] = None,
        student_id: Optional[UUID] = None,
    ) -> List[CreditLimit]:
        """
        Restituisce tutti i limiti applicabili al contesto corrente.
        Gerarchia: Student / STUDENT_POOL -> Session -> Class -> Teacher -> Global

        STUDENT_POOL si applica SOLO quando student_id è presente
        (uso da parte di uno studente), non alle chiamate del docente.
        """
        conditions = [CreditLimit.level == LimitLevel.GLOBAL]

        if teacher_id:
            conditions.append(and_(
                CreditLimit.level == LimitLevel.TEACHER,
                CreditLimit.teacher_id == teacher_id,
            ))

        if class_id:
            conditions.append(and_(
                CreditLimit.level == LimitLevel.CLASS,
                CreditLimit.class_id == class_id,
            ))

        if session_id:
            conditions.append(and_(
                CreditLimit.level == LimitLevel.SESSION,
                CreditLimit.session_id == session_id,
            ))

        if student_id:
            conditions.append(and_(
                CreditLimit.level == LimitLevel.STUDENT,
                CreditLimit.student_id == student_id,
            ))
            # Aggiunge il pool condiviso studenti (per tenant INDIVIDUAL)
            conditions.append(CreditLimit.level == LimitLevel.STUDENT_POOL)

        stmt = select(CreditLimit).where(
            CreditLimit.tenant_id == tenant_id,
            or_(*conditions),
        )
        result = await db.execute(stmt)
        return list(result.scalars().all())

    # ── Check + track ───────────────────────────────────────────────────────

    async def check_availability(
        self,
        db: AsyncSession,
        tenant_id: UUID,
        estimated_cost: float = 0.0,
        teacher_id: Optional[UUID] = None,
        class_id: Optional[UUID] = None,
        session_id: Optional[UUID] = None,
        student_id: Optional[UUID] = None,
    ) -> bool:
        limits = await self.get_applicable_limits(
            db, tenant_id, teacher_id, class_id, session_id, student_id
        )
        now = datetime.now(timezone.utc)

        for limit in limits:
            if limit.amount_cap <= 0:
                continue  # 0 = nessun limite configurato → passa

            # Lazy reset
            if limit.reset_frequency == "MONTHLY" and limit.period_end and now > limit.period_end:
                limit.current_usage = 0.0
                limit.period_start = now
                limit.period_end = _next_month_start(now)
                db.add(limit)

            if limit.current_usage + estimated_cost > limit.amount_cap:
                return False

        return True

    async def track_usage(
        self,
        db: AsyncSession,
        tenant_id: UUID,
        provider: str,
        model: str,
        cost: float,
        usage_details: dict,
        teacher_id: Optional[UUID] = None,
        class_id: Optional[UUID] = None,
        session_id: Optional[UUID] = None,
        student_id: Optional[UUID] = None,
    ) -> CreditTransaction:
        tx = CreditTransaction(
            tenant_id=tenant_id,
            transaction_type=CreditTransactionType.API_CALL,
            cost=cost,
            provider=provider,
            model=model,
            usage_details=usage_details,
            teacher_id=teacher_id,
            class_id=class_id,
            session_id=session_id,
            student_id=student_id,
        )
        db.add(tx)

        limits = await self.get_applicable_limits(
            db, tenant_id, teacher_id, class_id, session_id, student_id
        )
        now = datetime.now(timezone.utc)
        for limit in limits:
            if limit.reset_frequency == "MONTHLY" and limit.period_end and now > limit.period_end:
                limit.current_usage = 0.0
                limit.period_start = now
                limit.period_end = _next_month_start(now)
            limit.current_usage += cost
            limit.last_updated = now
            db.add(limit)

        await db.commit()
        await db.refresh(tx)
        return tx

    def calculate_cost_for_model(
        self,
        provider: str,
        model: str,
        input_tokens: int,
        output_tokens: int,
        image_count: int = 0,
    ) -> float:
        return calculate_cost(provider, model, input_tokens, output_tokens, image_count)


credit_service = CreditService()
