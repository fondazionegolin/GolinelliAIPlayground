import json
import socket

import fitz
import pytest

from app.services.brochure import merge_brochure_patch
from app.services.html_pdf import html_to_pdf, public_asset
from app.services.document_conversion import export_document


def test_brochure_label_patch_keeps_unmodified_template_text():
    old = {"title": "XR", "palette": ["#123456"], "labels": {"overview": "Overview", "featuresTitle": "Features"}}
    merged = merge_brochure_patch(old, {"labels": {"featuresTitle": "Why XR?"}})
    assert merged["labels"] == {"overview": "Overview", "featuresTitle": "Why XR?"}
    assert merged["palette"] == old["palette"]
    assert old["labels"]["featuresTitle"] == "Features"


@pytest.mark.parametrize('url', ['file:///etc/passwd', 'http://127.0.0.1/a.png', 'http://[::1]/font',
                                    'http://169.254.169.254/latest/meta-data', 'https://example.com:8000/image', 'http://a:b@example.com/a'])
def test_pdf_assets_reject_internal_urls(url):
    with pytest.raises(ValueError):
        public_asset(url)


def test_pdf_assets_reject_private_dns(monkeypatch):
    monkeypatch.setattr(socket, 'getaddrinfo', lambda *a, **k: [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('10.0.0.12', 443))])
    with pytest.raises(ValueError, match='pubblico'):
        public_asset('https://private.example/image.png')


HTML = '''<!doctype html><html><head><style>
*{box-sizing:border-box}body{margin:0;font-family:Arial;background:#123456;color:white}
.hero{height:300px;padding:24px;background:linear-gradient(90deg,#123456,#e34488)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:24px;padding:24px}
.card{height:180px;background:#ffe900;color:#123456;padding:16px;border-radius:20px}
@media print{body{background:white;color:black}.grid{display:block}.hero{display:none}}
</style></head><body><div class="hero"><h1>XR web brochure</h1></div>
<div class="grid"><div class="card">LEFT CARD</div><div class="card">RIGHT CARD</div></div>
<p>LAST SECTION</p><script>document.body.innerHTML='SCRIPT EXECUTED'</script></body></html>'''


def test_pdf_preserves_screen_grid_background_and_full_content():
    exported = export_document(json.dumps({'type': 'html_v1', 'htmlContent': HTML, 'viewport': {'width': 800, 'height': 600}}), 'XR brochure', 'pdf')
    assert exported.filename == 'XR brochure.pdf'
    doc = fitz.open(stream=exported.content, filetype='pdf')
    assert len(doc) == 1
    page = doc[0]
    assert page.rect.width == pytest.approx(600, abs=1)
    text = page.get_text()
    assert all(t in text for t in ['XR web brochure', 'LEFT CARD', 'RIGHT CARD', 'LAST SECTION'])
    assert 'SCRIPT EXECUTED' not in text
    left, right = page.search_for('LEFT CARD')[0], page.search_for('RIGHT CARD')[0]
    assert left.y0 == pytest.approx(right.y0, abs=1)
    assert right.x0 > left.x0 + 200  # CSS grid survived; no conversion to a vertical DOCX list.
    image = page.get_pixmap()
    assert image.pixel(2, 2)[:3] != (255, 255, 255)


def test_pdf_rejects_oversize_html():
    with pytest.raises(ValueError):
        html_to_pdf('x' * 2_000_001)


def test_brochure_edit_tool_exposes_and_merges_template_labels(monkeypatch):
    import asyncio
    from types import SimpleNamespace
    from app.api.v1.endpoints import llm

    async def create(**kwargs):
        properties = kwargs['tools'][0]['input_schema']['properties']
        assert 'language' in properties and 'labels' in properties
        assert 'featuresTitle' in properties['labels']['properties']
        assert 'footer' in properties['labels']['properties']
        assert 'TUTTI i testi visibili' in kwargs['system']
        return SimpleNamespace(content=[SimpleNamespace(type='tool_use', name='edit_brochure', input={
            'language': 'en', 'labels': {'featuresTitle': 'Key features', 'footer': 'Prepared by our class'}, 'title': 'Our project',
        })])

    monkeypatch.setattr(llm.llm_service, 'anthropic_client', SimpleNamespace(messages=SimpleNamespace(create=create)))
    original = {'title': 'Il progetto', 'palette': ['#123456'], 'labels': {'overview': 'Overview', 'featuresTitle': 'Elementi distintivi'}}
    result = asyncio.run(llm.edit_brochure(llm.BrochureEditRequest(payload=original, modification='Traduci in inglese'), None))
    assert result['payload']['labels'] == {'overview': 'Overview', 'featuresTitle': 'Key features', 'footer': 'Prepared by our class'}
    assert result['payload']['language'] == 'en'
    assert result['payload']['palette'] == original['palette']
