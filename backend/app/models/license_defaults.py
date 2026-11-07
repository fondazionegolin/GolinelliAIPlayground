"""New teachers and school tenants start with a standard 12-month auto-renewing licence."""
from sqlalchemy import event

from app.models.enums import TenantType, UserRole
from app.models.tenant import Tenant
from app.models.user import User


@event.listens_for(User, "before_insert")
def _teacher_default(mapper, connection, target):
    if target.role == UserRole.TEACHER and target.license_expires_at is None and target.license_started_at is None:
        from app.services import license
        license.start_default(target)


@event.listens_for(Tenant, "before_insert")
def _school_default(mapper, connection, target):
    if target.tenant_type == TenantType.SCHOOL and target.license_expires_at is None and target.license_started_at is None:
        from app.services import license
        license.start_default(target)
