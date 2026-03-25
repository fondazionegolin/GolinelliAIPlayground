"""
E2E Scenario: Full student lifecycle.

Steps:
  1. Join session (by join code)
  2. Get session info
  3. Send heartbeat
  4. Get tasks
  5. Send a chat message
  6. Create a document draft

Returns a StudentWorkflowResult with timings and created IDs.
"""

import time
from dataclasses import dataclass, field

import httpx

from tests.e2e.scenarios.teacher_workflow import StepResult, _timed_step


@dataclass
class StudentWorkflowResult:
    steps: list[StepResult] = field(default_factory=list)
    student_id: str = ""
    nickname: str = ""

    @property
    def all_ok(self) -> bool:
        return all(s.ok for s in self.steps)

    @property
    def total_ms(self) -> float:
        return sum(s.duration_ms for s in self.steps)


async def run_student_workflow(
    base_url: str,
    join_code: str,
    nickname: str,
    session_id: str,
) -> StudentWorkflowResult:
    result = StudentWorkflowResult(nickname=nickname)

    async with httpx.AsyncClient(base_url=base_url, timeout=30) as client:

        # 1. Join session
        step = await _timed_step("join", client.post, "/student/join", json={
            "join_code": join_code, "nickname": nickname,
        })
        result.steps.append(step)
        if not step.ok:
            return result
        result.student_id = step.data["student_id"]
        client.headers["student-token"] = step.data["join_token"]

        # 2. Get session info
        step = await _timed_step("get_session", client.get, "/student/session")
        result.steps.append(step)

        # 3. Heartbeat
        step = await _timed_step("heartbeat", client.post, "/student/heartbeat")
        result.steps.append(step)

        # 4. Get tasks
        step = await _timed_step("get_tasks", client.get, "/student/tasks")
        result.steps.append(step)

        # 5. Send chat message
        step = await _timed_step("chat_message", client.post,
            f"/chat/session/{session_id}/messages",
            json={"text": f"Hello from {nickname}!"},
        )
        result.steps.append(step)

        # 6. Create document draft
        step = await _timed_step("create_draft", client.post,
            "/student/documents/drafts",
            json={
                "title": f"{nickname}'s Draft",
                "doc_type": "document",
                "content_json": '{"blocks":[]}',
            },
        )
        result.steps.append(step)

    return result
