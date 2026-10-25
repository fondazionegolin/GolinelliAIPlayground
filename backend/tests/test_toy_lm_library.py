import asyncio
import csv
import gzip
import hashlib
import importlib.util
import io
import sys
import time
from pathlib import Path
from xml.sax.saxutils import escape

import httpx
import pytest

SERVICE_DIR = Path(__file__).resolve().parents[1] / 'app' / 'services'


def load_module(name):
    spec = importlib.util.spec_from_file_location(f'app.services.{name}', SERVICE_DIR / f'{name}.py')
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


catalog = load_module('toy_lm_catalog')
library = load_module('toy_lm_library')


def rdf(*, rights='Public domain in the USA.', media_type='Text', formats=None):
    if formats is None:
        formats = [('text/plain; charset=utf-8', 'https://www.gutenberg.org/ebooks/11.txt.utf-8')]
    files = ''.join(f'<dc:hasFormat><pg:file rdf:about="{escape(url)}"><dc:format><rdf:Description><rdf:value>{escape(mime)}</rdf:value></rdf:Description></dc:format></pg:file></dc:hasFormat>' for mime, url in formats)
    return f'''<rdf:RDF xmlns:rdf="{library.NS['rdf']}" xmlns:dc="{library.NS['dc']}" xmlns:pg="{library.NS['pg']}">
    <pg:ebook rdf:about="https://www.gutenberg.org/ebooks/11"><dc:title>Alice</dc:title><dc:rights>{rights}</dc:rights>
    <dc:type><rdf:Description><rdf:value>{media_type}</rdf:value></rdf:Description></dc:type>
    <dc:creator><pg:agent><pg:name>Carroll, Lewis</pg:name></pg:agent></dc:creator>
    <dc:language><rdf:Description><rdf:value>it</rdf:value></rdf:Description></dc:language>{files}</pg:ebook></rdf:RDF>'''.encode()


def full_txt(body='C’era una volta un tè.'):
    return f'License and metadata\n*** START OF THE PROJECT GUTENBERG EBOOK ALICE ***\n\n{body}\n\n*** END OF THE PROJECT GUTENBERG EBOOK ALICE ***\nLicense'.encode()


def mock_http(monkeypatch, handler):
    client_class = httpx.AsyncClient
    monkeypatch.setattr(library.httpx, 'AsyncClient', lambda **kwargs: client_class(transport=httpx.MockTransport(handler), **kwargs))


async def collect_events(book_id=11):
    return [event async for event in library.import_book_events(book_id)]


def test_import_keeps_entire_long_book_and_reports_actual_progress(monkeypatch):
    body = 'INIZIO DEL LIBRO\n' + 'C’era una volta un tè.\n' * 20000 + 'FINE DEL LIBRO'
    content = full_txt(body)

    def handler(request):
        if request.url.path.endswith('.rdf'):
            return httpx.Response(200, content=rdf())
        assert request.headers['accept-encoding'] == 'identity'
        return httpx.Response(200, content=content, headers={'content-type': 'text/plain; charset=utf-8'})

    mock_http(monkeypatch, handler)
    events = asyncio.run(collect_events())
    result = events[-1]['book']
    assert result['text'] == body
    assert len(result['text']) > 200_000
    assert result['text'].endswith('FINE DEL LIBRO')
    assert result['truncated'] is False
    assert result['sha256'] == hashlib.sha256(body.encode()).hexdigest()
    assert result['byteCount'] == len(body.encode())
    assert result['downloadedBytes'] == len(content)
    progress = [e for e in events if e['type'] == 'progress']
    assert len(progress) > 2
    assert [e['receivedBytes'] for e in progress] == sorted(e['receivedBytes'] for e in progress)
    assert progress[-1]['receivedBytes'] == progress[-1]['totalBytes'] == len(content)
    assert any(e.get('stage') == 'verifying' for e in events)


def test_import_removes_only_gutenberg_boilerplate(monkeypatch):
    mock_http(monkeypatch, lambda request: httpx.Response(200, content=rdf() if request.url.path.endswith('.rdf') else full_txt()))
    result = asyncio.run(library.import_book(11))
    assert result['text'] == 'C’era una volta un tè.'
    assert result['authors'] == ['Carroll, Lewis']
    assert result['sourceUrl'] == 'https://www.gutenberg.org/ebooks/11'


