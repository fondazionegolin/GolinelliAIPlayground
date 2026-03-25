"""
Concurrent load tests — stress-test endpoints with many parallel requests.

Runs against the live Docker API (not in-process ASGI) because concurrent
requests need independent DB connections that the single-session test fixture
cannot provide.
"""

import asyncio
import time

import httpx
import pytest

from tests.e2e.conftest import E2E_BASE_URL, E2E_TEACHER_EMAIL, E2E_TEACHER_PASSWORD
from tests.e2e.scenarios.teacher_workflow import run_teacher_workflow


@pytest.mark.benchmark
class TestConcurrentLoad:

    async def test_concurrent_student_joins(self):
        """50 students joining simultaneously should all succeed."""
        # Set up a session via the live API
        teacher = await run_teacher_workflow(
            base_url=E2E_BASE_URL,
            email=E2E_TEACHER_EMAIL,
            password=E2E_TEACHER_PASSWORD,
            class_name="Concurrent Join Test",
            end_session=False,
        )
        assert teacher.all_ok, "Teacher setup failed"

        num_students = 50
        errors = []
        durations = []

        async def join(i: int):
            async with httpx.AsyncClient(base_url=E2E_BASE_URL, timeout=30) as c:
                t0 = time.perf_counter()
                resp = await c.post(
                    "/student/join",
                    json={
                        "join_code": teacher.join_code,
                        "nickname": f"ConcurrentStudent{i}",
                    },
                )
                ms = (time.perf_counter() - t0) * 1000
                durations.append(ms)
                if resp.status_code >= 500:
                    errors.append(f"Student {i}: HTTP {resp.status_code}")

        await asyncio.gather(*(join(i) for i in range(num_students)))

        error_rate = len(errors) / num_students
        avg_ms = sum(durations) / len(durations) if durations else 0

        print(f"\n  Concurrent joins: {num_students}")
        print(f"  Errors: {len(errors)} ({error_rate:.0%})")
        print(f"  Avg latency: {avg_ms:.1f}ms")

        assert error_rate == 0, f"Server errors during concurrent joins: {errors}"

    async def test_concurrent_chat_messages(self):
        """20 concurrent chat messages should all succeed."""
        # Set up teacher + student via the live API
        teacher = await run_teacher_workflow(
            base_url=E2E_BASE_URL,
            email=E2E_TEACHER_EMAIL,
            password=E2E_TEACHER_PASSWORD,
            class_name="Concurrent Chat Test",
            end_session=False,
        )
        assert teacher.all_ok, "Teacher setup failed"

        # Join as a student
        async with httpx.AsyncClient(base_url=E2E_BASE_URL, timeout=30) as c:
            resp = await c.post(
                "/student/join",
                json={"join_code": teacher.join_code, "nickname": "ChatLoadStudent"},
            )
            assert resp.status_code == 200
            join_token = resp.json()["join_token"]

        num_messages = 20
        errors = []

        async def send_msg(i: int):
            async with httpx.AsyncClient(base_url=E2E_BASE_URL, timeout=30) as c:
                c.headers["student-token"] = join_token
                resp = await c.post(
                    f"/chat/session/{teacher.session_id}/messages",
                    json={"text": f"Concurrent message {i}"},
                )
                if resp.status_code >= 500:
                    errors.append(f"Message {i}: HTTP {resp.status_code}")

        await asyncio.gather(*(send_msg(i) for i in range(num_messages)))

        print(f"\n  Concurrent messages: {num_messages}")
        print(f"  Errors: {len(errors)}")

        assert len(errors) == 0, f"Server errors during concurrent chat: {errors}"

    async def test_concurrent_heartbeats(self):
        """Rapid heartbeats should not cause server errors."""
        # Set up teacher + student via the live API
        teacher = await run_teacher_workflow(
            base_url=E2E_BASE_URL,
            email=E2E_TEACHER_EMAIL,
            password=E2E_TEACHER_PASSWORD,
            class_name="Concurrent Heartbeat Test",
            end_session=False,
        )
        assert teacher.all_ok, "Teacher setup failed"

        async with httpx.AsyncClient(base_url=E2E_BASE_URL, timeout=30) as c:
            resp = await c.post(
                "/student/join",
                json={"join_code": teacher.join_code, "nickname": "HeartbeatStudent"},
            )
            assert resp.status_code == 200
            join_token = resp.json()["join_token"]

        errors = []

        async def heartbeat():
            async with httpx.AsyncClient(base_url=E2E_BASE_URL, timeout=30) as c:
                c.headers["student-token"] = join_token
                resp = await c.post("/student/heartbeat")
                if resp.status_code >= 500:
                    errors.append(f"HTTP {resp.status_code}")

        await asyncio.gather(*(heartbeat() for _ in range(30)))

        print(f"\n  Concurrent heartbeats: 30")
        print(f"  Errors: {len(errors)}")

        assert len(errors) == 0, f"Server errors during heartbeat storm: {errors}"
