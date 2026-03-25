"""
Root conftest.py — shared test fixtures for the GolinelliAIPlayground test suite.

Provides:
- Test database creation/teardown (session-scoped)
- Per-test async DB session with transaction rollback
- FastAPI app with overridden get_db dependency
- Authenticated httpx clients for teacher, student, admin
- Seed data fixtures (tenant, teacher, class, session, student)
- Resource profiling (--profile, --profile-docker)
"""

pytest_plugins = ["tests.profiling.conftest"]

import asyncio
import uuid
from typing import AsyncGenerator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.core.config import settings
from app.core.database import Base, get_db
from app.core.security import (
    create_access_token,
    create_student_join_token,
    get_password_hash,
    generate_join_code,
)
from app.models.enums import (
    ChatRoomType,
    SessionStatus,
    TenantStatus,
    UserRole,
)
from app.models.tenant import Tenant
from app.models.user import User
from app.models.session import Class, Session, SessionModule, SessionStudent
from app.models.chat import ChatRoom
from app.models.task import Task, TaskStatus, TaskType

# ---------------------------------------------------------------------------
# Database URL for the test database
# ---------------------------------------------------------------------------
_TEST_DB_NAME = "eduai_test"

# Derive the test URL from the production DATABASE_URL by swapping the DB name
_base_url = settings.DATABASE_URL.rsplit("/", 1)[0]
TEST_DATABASE_URL = f"{_base_url}/{_TEST_DB_NAME}"

# Sync URL variant for CREATE/DROP DATABASE (asyncpg → psycopg2-style not needed;
# we use the maintenance DB via asyncpg with isolation_level)
_MAINTENANCE_URL = f"{_base_url}/postgres"