def test_compressed_responses_report_bytes_without_an_incorrect_percentage(monkeypatch):
    content = full_txt('Testo integrale ' * 1000)

    def handler(request):
        if request.url.path.endswith('.rdf'):
            return httpx.Response(200, content=rdf())
        return httpx.Response(200, content=gzip.compress(content), headers={'content-encoding': 'gzip'})

    mock_http(monkeypatch, handler)
    events = asyncio.run(collect_events())
    progress = [event for event in events if event['type'] == 'progress']
    assert all(event['totalBytes'] is None for event in progress)
    assert progress[-1]['receivedBytes'] == len(content)
    assert events[-1]['type'] == 'complete'


@pytest.mark.parametrize('options', [{'rights': 'Copyrighted'}, {'rights': ''}, {'media_type': 'Sound'}, {'formats': [('text/html', 'https://www.gutenberg.org/11.html')]}])
def test_metadata_rejects_copyright_audio_and_non_txt_before_downloading(monkeypatch, options):
    def handler(request):
        assert request.url.path.endswith('.rdf')
        return httpx.Response(200, content=rdf(**options))

    mock_http(monkeypatch, handler)
    with pytest.raises(library.LibraryError) as error:
        asyncio.run(library.import_book(11))
    assert error.value.status_code == 422


@pytest.mark.parametrize('url', ['http://127.0.0.1/private', 'https://gutenberg.org.evil.test/book.txt', 'https://www.gutenberg.org:8443/book.txt', 'file:///etc/passwd'])
def test_metadata_rejects_untrusted_urls(monkeypatch, url):
    mock_http(monkeypatch, lambda request: httpx.Response(200, content=rdf(formats=[('text/plain', url)])))
    with pytest.raises(library.LibraryError, match='non è supportato'):
        asyncio.run(library.import_book(11))


def test_download_never_follows_redirect_outside_gutenberg(monkeypatch):
    requests = []

    def handler(request):
        requests.append(request.url.host)
        if request.url.path.endswith('.rdf'):
            return httpx.Response(200, content=rdf())
        return httpx.Response(302, headers={'location': 'http://127.0.0.1/private'})

    mock_http(monkeypatch, handler)
    with pytest.raises(library.LibraryError, match='libro completo'):
        asyncio.run(library.import_book(11))
    assert set(requests) == {'www.gutenberg.org'}


@pytest.mark.parametrize('content', [b'', b'2,000 characters of garbage', b'*** START OF THE PROJECT GUTENBERG EBOOK ALICE ***\nOnly the beginning', b'<html>Temporarily unavailable</html>'])
def test_incomplete_or_invalid_files_never_become_training_corpora(monkeypatch, content):
    mock_http(monkeypatch, lambda request: httpx.Response(200, content=rdf() if request.url.path.endswith('.rdf') else content))
    with pytest.raises(library.LibraryError, match='libro completo'):
        asyncio.run(library.import_book(11))


def test_import_tries_declared_txt_if_generated_txt_fails(monkeypatch):
    def handler(request):
        if request.url.path.endswith('.rdf'):
            return httpx.Response(200, content=rdf())
        if request.url.path.startswith('/cache/'):
            return httpx.Response(503)
        return httpx.Response(200, content=full_txt())

    mock_http(monkeypatch, handler)
    events = asyncio.run(collect_events())
    assert any(event.get('stage') == 'retrying' for event in events)
    assert events[-1]['book']['text'] == 'C’era una volta un tè.'


def test_import_retries_slow_metadata(monkeypatch):
    attempts = 0

    def handler(request):
        nonlocal attempts
        if request.url.path.endswith('.rdf'):
            attempts += 1
            if attempts == 1:
                raise httpx.ReadTimeout('timeout', request=request)
            return httpx.Response(200, content=rdf())
        return httpx.Response(200, content=full_txt())

    mock_http(monkeypatch, handler)
    events = asyncio.run(collect_events())
    assert attempts == 2
    assert any(event.get('stage') == 'retrying' for event in events)
    assert events[-1]['type'] == 'complete'


def test_oversized_books_are_rejected_instead_of_truncated(monkeypatch):
    monkeypatch.setattr(library, 'MAX_CORPUS_BYTES', 100)
    mock_http(monkeypatch, lambda request: httpx.Response(200, content=rdf() if request.url.path.endswith('.rdf') else full_txt('A' * 1000)))
    with pytest.raises(library.LibraryError, match='estratto') as error:
        asyncio.run(library.import_book(11))
    assert error.value.status_code == 422


def test_validate_corpus_preserves_full_text_for_create_and_update(monkeypatch):
    text = 'inizio ' + 'è' * 400000 + ' fine'
    assert library.validate_corpus(text) is text
    monkeypatch.setattr(library, 'MAX_CORPUS_BYTES', 100)
    with pytest.raises(library.LibraryError):
        library.validate_corpus(text)


