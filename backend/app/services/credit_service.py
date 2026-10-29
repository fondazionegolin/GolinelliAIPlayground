import asyncio
import calendar
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, List
from sqlalchemy import select, or_, and_
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID

from app.models.credits import CreditLimit, CreditTransaction, CreditAlert
from app.models.tenant import Tenant
from app.models.enums import CreditTransactionType, LimitLevel, TenantType
from app.core.pricing import calculate_cost


logger = logging.getLogger(__name__)

# 1 credito = 0,01 unità interna (l'unità interna è l'importo di spesa originario).
# Il pannello e le API utente parlano solo in crediti.
CREDITS_PER_UNIT = 100
LOW_BALANCE_RATIO = 0.2  # sotto il 20% residuo scatta l'avviso "crediti in esaurimento"


def to_credits(value: float | None) -> float:
    return round(float(value or 0.0) * CREDITS_PER_UNIT, 2)


def from_credits(value: float | None) -> float:
    return float(value or 0.0) / CREDITS_PER_UNIT


def effective_cap(limit: CreditLimit) -> float:
    """Cap mensile + bundle. 0 (cap ordinario) = nessun limite."""
    return float(limit.amount_cap or 0.0) + max(float(limit.bonus_credits or 0.0), 0.0)


def add_month(moment: datetime) -> datetime:
    """Stesso giorno del mese successivo (clamp a fine mese: 31 gen -> 28 feb)."""
    year, month = (moment.year + 1, 1) if moment.month == 12 else (moment.year, moment.month + 1)
    return moment.replace(year=year, month=month, day=min(moment.day, calendar.monthrange(year, month)[1]))


def reset_if_due(limit: CreditLimit, now: datetime) -> bool:
    """Reset mensile pigro, con decorrenza dalla data di attivazione (non dal 1° del mese):
    il ciclo successivo parte dalla scadenza precedente, quindi il giorno resta lo stesso.
    I bundle non scadono: si consuma prima il cap ordinario, solo l'eccedenza intacca il bundle,
    il residuo viene riportato."""
    if limit.reset_frequency == "MONTHLY" and limit.period_end and now > limit.period_end:
        overflow = max(float(limit.current_usage or 0.0) - float(limit.amount_cap or 0.0), 0.0)
        limit.bonus_credits = max(float(limit.bonus_credits or 0.0) - overflow, 0.0)
        limit.current_usage = 0.0
        start = limit.period_end
        end = add_month(start)
        while end <= now:  # servizio fermo per più mesi: salta ai cicli scaduti
            start, end = end, add_month(end)
        limit.period_start = start
        limit.period_end = end
        limit.last_updated = now
        return True
    return False