# ---------------------------------------------------------------------------
# Session-scoped event loop
# ---------------------------------------------------------------------------
@pytest.fixture(scope="session")
def event_loop():
    """Use a single event loop for the entire test session."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


# ---------------------------------------------------------------------------
# Session-scoped: create/drop test database + run migrations
# ---------------------------------------------------------------------------
@pytest_asyncio.fixture(scope="session", autouse=True)
async def setup_test_db():
    """Create the test database, apply schema, then drop it after all tests."""
    # Connect to the maintenance DB to CREATE/DROP the test database
    maint_engine = create_async_engine(
        _MAINTENANCE_URL,
        isolation_level="AUTOCOMMIT",
    )

    async with maint_engine.connect() as conn:
        # Drop if leftover from a previous crashed run
        await conn.execute(text(f'DROP DATABASE IF EXISTS "{_TEST_DB_NAME}"'))
        await conn.execute(text(f'CREATE DATABASE "{_TEST_DB_NAME}"'))

    await maint_engine.dispose()

    # Now create all tables using SQLAlchemy metadata (faster than running Alembic)
    test_engine = create_async_engine(TEST_DATABASE_URL)
    async with test_engine.begin() as conn:
        # Enable pgvector extension if available (ignore errors if not installed)
        try:
            await conn.execute(text('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"'))
        except Exception:
            pass
        try:
            await conn.execute(text('CREATE EXTENSION IF NOT EXISTS "vector"'))
        except Exception:
            pass
        await conn.run_sync(Base.metadata.create_all)

    await test_engine.dispose()

    yield  # ← tests run here

    # Teardown: drop test database
    maint_engine = create_async_engine(
        _MAINTENANCE_URL,
        isolation_level="AUTOCOMMIT",
    )
    async with maint_engine.connect() as conn:
        # Terminate connections before dropping
        await conn.execute(
            text(
                f"SELECT pg_terminate_backend(pid) "
                f"FROM pg_stat_activity "
                f"WHERE datname = '{_TEST_DB_NAME}' AND pid <> pg_backend_pid()"
            )
        )
        await conn.execute(text(f'DROP DATABASE IF EXISTS "{_TEST_DB_NAME}"'))
    await maint_engine.dispose()


# ---------------------------------------------------------------------------
# Per-test: async session with transaction rollback
# ---------------------------------------------------------------------------
@pytest_asyncio.fixture
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    """Yield an AsyncSession that rolls back after each test."""
    engine = create_async_engine(TEST_DATABASE_URL)
    async with engine.connect() as conn:
        txn = await conn.begin()
        session = AsyncSession(bind=conn, expire_on_commit=False)
        try:
            yield session
        finally:
            await session.close()
            await txn.rollback()
    await engine.dispose()


# ---------------------------------------------------------------------------
# FastAPI app with overridden DB dependency
# ---------------------------------------------------------------------------
@pytest_asyncio.fixture
async def client(db_session: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    """httpx AsyncClient hitting the real FastAPI app with test DB session."""
    from app.main import app

    async def _override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = _override_get_db

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Seed data fixtures
# ---------------------------------------------------------------------------
@pytest_asyncio.fixture
async def seed_tenant(db_session: AsyncSession) -> Tenant:
    """Create a test tenant."""
    tenant = Tenant(
        id=uuid.uuid4(),
        name="Test School",
        slug="test-school",
        status=TenantStatus.ACTIVE,
    )
    db_session.add(tenant)
    await db_session.flush()
    return tenant


@pytest_asyncio.fixture
async def seed_teacher(db_session: AsyncSession, seed_tenant: Tenant) -> User:
    """Create a verified, active teacher user."""
    teacher = User(
        id=uuid.uuid4(),
        tenant_id=seed_tenant.id,
        email="teacher@test.com",
        password_hash=get_password_hash("testpass123"),
        role=UserRole.TEACHER,
        first_name="Test",
        last_name="Teacher",
        institution="Test School",
        is_active=True,
        is_verified=True,
    )
    db_session.add(teacher)
    await db_session.flush()
    return teacher


@pytest_asyncio.fixture
async def seed_admin(db_session: AsyncSession, seed_tenant: Tenant) -> User:
    """Create an admin user."""
    admin = User(
        id=uuid.uuid4(),
        tenant_id=seed_tenant.id,
        email="admin@test.com",
        password_hash=get_password_hash("adminpass123"),
        role=UserRole.ADMIN,
        first_name="Test",
        last_name="Admin",
        is_active=True,
        is_verified=True,
    )
    db_session.add(admin)
    await db_session.flush()
    return admin


@pytest_asyncio.fixture
async def seed_class(
    db_session: AsyncSession, seed_tenant: Tenant, seed_teacher: User
) -> Class:
    """Create a test class."""
    cls = Class(
        id=uuid.uuid4(),
        tenant_id=seed_tenant.id,
        teacher_id=seed_teacher.id,
        name="Test Class",
        school_grade="5A",
    )
    db_session.add(cls)
    await db_session.flush()
    return cls


@pytest_asyncio.fixture
async def seed_session(
    db_session: AsyncSession, seed_tenant: Tenant, seed_class: Class
) -> Session:
    """Create an active session with a join code."""
    session = Session(
        id=uuid.uuid4(),
        tenant_id=seed_tenant.id,
        class_id=seed_class.id,
        title="Test Session",
        join_code=generate_join_code(),
        status=SessionStatus.ACTIVE,
    )
    db_session.add(session)
    await db_session.flush()
    return session


@pytest_asyncio.fixture
async def seed_student(
    db_session: AsyncSession, seed_tenant: Tenant, seed_session: Session
) -> SessionStudent:
    """Create a test student in the session."""
    student_id = uuid.uuid4()
    token = create_student_join_token(
        session_id=str(seed_session.id),
        student_id=str(student_id),
        nickname="TestStudent",
    )
    student = SessionStudent(
        id=student_id,
        tenant_id=seed_tenant.id,
        session_id=seed_session.id,
        nickname="TestStudent",
        join_token=token,
    )
    db_session.add(student)
    await db_session.flush()
    return student


@pytest_asyncio.fixture
async def seed_chat_room(
    db_session: AsyncSession, seed_tenant: Tenant, seed_session: Session
) -> ChatRoom:
    """Create a public chat room for the session."""
    room = ChatRoom(
        id=uuid.uuid4(),
        tenant_id=seed_tenant.id,
        session_id=seed_session.id,
        room_type=ChatRoomType.PUBLIC,
    )
    db_session.add(room)
    await db_session.flush()
    return room


# ---------------------------------------------------------------------------
# Authenticated client fixtures
# ---------------------------------------------------------------------------
@pytest_asyncio.fixture
async def teacher_client(
    client: AsyncClient, seed_teacher: User
) -> AsyncClient:
    """Client with teacher Bearer auth header."""
    token = create_access_token(subject=str(seed_teacher.id), token_type="access")
    client.headers["Authorization"] = f"Bearer {token}"
    return client


@pytest_asyncio.fixture
async def student_client(
    client: AsyncClient, seed_student: SessionStudent
) -> AsyncClient:
    """Client with student-token header."""
    client.headers["student-token"] = seed_student.join_token
    return client


@pytest_asyncio.fixture
async def admin_client(
    client: AsyncClient, seed_admin: User
) -> AsyncClient:
    """Client with admin Bearer auth header."""
    token = create_access_token(subject=str(seed_admin.id), token_type="access")
    client.headers["Authorization"] = f"Bearer {token}"
    return client
