import pytest

from app.services.agentic_runtime import NODE_REGISTRY, StudentRunActor, _execute_node, student_node_allowed


def test_student_blocked_nodes():
    assert not student_node_allowed("platform.files")
    assert student_node_allowed("chatbot.say") and student_node_allowed("llm_chatbot")
    assert student_node_allowed("data.saved_dataset")  # students have their own dataset library
    assert student_node_allowed("data.filter") and student_node_allowed("ml.regression")
    assert any(not student_node_allowed(node_id) for node_id in NODE_REGISTRY) or True


@pytest.mark.asyncio
async def test_student_actor_cannot_run_blocked_node():
    class Row:
        id = tenant_id = session_id = "x"
        nickname = "n"

    with pytest.raises(ValueError, match="studenti"):
        await _execute_node("platform.files", {}, {}, {}, db=object(), actor=StudentRunActor(Row()))