class CreditService:
    @staticmethod
    def classify_service(provider: Optional[str], model: Optional[str], usage_details: Optional[dict]) -> str:
        """Return a stable, human-readable product area for current and historical transactions."""
        details = usage_details or {}
        explicit = str(details.get("service") or "").strip()
        if explicit:
            return explicit
        kind = str(details.get("type") or details.get("context") or "").lower()
        haystack = " ".join((kind, str(provider or "").lower(), str(model or "").lower()))
        if any(value in haystack for value in ("meshy", "solid_modeler", "text_to_3d", "image_to_3d", "3d_lab")):
            return "3D Lab"
        if any(value in haystack for value in ("coding", "vibe", "pxt", "code_agent")):
            return "Vibe Lab"
        if "notebook" in haystack:
            return "Notebook"
        if any(value in haystack for value in ("teacherbot", "studentbot", "escape_room")):
            return "Teacherbot"
        if any(value in haystack for value in ("classification", "ml_lab", "dataset")):
            return "ML Lab"
        if any(value in haystack for value in ("agentic", "workflow", "dataflow")):
            return "Agentic"
        if any(value in haystack for value in ("document", "presentation", "lesson", "uda")):
            return "Documenti"
        if any(value in haystack for value in ("chat", "message", "conversation", "vision", "txt2img", "img2img", "direct_generation")):
            return "Chatbot"
        return "Servizi AI"

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
            period_end=add_month(now),
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
            .order_by(CreditLimit.last_updated.desc(), CreditLimit.id.desc())
            .limit(1)
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
        teacher_id=None,
    ) -> CreditLimit:
        """Crea il STUDENT_POOL mensile.

        Nei tenant individuali/legacy il pool è per-docente: i suoi studenti
        consumano qui, separati dal cap personale del docente.
        """
        stmt = select(CreditLimit).where(
            CreditLimit.tenant_id == tenant_id,
            CreditLimit.level == LimitLevel.STUDENT_POOL,
        )
        if teacher_id:
            stmt = stmt.where(CreditLimit.teacher_id == teacher_id)
        else:
            stmt = stmt.where(CreditLimit.teacher_id.is_(None))
        existing = (await db.execute(
            stmt.order_by(CreditLimit.last_updated.desc(), CreditLimit.id.desc()).limit(1)
        )).scalar_one_or_none()
        if existing:
            return existing
        limit = self._make_monthly_limit(tenant_id, LimitLevel.STUDENT_POOL, amount_cap, teacher_id=teacher_id)
        db.add(limit)
        return limit

    async def ensure_default_teacher_credit_setup(
        self,
        db: AsyncSession,
        tenant_id,
        teacher_id,
    ) -> tuple[CreditLimit, CreditLimit]:
        tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one_or_none()
        teacher_cap = float(getattr(tenant, "teacher_monthly_cap", 3.0) or 3.0)
        pool_cap = float(getattr(tenant, "monthly_credit_pool", 10.0) or 10.0)
        teacher_limit = await self.ensure_teacher_limit(db, tenant_id, teacher_id, teacher_cap)
        pool_limit = await self.ensure_student_pool_limit(db, tenant_id, pool_cap, teacher_id=teacher_id)
        await db.flush()
        return teacher_limit, pool_limit

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
        tenant = None
        if teacher_id:
            await self.ensure_default_teacher_credit_setup(db, tenant_id, teacher_id)
        tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one_or_none()
        is_school_tenant = getattr(tenant, "tenant_type", None) == TenantType.SCHOOL

        conditions = [CreditLimit.level == LimitLevel.GLOBAL] if is_school_tenant else []

        if teacher_id and not student_id:
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
            if teacher_id and not is_school_tenant:
                conditions.append(and_(
                    CreditLimit.level == LimitLevel.STUDENT_POOL,
                    CreditLimit.teacher_id == teacher_id,
                ))
            elif not is_school_tenant:
                conditions.append(and_(
                    CreditLimit.level == LimitLevel.STUDENT_POOL,
                    CreditLimit.teacher_id.is_(None),
                ))

        if not conditions:
            return []
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

            if reset_if_due(limit, now):
                db.add(limit)
                await self.sync_alert(db, limit)

            if limit.current_usage + estimated_cost > effective_cap(limit):
                # Blocca e avvisa l'admin: il docente/scuola deve poter chiedere un bundle.
                await self.sync_alert(db, limit, force_exhausted=True)
                await db.commit()
                return False

        return True

    async def get_balance(
        self,
        db: AsyncSession,
        tenant_id: UUID,
        teacher_id: Optional[UUID] = None,
        class_id: Optional[UUID] = None,
        session_id: Optional[UUID] = None,
        student_id: Optional[UUID] = None,
    ) -> dict:
        limits = await self.get_applicable_limits(
            db, tenant_id, teacher_id, class_id, session_id, student_id
        )
        now = datetime.now(timezone.utc)
        constrained_limits: list[CreditLimit] = []

        for limit in limits:
            if reset_if_due(limit, now):
                db.add(limit)
                await self.sync_alert(db, limit)

            if limit.amount_cap > 0:
                constrained_limits.append(limit)

        if not constrained_limits:
            await db.commit()
            return {
                "credits_remaining": None,
                "credits_used": 0,
                "credits_cap": None,
                "limit_level": None,
                "period_end": None,
                "low_balance": False,
                "exhausted": False,
            }

        limiting = min(
            constrained_limits,
            key=lambda item: max(effective_cap(item) - float(item.current_usage or 0.0), 0.0),
        )
        await db.flush()
        await db.commit()
        return self.limit_balance_payload(limiting)

    @staticmethod
    def limit_balance_payload(limit: CreditLimit) -> dict:
        cap = max(effective_cap(limit), 0.0)
        used = max(float(limit.current_usage or 0.0), 0.0)
        remaining = max(cap - used, 0.0)
        return {
            "credits_remaining": int(round(to_credits(remaining))),
            "credits_used": int(round(to_credits(used))),
            "credits_cap": int(round(to_credits(cap))),
            "limit_level": limit.level.value if hasattr(limit.level, "value") else str(limit.level),
            "limit_id": str(limit.id) if limit.id else None,
            "period_end": limit.period_end,
            "bonus_credits": int(round(to_credits(limit.bonus_credits))),
            "low_balance": cap > 0 and remaining / cap <= LOW_BALANCE_RATIO,
            "exhausted": cap > 0 and remaining <= 0,
        }

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
        usage_details = dict(usage_details or {})
        usage_details.setdefault("service", self.classify_service(provider, model, usage_details))

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
            reset_if_due(limit, now)
            limit.current_usage += cost
            limit.last_updated = now
            db.add(limit)
            await self.sync_alert(db, limit)

        await db.commit()
        await db.refresh(tx)
        return tx

    # ── Alerts ──────────────────────────────────────────────────────────────

    async def sync_alert(self, db: AsyncSession, limit: CreditLimit, *, force_exhausted: bool = False) -> None:
        """Apre/aggiorna/chiude l'avviso del limite in base al residuo corrente."""
        if limit.id is None:
            return
        cap = effective_cap(limit) if float(limit.amount_cap or 0.0) > 0 else 0.0
        remaining = cap - float(limit.current_usage or 0.0)
        desired: Optional[str] = None
        if cap > 0:
            if force_exhausted or remaining <= 0:
                desired = "EXHAUSTED"
            elif remaining / cap <= LOW_BALANCE_RATIO:
                desired = "LOW"

        open_alerts = (await db.execute(
            select(CreditAlert).where(CreditAlert.limit_id == limit.id, CreditAlert.status == "OPEN")
        )).scalars().all()
        now = datetime.now(timezone.utc)
        already = False
        for alert in open_alerts:
            if desired and alert.severity == desired:
                already = True
                continue
            alert.status = "RESOLVED"
            alert.resolved_at = now
            db.add(alert)
        if not desired or already:
            return

        level = limit.level.value if hasattr(limit.level, "value") else str(limit.level)
        alert = CreditAlert(
            tenant_id=limit.tenant_id,
            limit_id=limit.id,
            severity=desired,
            status="OPEN",
            cap_snapshot=cap,
            usage_snapshot=float(limit.current_usage or 0.0),
            message=(
                f"Crediti esauriti ({level})" if desired == "EXHAUSTED"
                else f"Crediti in esaurimento ({level}): restano {max(round(to_credits(remaining)), 0)} su {round(to_credits(cap))}"
            ),
        )
        db.add(alert)
        await db.flush()
        try:
            asyncio.get_running_loop().create_task(self._email_admins(alert.id))
        except RuntimeError:
            pass

    async def _email_admins(self, alert_id) -> None:
        """Mail best-effort agli admin; il campo email_sent evita doppi invii."""
        try:
            from app.core.database import AsyncSessionLocal
            from app.models.user import User
            from app.models.enums import UserRole
            from app.services.email_service import email_service

            await asyncio.sleep(1.0)  # lascia committare la transazione chiamante
            async with AsyncSessionLocal() as db:
                alert = (await db.execute(select(CreditAlert).where(CreditAlert.id == alert_id))).scalar_one_or_none()
                if not alert or alert.email_sent or alert.status != "OPEN":
                    return
                limit = (await db.execute(select(CreditLimit).where(CreditLimit.id == alert.limit_id))).scalar_one_or_none()
                if not limit:
                    return
                label = await self.describe_limit(db, limit)
                admins = (await db.execute(
                    select(User).where(User.role == UserRole.ADMIN, User.is_active == True)  # noqa: E712
                )).scalars().all()
                subject = (
                    f"[Golinelli.ai] Crediti esauriti: {label['title']}"
                    if alert.severity == "EXHAUSTED"
                    else f"[Golinelli.ai] Crediti in esaurimento: {label['title']}"
                )
                body = (
                    f"<p>{alert.message}</p><p><b>{label['title']}</b>"
                    f"{' — ' + label['subtitle'] if label['subtitle'] else ''}</p>"
                    "<p>Apri Admin → Crediti per autorizzare o forzare un nuovo bundle.</p>"
                )
                sent_any = False
                for admin in admins:
                    if admin.email and await email_service.send_email(admin.email, subject, body, alert.message):
                        sent_any = True
                alert.email_sent = sent_any
                db.add(alert)
                await db.commit()
        except Exception as exc:  # mai far fallire una chiamata AI per una mail
            logger.warning("credit alert email failed: %s", exc)

    async def describe_limit(self, db: AsyncSession, limit: CreditLimit) -> dict:
        """Etichette leggibili (scuola / docente / classe) di un limite."""
        from app.models.user import User
        from app.models.session import Class as TeacherClass

        level = limit.level.value if hasattr(limit.level, "value") else str(limit.level)
        tenant = (await db.execute(select(Tenant).where(Tenant.id == limit.tenant_id))).scalar_one_or_none() if limit.tenant_id else None
        teacher = (await db.execute(select(User).where(User.id == limit.teacher_id))).scalar_one_or_none() if limit.teacher_id else None
        teacher_name = (f"{teacher.first_name or ''} {teacher.last_name or ''}".strip() or teacher.email) if teacher else None
        tenant_name = tenant.name if tenant else None
        if level == "CLASS" and limit.class_id:
            cls = (await db.execute(select(TeacherClass).where(TeacherClass.id == limit.class_id))).scalar_one_or_none()
            return {"title": f"Classe {cls.name if cls else '—'}", "subtitle": " · ".join(filter(None, [teacher_name, tenant_name]))}
        if level == "TEACHER":
            return {"title": f"Docente {teacher_name or '—'}", "subtitle": tenant_name or ""}
        if level == "STUDENT_POOL":
            return {"title": f"Pool studenti{' di ' + teacher_name if teacher_name else ''}", "subtitle": tenant_name or ""}
        if level == "GLOBAL":
            return {"title": f"Pool istituto {tenant_name or '—'}", "subtitle": ""}
        return {"title": level, "subtitle": tenant_name or ""}

    # ── Admin: set / bundle ─────────────────────────────────────────────────

    async def restart_cycle(
        self,
        db: AsyncSession,
        limit: CreditLimit,
        *,
        admin_id=None,
        new_cap: Optional[float] = None,
        clear_bonus: bool = False,
        note: Optional[str] = None,
    ) -> CreditLimit:
        """Azzera i consumi e fa ripartire il ciclo mensile da oggi (la data diventa la nuova decorrenza)."""
        now = datetime.now(timezone.utc)
        used_before = float(limit.current_usage or 0.0)
        if new_cap is not None:
            limit.amount_cap = new_cap
        if clear_bonus:
            limit.bonus_credits = 0.0
        limit.current_usage = 0.0
        limit.period_start = now
        limit.period_end = add_month(now)
        limit.reset_frequency = "MONTHLY"
        limit.last_updated = now
        db.add(limit)
        db.add(CreditTransaction(
            tenant_id=limit.tenant_id,
            transaction_type=CreditTransactionType.ALLOCATION,
            cost=0.0,
            teacher_id=limit.teacher_id,
            class_id=limit.class_id,
            usage_details={
                "service": "Reset crediti",
                "credits_cleared": to_credits(used_before),
                "limit_id": str(limit.id),
                "limit_level": limit.level.value if hasattr(limit.level, "value") else str(limit.level),
                "admin_id": str(admin_id) if admin_id else None,
                "new_cap_credits": to_credits(new_cap) if new_cap is not None else None,
                "bonus_cleared": clear_bonus,
                "note": note,
            },
        ))
        await db.flush()
        await self.sync_alert(db, limit)
        return limit

    async def add_bundle(
        self,
        db: AsyncSession,
        limit: CreditLimit,
        credits: float,
        *,
        admin_id=None,
        note: Optional[str] = None,
        request_id=None,
    ) -> CreditLimit:
        """Aggiunge un bundle (in crediti) al limite, valido subito anche a metà mese."""
        if credits <= 0:
            raise ValueError("Il bundle deve essere positivo")
        limit.bonus_credits = float(limit.bonus_credits or 0.0) + from_credits(credits)
        limit.last_updated = datetime.now(timezone.utc)
        db.add(limit)
        db.add(CreditTransaction(
            tenant_id=limit.tenant_id,
            transaction_type=CreditTransactionType.ALLOCATION,
            cost=0.0,
            teacher_id=limit.teacher_id,
            class_id=limit.class_id,
            usage_details={
                "service": "Bundle crediti",
                "credits_added": credits,
                "limit_id": str(limit.id),
                "limit_level": limit.level.value if hasattr(limit.level, "value") else str(limit.level),
                "admin_id": str(admin_id) if admin_id else None,
                "request_id": str(request_id) if request_id else None,
                "note": note,
            },
        ))
        await db.flush()
        await self.sync_alert(db, limit)
        return limit

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
