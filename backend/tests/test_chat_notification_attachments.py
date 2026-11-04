import json

from app.api.v1.endpoints.chat import _decode_attachments


def test_legacy_string_attachments_are_decoded_so_links_survive_reload():
    note = {"is_notification": True, "notification_type": "teacherbot_published", "notification_data": {"teacherbot_id": "x"}}
    assert _decode_attachments(json.dumps(note)) == note
    assert _decode_attachments(json.dumps(json.dumps(note))) == note  # double-encoded
    links = [{"type": "task_link", "task_id": "t"}]
    assert _decode_attachments(json.dumps(links)) == links


def test_native_and_broken_values_pass_through_safely():
    assert _decode_attachments({"a": 1}) == {"a": 1}
    assert _decode_attachments([]) == []
    assert _decode_attachments("not json") == []
