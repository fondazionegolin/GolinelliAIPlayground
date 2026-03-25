"""
Combined classroom scenario: 1 teacher + N students.

Usage:
    from loadtest_app.scenarios.classroom_scenario import run_classroom
    result = await run_classroom(metrics, cfg, teacher_email, teacher_password)
"""

from __future__ import annotations

import asyncio
from typing import Any

from ..config import LoadTestConfig
from ..journey import run_user_journey_api
from ..metrics import MetricsStore
from .teacher_journey import run_teacher_journey


async def run_classroom(
    metrics: MetricsStore,
    cfg: LoadTestConfig,
    teacher_email: str,
    teacher_password: str,
    num_students: int = 10,
    ramp_delay: float = 0.5,
) -> dict[str, Any]:
    """
    Run a complete classroom scenario:
      1. Teacher logs in, creates class + session
      2. N students join and run their full journey

    Returns summary dict with teacher and student results.
    """
    # Teacher sets up (user_id=0 reserved for teacher)
    teacher_result = await run_teacher_journey(
        teacher_id=0,
        email=teacher_email,
        password=teacher_password,
        base_url=cfg.base_url,
        metrics=metrics,
    )

    if not teacher_result["ok"]:
        return {
            "ok": False,
            "error": "Teacher journey failed",
            "teacher": teacher_result,
            "students_launched": 0,
        }

    # Override join code in config for student journeys
    cfg.join_code = teacher_result["join_code"]

    # Launch students with staggered ramp
    async def launch_student(uid: int):
        await asyncio.sleep(uid * ramp_delay)
        return await run_user_journey_api(uid, cfg, metrics)

    student_tasks = [launch_student(i + 1) for i in range(num_students)]
    student_results = await asyncio.gather(*student_tasks, return_exceptions=True)

    ok_count = sum(
        1 for r in student_results
        if not isinstance(r, Exception) and r.ok
    )
    fail_count = num_students - ok_count

    return {
        "ok": fail_count == 0,
        "teacher": teacher_result,
        "students_launched": num_students,
        "students_ok": ok_count,
        "students_failed": fail_count,
        "join_code": teacher_result["join_code"],
    }
