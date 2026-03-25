"""
E2E Scenario: Full teacher lifecycle.

Steps:
  1. Login
  2. Create class
  3. Create session (gets join code)
  4. Configure modules
  5. Create a task
  6. List students
  7. End session

Returns a dict with all created resource IDs and timings.
"""

import time
from dataclasses import dataclass, field
from typing import Any

import httpx


@dataclass
class StepResult:
    name: str
    ok: bool
    duration_ms: float
    data: dict = field(default_factory=dict)
    error: str = ""


@dataclass
class TeacherWorkflowResult:
    steps: list[StepResult] = field(default_factory=list)
    join_code: str = ""
    session_id: str = ""
    class_id: str = ""
    task_id: str = ""
    token: str = ""

    @property
    def all_ok(self) -> bool:
        return all(s.ok for s in self.steps)

    @property
    def total_ms(self) -> float:
        return sum(s.duration_ms for s in self.steps)


async def run_teacher_workflow(
    base_url: str,
    email: str,
    password: str,
    class_name: str = "E2E Test Class",
    session_title: str = "E2E Test Session",
    end_session: bool = True,
) -> TeacherWorkflowResult:
    result = TeacherWorkflowResult()

    async with httpx.AsyncClient(base_url=base_url, timeout=30) as client:

        # 1. Login
        step = await _timed_step("login", client.post, "/auth/login", json={
            "email": email, "password": password,
        })
        result.steps.append(step)
        if not step.ok:
            return result
        result.token = step.data["access_token"]
        client.headers["Authorization"] = f"Bearer {result.token}"

        # 2. Create class
        step = await _timed_step("create_class", client.post, "/teacher/classes", json={
            "name": class_name,
        })
        result.steps.append(step)
        if not step.ok:
            return result
        result.class_id = step.data["id"]

        # 3. Create session
        step = await _timed_step("create_session", client.post,
            f"/teacher/classes/{result.class_id}/sessions",
            json={"title": session_title},
        )
        result.steps.append(step)
        if not step.ok:
            return result
        result.session_id = step.data["id"]
        result.join_code = step.data["join_code"]

        # 4. Activate session
        step = await _timed_step("activate_session", client.patch,
            f"/teacher/sessions/{result.session_id}",
            json={"status": "active"},
        )
        result.steps.append(step)

        # 5. Configure modules
        step = await _timed_step("configure_modules", client.post,
            f"/teacher/sessions/{result.session_id}/modules",
            json={"modules": [
                {"module_key": "chatbot", "is_enabled": True},
                {"module_key": "classification", "is_enabled": True},
                {"module_key": "chat", "is_enabled": True},
            ]},
        )
        result.steps.append(step)

        # 6. Create task
        step = await _timed_step("create_task", client.post,
            f"/teacher/sessions/{result.session_id}/tasks",
            json={"title": "E2E Quiz", "task_type": "quiz", "description": "Auto test"},
        )
        result.steps.append(step)
        if step.ok:
            result.task_id = step.data.get("id", "")

        # 7. List students
        step = await _timed_step("list_students", client.get,
            f"/teacher/sessions/{result.session_id}/live",
        )
        result.steps.append(step)

        # 8. End session (optional — skip when students need the session active)
        if end_session:
            step = await _timed_step("end_session", client.patch,
                f"/teacher/sessions/{result.session_id}",
                json={"status": "ended"},
            )
            result.steps.append(step)

    return result


async def _timed_step(name: str, method, *args, **kwargs) -> StepResult:
    t0 = time.perf_counter()
    try:
        resp = await method(*args, **kwargs)
        ms = (time.perf_counter() - t0) * 1000
        if resp.status_code >= 400:
            return StepResult(name=name, ok=False, duration_ms=ms,
                              error=f"HTTP {resp.status_code}: {resp.text[:200]}")
        data = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
        return StepResult(name=name, ok=True, duration_ms=ms, data=data)
    except Exception as exc:
        ms = (time.perf_counter() - t0) * 1000
        return StepResult(name=name, ok=False, duration_ms=ms, error=str(exc))