def test_import_reports_missing_book(monkeypatch):
    mock_http(monkeypatch, lambda request: httpx.Response(404))
    with pytest.raises(library.LibraryError) as error:
        asyncio.run(library.import_book(11))
    assert error.value.status_code == 404


def catalog_gzip():
    stream = io.StringIO()
    writer = csv.DictWriter(stream, fieldnames=['Text#', 'Type', 'Title', 'Language', 'Authors'])
    writer.writeheader()
    writer.writerows([
        {'Text#': '52484', 'Type': 'Text', 'Title': 'Le avventure di Pinocchio', 'Language': 'it', 'Authors': 'Collodi, Carlo'},
        {'Text#': '19517', 'Type': 'Sound', 'Title': 'Le avventure di Pinocchio', 'Language': 'it', 'Authors': 'Collodi, Carlo'},
        {'Text#': '500', 'Type': 'Text', 'Title': 'The Adventures of Pinocchio', 'Language': 'en', 'Authors': 'Collodi, Carlo'},
        {'Text#': '1000', 'Type': 'Text', 'Title': 'La Divina Commedia', 'Language': 'it', 'Authors': 'Dante Alighieri'},
        {'Text#': '12345', 'Type': 'Text', 'Title': 'Un caffè', 'Language': 'it', 'Authors': 'Autore'},
    ])
    return gzip.compress(stream.getvalue().encode())


@pytest.fixture
def empty_catalog(monkeypatch, tmp_path):
    monkeypatch.setenv('TOY_LM_LIBRARY_CACHE_DIR', str(tmp_path))
    monkeypatch.setattr(catalog, '_catalog', [])
    monkeypatch.setattr(catalog, '_loaded_at', 0.0)
    monkeypatch.setattr(catalog, '_refresh_task', None)
    monkeypatch.setattr(catalog, '_lock', asyncio.Lock())
    return tmp_path


def test_official_catalog_search_is_cached_and_excludes_audio(monkeypatch, empty_catalog):
    requests = []

    def handler(request):
        requests.append(str(request.url))
        assert str(request.url) == catalog.CATALOG_URL
        return httpx.Response(200, content=catalog_gzip())

    mock_http(monkeypatch, handler)
    first = asyncio.run(library.search_books('Pinocchio', 'it'))
    second = asyncio.run(library.search_books('Collodi', 'en'))
    assert [b['id'] for b in first['results']] == [52484]
    assert [b['id'] for b in second['results']] == [500]
    assert len(requests) == 1
    assert (empty_catalog / 'catalog.csv.gz').exists()
    assert asyncio.run(library.search_books('caffe', 'it'))['results'][0]['title'] == 'Un caffè'


def test_persisted_catalog_works_without_any_network(monkeypatch, empty_catalog):
    (empty_catalog / 'catalog.csv.gz').write_bytes(catalog_gzip())

    def handler(request):
        raise AssertionError('Search should use the persisted catalog')

    mock_http(monkeypatch, handler)
    assert asyncio.run(library.search_books('Pinocchio', 'it'))['results'][0]['id'] == 52484


def test_stale_catalog_survives_provider_failure(monkeypatch, empty_catalog):
    monkeypatch.setattr(catalog, '_catalog', catalog._parse_catalog(catalog_gzip()))
    monkeypatch.setattr(catalog, '_loaded_at', time.time() - 2 * catalog.CATALOG_TTL)
    mock_http(monkeypatch, lambda request: httpx.Response(503))

    async def check():
        result = await library.search_books('Pinocchio', 'it')
        await catalog._refresh_task
        return result

    assert asyncio.run(check())['results'][0]['id'] == 52484
    assert len(catalog._catalog) == 4


def test_catalog_pagination(monkeypatch, empty_catalog):
    monkeypatch.setattr(catalog, '_catalog', catalog._parse_catalog(catalog_gzip()))
    monkeypatch.setattr(catalog, '_loaded_at', time.time())
    monkeypatch.setattr(catalog, 'PAGE_SIZE', 1)
    first = asyncio.run(library.search_books('Pinocchio'))
    second = asyncio.run(library.search_books('Pinocchio', page=2))
    assert first['total'] == 2 and first['hasNext'] is True
    assert second['hasNext'] is False
    assert first['results'][0]['id'] != second['results'][0]['id']
    assert '_search' not in first['results'][0]
