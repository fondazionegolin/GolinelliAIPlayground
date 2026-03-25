"""
E2E Scenario: Concurrent classroom simulation.

Launches one teacher workflow, then N students join concurrently.
Collects combined metrics and asserts acceptable error rates.
"""

import asyncio
import statistics
from dataclasses import dataclass, field

from tests.e2e.scenarios.teacher_workflow import (
    TeacherWorkflowResult,
    run_teacher_workflow,
)
from tests.e2e.scenarios.student_workflow import (
    StudentWorkflowResult,
    run_student_workflow,
)


@dataclass
class ClassroomResult:
    teacher: TeacherWorkflowResult | None = None
    students: list[StudentWorkflowResult] = field(default_factory=list)
    total_duration_ms: float = 0.0

    @property
    def student_count(self) -> int:
        return len(self.students)

    @property
    def student_success_rate(self) -> float:
        if not self.students:
            return 0.0
        return sum(1 for s in self.students if s.all_ok) / len(self.students)

    @property
    def join_latencies_ms(self) -> list[float]:
        """Latency of the 'join' step for each student."""
        latencies = []
        for s in self.students:
            join_steps = [step for step in s.steps if step.name == "join" and step.ok]
            if join_steps:
                latencies.append(join_steps[0].duration_ms)
        return latencies

    @property
    def join_p95_ms(self) -> float:
        lats = self.join_latencies_ms
        if len(lats) < 2:
            return lats[0] if lats else 0.0
        return statistics.quantiles(lats, n=100)[94]


async def run_concurrent_classroom(
    base_url: str,
    teacher_email: str,
    teacher_password: str,
    num_students: int = 10,
    ramp_delay_s: float = 0.5,
) -> ClassroomResult:
    result = ClassroomResult()

    # Step 1: Teacher sets up the classroom (keep session active for students)
    teacher_result = await run_teacher_workflow(
        base_url=base_url,
        email=teacher_email,
        password=teacher_password,
        class_name="Concurrent E2E Class",
        session_title="Concurrent E2E Session",
        end_session=False,
    )
    result.teacher = teacher_result

    if not teacher_result.all_ok or not teacher_result.join_code:
        return result

    # Step 2: Students join concurrently with staggered ramp
    async def launch_student(idx: int) -> StudentWorkflowResult:
        await asyncio.sleep(idx * ramp_delay_s)
        return await run_student_workflow(
            base_url=base_url,
            join_code=teacher_result.join_code,
            nickname=f"Student_{idx:03d}",
            session_id=teacher_result.session_id,
        )

    student_tasks = [launch_student(i) for i in range(num_students)]
    result.students = await asyncio.gather(*student_tasks)

    # Calculate total duration
    all_durations = [teacher_result.total_ms] + [s.total_ms for s in result.students]
    result.total_duration_ms = max(all_durations) if all_durations else 0.0

    return result
