from uuid import uuid4

import pytest

from app.api.v1.endpoints.live_interaction import (
    _disable_public_access,
    _duplicate_as_draft,
    _public_code_needs_rotation,
)
from app.models.live_interaction import LiveInteraction


@pytest.mark.parametrize("interaction_type", ["slides", "escape_room"])
def test_duplicate_live_interaction_creates_clean_independent_draft(interaction_type):
    source = LiveInteraction(
        session_id=uuid4(),
        created_by=uuid4(),
        title="Quiz originale",
        interaction_type=interaction_type,
        slides_json=[{"question": "Domanda", "nested": {"value": 1}}],
        escape_config_json={"mission": "Missione"} if interaction_type == "escape_room" else None,
        status="CLOSED",
        current_slide_index=4,
        public_enabled=True,
        public_token="old-public-token",
    )
    target_session_id = uuid4()
    teacher_id = uuid4()

    duplicate = _duplicate_as_draft(source, target_session_id, teacher_id)

    assert duplicate.session_id == target_session_id
    assert duplicate.created_by == teacher_id
    assert duplicate.interaction_type == interaction_type
    assert duplicate.status == "DRAFT"
    assert duplicate.current_slide_index == 0
    assert duplicate.public_enabled is False
    assert duplicate.public_token is None
    assert duplicate.slides_json == source.slides_json
    assert duplicate.slides_json is not source.slides_json

    duplicate.slides_json[0]["nested"]["value"] = 2
    assert source.slides_json[0]["nested"]["value"] == 1


def test_public_live_code_is_reused_only_while_enabled_and_invalidated_on_close():
    interaction = LiveInteraction(public_enabled=True, public_token="ABC234")

    assert _public_code_needs_rotation(interaction) is False

    _disable_public_access(interaction)

    assert interaction.public_enabled is False
    assert interaction.public_token is None
    assert _public_code_needs_rotation(interaction) is True
