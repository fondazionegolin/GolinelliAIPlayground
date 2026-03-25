"""
Pytest wrappers for E2E scenarios.

These tests require a running Docker stack and are skipped by default.
Run with: pytest tests/e2e/ --run-e2e
"""

import pytest

from tests.e2e.conftest import E2E_BASE_URL, E2E_TEACHER_EMAIL, E2E_TEACHER_PASSWORD
from tests.e2e.scenarios.teacher_workflow import run_teacher_workflow
from tests.e2e.scenarios.student_workflow import run_student_workflow
from tests.e2e.scenarios.concurrent_classroom import run_concurrent_classroom


@pytest.mark.e2e
@pytest.mark.timeout(60)
class TestTeacherWorkflow:
    async def test_full_teacher_lifecycle(self):
        result = await run_teacher_workflow(
            base_url=E2E_BASE_URL,
            email=E2E_TEACHER_EMAIL,
            password=E2E_TEACHER_PASSWORD,
        )
        failed = [s for s in result.steps if not s.ok]
        assert result.all_ok, (
            f"Teacher workflow failed at: "
            f"{', '.join(f'{s.name}: {s.error}' for s in failed)}"
        )
        assert result.join_code, "No join code generated"


@pytest.mark.e2e
@pytest.mark.timeout(60)
class TestStudentWorkflow:
    async def test_full_student_lifecycle(self):
        # First create a session via teacher (keep session active for students)
        teacher = await run_teacher_workflow(
            base_url=E2E_BASE_URL,
            email=E2E_TEACHER_EMAIL,
            password=E2E_TEACHER_PASSWORD,
            end_session=False,
        )
        assert teacher.all_ok, "Teacher setup failed"

        result = await run_student_workflow(
            base_url=E2E_BASE_URL,
            join_code=teacher.join_code,
            nickname="E2E_Student",
            session_id=teacher.session_id,
        )
        failed = [s for s in result.steps if not s.ok]
        assert result.all_ok, (
            f"Student workflow failed at: "
            f"{', '.join(f'{s.name}: {s.error}' for s in failed)}"
        )


@pytest.mark.e2e
@pytest.mark.timeout(120)
class TestConcurrentClassroom:
    async def test_concurrent_students(self):
        result = await run_concurrent_classroom(
            base_url=E2E_BASE_URL,
            teacher_email=E2E_TEACHER_EMAIL,
            teacher_password=E2E_TEACHER_PASSWORD,
            num_students=10,
            ramp_delay_s=0.3,
        )
        assert result.teacher and result.teacher.all_ok, "Teacher setup failed"

        # Assert acceptable success rate
        assert result.student_success_rate >= 0.98, (
            f"Student success rate too low: {result.student_success_rate:.0%}"
        )

        # Assert join latency
        if result.join_latencies_ms:
            assert result.join_p95_ms < 3000, (
                f"Join p95 latency too high: {result.join_p95_ms:.0f}ms"
            )

        # Print summary for visibility
        print(f"\n{'='*60}")
        print(f"Concurrent Classroom Results:")
        print(f"  Students: {result.student_count}")
        print(f"  Success rate: {result.student_success_rate:.0%}")
        print(f"  Join p95: {result.join_p95_ms:.0f}ms")
        print(f"  Total duration: {result.total_duration_ms:.0f}ms")
        print(f"{'='*60}")
