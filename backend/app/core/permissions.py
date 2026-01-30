"""Permission helpers for checking teacher access to classes and sessions."""

from uuid import UUID
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.session import Class, Session
from app.models.invitation import ClassTeacher, SessionTeacher
from app.models.user import User


async def teacher_can_access_class(db: AsyncSession, teacher: User, class_id: UUID) -> bool:
    """
    Check if a teacher can access a class.
    Returns True if teacher is the owner OR is an invited member.
    """
    # Check if owner
    result = await db.execute(
        select(Class)
        .where(Class.id == class_id)
        .where(Class.tenant_id == teacher.tenant_id)
    )
    class_ = result.scalar_one_or_none()
    if not class_:
        return False

    # Owner has access
    if class_.teacher_id == teacher.id:
        return True

    # Check if invited member
    result = await db.execute(
        select(ClassTeacher)
        .where(ClassTeacher.class_id == class_id)
        .where(ClassTeacher.teacher_id == teacher.id)
    )
    return result.scalar_one_or_none() is not None


async def teacher_can_access_session(db: AsyncSession, teacher: User, session_id: UUID) -> bool:
    """
    Check if a teacher can access a session.
    Returns True if teacher has access via class OR direct session invite.
    """
    # Get session with class
    result = await db.execute(
        select(Session, Class)
        .join(Class)
        .where(Session.id == session_id)
        .where(Session.tenant_id == teacher.tenant_id)
    )
    row = result.first()
    if not row:
        return False

    session, class_ = row

    # Owner of the class has access
    if class_.teacher_id == teacher.id:
        return True

    # Check if invited to the class
    result = await db.execute(
        select(ClassTeacher)
        .where(ClassTeacher.class_id == class_.id)
        .where(ClassTeacher.teacher_id == teacher.id)
    )
    if result.scalar_one_or_none():
        return True

    # Check if directly invited to the session
    result = await db.execute(
        select(SessionTeacher)
        .where(SessionTeacher.session_id == session_id)
        .where(SessionTeacher.teacher_id == teacher.id)
    )
    return result.scalar_one_or_none() is not None


async def teacher_is_class_owner(db: AsyncSession, teacher: User, class_id: UUID) -> bool:
    """
    Check if a teacher is the owner of a class (not just a member).
    """
    result = await db.execute(
        select(Class)
        .where(Class.id == class_id)
        .where(Class.teacher_id == teacher.id)
        .where(Class.tenant_id == teacher.tenant_id)
    )
    return result.scalar_one_or_none() is not None


async def teacher_is_session_owner(db: AsyncSession, teacher: User, session_id: UUID) -> bool:
    """
    Check if a teacher is the owner of the session's class.
    """
    result = await db.execute(
        select(Session)
        .join(Class)
        .where(Session.id == session_id)
        .where(Class.teacher_id == teacher.id)
        .where(Session.tenant_id == teacher.tenant_id)
    )
    return result.scalar_one_or_none() is not None


async def get_class_with_access_check(db: AsyncSession, teacher: User, class_id: UUID) -> Class | None:
    """
    Get a class if the teacher has access to it.
    Returns the Class object or None.
    """
    result = await db.execute(
        select(Class)
        .where(Class.id == class_id)
        .where(Class.tenant_id == teacher.tenant_id)
    )
    class_ = result.scalar_one_or_none()
    if not class_:
        return None

    # Owner has access
    if class_.teacher_id == teacher.id:
        return class_

    # Check if invited member
    result = await db.execute(
        select(ClassTeacher)
        .where(ClassTeacher.class_id == class_id)
        .where(ClassTeacher.teacher_id == teacher.id)
    )
    if result.scalar_one_or_none():
        return class_

    return None


async def get_session_with_access_check(db: AsyncSession, teacher: User, session_id: UUID) -> tuple[Session, Class] | None:
    """
    Get a session (with its class) if the teacher has access to it.
    Returns tuple of (Session, Class) or None.
    """
    result = await db.execute(
        select(Session, Class)
        .join(Class)
        .where(Session.id == session_id)
        .where(Session.tenant_id == teacher.tenant_id)
    )
    row = result.first()
    if not row:
        return None

    session, class_ = row

    # Owner of the class has access
    if class_.teacher_id == teacher.id:
        return session, class_

    # Check if invited to the class
    result = await db.execute(
        select(ClassTeacher)
        .where(ClassTeacher.class_id == class_.id)
        .where(ClassTeacher.teacher_id == teacher.id)
    )
    if result.scalar_one_or_none():
        return session, class_

    # Check if directly invited to the session
    result = await db.execute(
        select(SessionTeacher)
        .where(SessionTeacher.session_id == session_id)
        .where(SessionTeacher.teacher_id == teacher.id)
    )
    if result.scalar_one_or_none():
        return session, class_

    return None
