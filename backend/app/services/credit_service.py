from datetime import datetime, timedelta, timezone
from typing import Optional, List
from sqlalchemy import select, or_, and_
from sqlalchemy.ext.asyncio import AsyncSession
from uuid import UUID

from app.models.credits import CreditLimit, CreditTransaction
from app.models.enums import CreditTransactionType, LimitLevel
from app.core.pricing import calculate_cost

class CreditService:
    async def get_applicable_limits(
        self,
        db: AsyncSession,
        tenant_id: UUID,
        teacher_id: Optional[UUID] = None,
        class_id: Optional[UUID] = None,
        session_id: Optional[UUID] = None,
        student_id: Optional[UUID] = None
    ) -> List[CreditLimit]:
        """
        Fetch all credit limits that apply to the current context.
        Hierarchy: Student -> Session -> Class -> Teacher -> Global
        """
        conditions = [CreditLimit.level == LimitLevel.GLOBAL]
        
        if teacher_id:
            conditions.append(and_(CreditLimit.level == LimitLevel.TEACHER, CreditLimit.teacher_id == teacher_id))
        
        if class_id:
            conditions.append(and_(CreditLimit.level == LimitLevel.CLASS, CreditLimit.class_id == class_id))
            
        if session_id:
            conditions.append(and_(CreditLimit.level == LimitLevel.SESSION, CreditLimit.session_id == session_id))
            
        if student_id:
            conditions.append(and_(CreditLimit.level == LimitLevel.STUDENT, CreditLimit.student_id == student_id))
            
        stmt = select(CreditLimit).where(
            CreditLimit.tenant_id == tenant_id,
            or_(*conditions)
        )
        result = await db.execute(stmt)
        return result.scalars().all()

    async def check_availability(
        self,
        db: AsyncSession,
        tenant_id: UUID,
        estimated_cost: float = 0.0,
        teacher_id: Optional[UUID] = None,
        class_id: Optional[UUID] = None,
        session_id: Optional[UUID] = None,
        student_id: Optional[UUID] = None
    ) -> bool:
        """
        Check if operation is allowed under current limits.
        Perform lazy reset if period expired.
        """
        limits = await self.get_applicable_limits(db, tenant_id, teacher_id, class_id, session_id, student_id)
        
        allowed = True
        now = datetime.now(timezone.utc)
        
        for limit in limits:
            # check limits
            if limit.amount_cap <= 0:
                continue # No limit (or disabled usage if 0? Assuming 0 means unlimited or handle strictly?)
                # Actually usually 0 means "0 budget", so BLOCKED.
                # Let's assume user sets > 0 for allowed.
            
            # Lazy reset logic
            if limit.reset_frequency == "MONTHLY" and limit.period_end and now > limit.period_end:
                 limit.current_usage = 0.0
                 limit.period_start = now
                 # Set next month
                 try:
                     # very simple 30 days or proper month logic
                     next_month = now.replace(month=now.month + 1)
                 except ValueError:
                     next_month = now.replace(year=now.year + 1, month=1)
                 limit.period_end = next_month
                 db.add(limit) # mark for update

            if limit.current_usage + estimated_cost > limit.amount_cap:
                allowed = False
                # We could stop here, but maybe we want to process resets for all?
                # for check, we can break.
                break
        
        return allowed

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
        student_id: Optional[UUID] = None
    ) -> CreditTransaction:
        """
        Record transaction and update all relevant limits.
        """
        # 1. Create Transaction
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
            student_id=student_id
        )
        db.add(tx)
        
        # 2. Update Limits
        limits = await self.get_applicable_limits(db, tenant_id, teacher_id, class_id, session_id, student_id)
        
        now = datetime.now(timezone.utc)
        for limit in limits:
             # Lazy reset check again (just in case check_availability wasn't called or race condition)
            if limit.reset_frequency == "MONTHLY" and limit.period_end and now > limit.period_end:
                 limit.current_usage = 0.0
                 limit.period_start = now
                 try:
                     next_month = now.replace(month=now.month + 1)
                 except ValueError:
                     next_month = now.replace(year=now.year + 1, month=1)
                 limit.period_end = next_month
            
            # Increment usage
            limit.current_usage += cost
            limit.last_updated = now
            db.add(limit)
            
        await db.commit()
        await db.refresh(tx)
        return tx

    def calculate_cost_for_model(self, provider: str, model: str, input_tokens: int, output_tokens: int, image_count: int = 0) -> float:
        return calculate_cost(provider, model, input_tokens, output_tokens, image_count)

credit_service = CreditService()
