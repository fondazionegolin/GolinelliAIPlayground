"""
Teacher journey for loadtest — follows the same patterns as journey.py.

Simulates a teacher: login → create class → create session → configure →
create tasks → monitor students → end session.
"""

from __future__ import annotations

import time
from typing import Any

import httpx

from ..metrics import MetricsStore


async def run_teacher_journey(
    teacher_id: int,
    email: str,
    password: str,
    base_url: str,
    metrics: MetricsStore,
) -> dict[str, Any]:
    """
    Run a full teacher journey and record steps in MetricsStore.
    Returns a dict with session_id, join_code, class_id for use by student journeys.
    """
    await metrics.mark_launched(teacher_id)
    api_base = f"{base_url.rstrip('/')}/api/v1"

    result: dict[str, Any] = {
        "ok": False,
        "session_id": "",
        "join_code": "",
        "class_id": "",
        "token": "",
    }

    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        try:
            # 1. Login
            async def login_step() -> None:
                res = await _teacher_api(
                    client, metrics, "POST", f"{api_base}/auth/login",
                    endpoint_key="/api/v1/auth/login",
                    json={"email": email, "password": password},
                )
                result["token"] = res["access_token"]
                client.headers["Authorization"] = f"Bearer {result['token']}"

            await _step(metrics, teacher_id, "teacher_login", login_step)
            await metrics.add_feature("teacher_logins", 1)

            # 2. Create class
            async def create_class_step() -> None:
                res = await _teacher_api(
                    client, metrics, "POST", f"{api_base}/teacher/classes",
                    endpoint_key="/api/v1/teacher/classes",
                    json={"name": f"Loadtest Class T{teacher_id}"},
                )
                result["class_id"] = str(res["id"])

            await _step(metrics, teacher_id, "teacher_create_class", create_class_step)

            # 3. Create session
            async def create_session_step() -> None:
                res = await _teacher_api(
                    client, metrics, "POST",
                    f"{api_base}/teacher/classes/{result['class_id']}/sessions",
                    endpoint_key="/api/v1/teacher/classes/{id}/sessions",
                    json={"title": f"Loadtest Session T{teacher_id}"},
                )
                result["session_id"] = str(res["id"])
                result["join_code"] = res["join_code"]

            await _step(metrics, teacher_id, "teacher_create_session", create_session_step)

            # 4. Activate session
            async def activate_step() -> None:
                await _teacher_api(
                    client, metrics, "PATCH",
                    f"{api_base}/teacher/sessions/{result['session_id']}",
                    endpoint_key="/api/v1/teacher/sessions/{id}",
                    json={"status": "active"},
                )

            await _step(metrics, teacher_id, "teacher_activate_session", activate_step)

            # 5. Configure modules
            async def modules_step() -> None:
                await _teacher_api(
                    client, metrics, "POST",
                    f"{api_base}/teacher/sessions/{result['session_id']}/modules",
                    endpoint_key="/api/v1/teacher/sessions/{id}/modules",
                    json={"modules": [
                        {"module_key": "chatbot", "is_enabled": True},
                        {"module_key": "classification", "is_enabled": True},
                        {"module_key": "chat", "is_enabled": True},
                    ]},
                )

            await _step(metrics, teacher_id, "teacher_configure_modules", modules_step)

            # 6. Create task
            async def task_step() -> None:
                await _teacher_api(
                    client, metrics, "POST",
                    f"{api_base}/teacher/sessions/{result['session_id']}/tasks",
                    endpoint_key="/api/v1/teacher/sessions/{id}/tasks",
                    json={
                        "title": "Loadtest Quiz",
                        "task_type": "quiz",
                        "description": "Automated test task",
                    },
                )

            await _step(metrics, teacher_id, "teacher_create_task", task_step)
            await metrics.add_feature("teacher_tasks_created", 1)

            # 7. Check live view
            async def live_step() -> None:
                await _teacher_api(
                    client, metrics, "GET",
                    f"{api_base}/teacher/sessions/{result['session_id']}/live",
                    endpoint_key="/api/v1/teacher/sessions/{id}/live",
                )

            await _step(metrics, teacher_id, "teacher_check_live", live_step)

            result["ok"] = True
            await metrics.mark_finished(teacher_id, ok=True)

        except Exception as e:
            await metrics.mark_finished(teacher_id, ok=False, note=str(e))

    return result


async def _teacher_api(
    client: httpx.AsyncClient,
    metrics: MetricsStore,
    method: str,
    url: str,
    endpoint_key: str,
    **kwargs,
) -> dict[str, Any]:
    """Make an API call and record timing in MetricsStore."""
    t0 = time.perf_counter()
    resp = await client.request(method, url, **kwargs)
    elapsed_ms = (time.perf_counter() - t0) * 1000
    await metrics.add_api_timing(endpoint_key, elapsed_ms)

    if resp.status_code >= 400:
        raise RuntimeError(f"{method} {endpoint_key} → {resp.status_code}: {resp.text[:200]}")

    return resp.json()


async def _step(metrics: MetricsStore, user_id: int, step_name: str, fn) -> None:
    """Wrap a step function with timing and error recording."""
    t0 = time.perf_counter()
    try:
        await fn()
        elapsed_ms = (time.perf_counter() - t0) * 1000
        await metrics.add_step(user_id, step_name, ok=True, ms=elapsed_ms)
    except Exception as e:
        elapsed_ms = (time.perf_counter() - t0) * 1000
        await metrics.add_step(user_id, step_name, ok=False, ms=elapsed_ms, note=str(e))
        raise
