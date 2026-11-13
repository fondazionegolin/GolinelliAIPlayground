import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from app.api.v1.endpoints.document_shares import clean_public_content, public_document, revision


def test_public_document_preserves_formatting_but_removes_active_html():
    content = json.loads(clean_public_content(json.dumps({"htmlContent": '<h1>Titolo</h1><p style="font-style:italic">Testo</p><img src="data:image/png;base64,a" onerror="alert(1)"><script>alert(1)</script>', "source": {"storage_key": "private"}}), "document"))
    assert '<h1>Titolo</h1>' in content["htmlContent"]
    assert 'font-style:italic' in content["htmlContent"]
    assert 'data:image/png;base64,a' in content["htmlContent"]
    assert "onerror" not in content["htmlContent"] and "script" not in content["htmlContent"]
    assert "source" not in content


@pytest.mark.parametrize("value,kind", [("{", "document"), ("[]", "document"), ('{"slides": []}', "presentation"), ('{"htmlContent": "x", "slides": []}', "document"),
    (json.dumps({"slides": [{"blocks": [{"type": "text", "content": "x", "style": {}, "x": float('nan'), "y": 0, "width": 100, "height": 100}]}]}), "presentation")])
def test_invalid_public_edits_are_rejected(value, kind):
    with pytest.raises(HTTPException) as error:
        clean_public_content(value, kind)
    assert error.value.status_code == 422


def test_public_response_uses_only_granted_image_routes_and_keeps_source_revision():
    file_id = '11111111-1111-4111-8111-111111111111'
    source = SimpleNamespace(title='T', content_json=json.dumps({"htmlContent": f'<img src="/api/v1/files/{file_id}/content">', "source": {"private": True}}))
    link = SimpleNamespace(token='a' * 43, permission='view', asset_ids=[file_id])
    result = public_document(link, source)
    assert f'/public/{link.token}/assets/{file_id}' in result['content_json']
    assert 'private' not in result['content_json']
    assert result['revision'] == revision(source)
    source.title = 'Changed'
    assert result['revision'] != revision(source)
