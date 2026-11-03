import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.services import deep_research as research
from app.services.deep_crawler import Crawler, FetchedPage, topic_words
from app.services.research_sources import scoped_queries, source_kind


def test_plan_preserves_scope_user_urls_and_unique_section_ids():
    plan = research.normalize_plan({
        'title': 'Energia', 'topic': 'Prezzi energia Italia', 'request': 'Notizie energia in Italia nel 2025',
        'constraints': 'Italia, solo 2025', 'seed_urls': ['https://www.istat.it/energia', 'http://127.0.0.1/no'],
        'subtopics': [{'id': 'x', 'title': 'Prezzi'}, {'id': 'x', 'title': 'Misure'}],
    })
    assert plan['constraints'] == 'Italia, solo 2025' and plan['news']
    assert plan['request'] == 'Notizie energia in Italia nel 2025'
    assert plan['seed_urls'][0] == 'https://www.istat.it/energia'
    assert len({s['id'] for s in plan['subtopics']}) == 2


def test_generic_research_words_do_not_make_an_unrelated_link_relevant():
    assert topic_words('ricerca approfondita sulle ultime notizie energia') == {'energia'}
    queries = scoped_queries('energia Italia 2025', 'energia Italia', True)
    assert any('site:ansa.it' in q for q in queries)
    assert any('site:euronews.com' in q for q in queries)
    assert any('site:reuters.com' in q for q in queries)
    assert source_kind('https://www.istat.it/report') == 'primary'
    assert source_kind('https://ansa.it.evil.invalid/fake') == 'web'


def test_feed_reader_understands_rss_atom_dates_and_rejects_entities():
    crawler = object.__new__(Crawler)
    rss = '<rss><channel><item><title>Energia</title><link>https://www.rainews.it/articolo/energia</link><description>Prezzi in Italia</description><pubDate>Mon, 02 Nov 2026 09:00:00 GMT</pubDate></item></channel></rss>'
    result = crawler._parse_feed('https://www.rainews.it/rss/tutti', 'https://www.rainews.it/rss/tutti', rss)
    assert result.feed_entries[0]['published_at'].startswith('Mon, 02 Nov')
    assert result.feed_entries[0]['url'].endswith('/articolo/energia')
    atom = '<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Energia UE</title><link rel="self" href="/api/id"/><link href="/article"/><published>2026-11-02</published></entry></feed>'
    assert crawler._parse_feed('https://example.org/feed', 'https://example.org/feed', atom).feed_entries[0]['url'] == 'https://example.org/article'
    assert crawler._parse_feed('x', 'x', '<!DOCTYPE a [<!ENTITY b "bad">]><rss/>').error


def test_article_body_wins_over_portal_navigation_and_retains_date():
    page = object.__new__(Crawler)._parse('https://example.org/article', 'https://example.org/article', '''
      <html><head><title>Energia Italia</title><meta property="article:published_time" content="2026-11-02"/></head>
      <body><main>Notizie sport e politica<article><header><h1>Energia Italia</h1></header><p>Il dato specifico del rapporto.</p></article>Altre notizie generiche</main></body></html>''', 1000)
    assert 'sport' not in page.text and 'dato specifico' in page.text
    assert page.published_at == '2026-11-02'


@pytest.mark.asyncio
async def test_reader_requires_relevance_and_a_literal_passage(monkeypatch):
    run = research._Run('test', 'test', research.ResearchState(), '')
    run.plan = {'request': 'Prezzi energia Italia 2025', 'constraints': 'solo Italia, anno 2025'}
    quote = 'Il prezzo medio italiano è diminuito del 12 per cento nel 2025.'
    page = FetchedPage('https://www.istat.it/energia', 'https://www.istat.it/energia', title='Energia', text=quote + ' Altri dettagli del rapporto.' * 20, published_at='2026-01-02')
    llm = AsyncMock(return_value=json.dumps({'relevance': .95, 'facts': [
        {'text': 'Calo del 12% in Italia nel 2025', 'evidence': quote},
        {'text': 'Dato inventato', 'evidence': 'Un passaggio inesistente nella pagina consultata.'},
    ]}))
    monkeypatch.setattr(run, 'llm', llm)
    try:
        facts = await research._read_page(run, {'id': 's1', 'title': 'Prezzi'}, page, 0, 'crawler')
        assert len(facts) == 1 and facts[0].evidence == quote
        assert run.state.sources[0]['published_at'] == '2026-01-02'
        assert 'Prezzi energia Italia 2025' in llm.call_args.args[1]
        llm.return_value = json.dumps({'relevance': .2, 'facts': [{'text': 'Fuori tema', 'evidence': quote}]})
        assert await research._read_page(run, {'id': 's2', 'title': 'Altro'}, page, 0, 'crawler') == []
        assert len(run.state.sources) == 1
    finally:
        await run.crawler.close()


@pytest.mark.asyncio
async def test_low_novelty_does_not_stop_an_uncovered_section(monkeypatch):
    state = research.ResearchState(facts=[research.Fact('Fatto disponibile su prezzi energia Italia', 1, 's1')], sources=[{'n': 1, 'url': 'https://www.istat.it/energia', 'title': 'Rapporto'}])
    run = research._Run('test', 'test', state, '')
    run.plan = {'topic': 'energia Italia', 'constraints': '2025'}
    monkeypatch.setattr(run, 'llm', AsyncMock(return_value='{"covered":[0],"gaps":[]}'))
    try:
        _, gaps = await research._analyze_round(run, [{'id': 's1', 'title': 'Prezzi'}, {'id': 's2', 'title': 'Interventi'}], state.facts, state.facts, 2)
        assert 's2' in gaps and 'energia Italia' in gaps['s2'][0]
    finally:
        await run.crawler.close()


def test_inline_citations_link_only_to_read_sources_and_round_trip():
    sources = [{'n': 1, 'title': 'Rapporto ufficiale', 'url': 'https://www.istat.it/report', 'publisher': 'ISTAT', 'published_at': '2026-01-02'}]
    text = research.link_citations('Un dato [1]. Inventato [9]. [Falso](https://invalid.example/fake).', sources)
    assert '[1](<https://www.istat.it/report>)' in text
    assert '[9]' not in text and 'https://invalid.example/fake' not in text
    body, restored = research.split_sources(text + '\n\n' + research.sources_markdown(sources))
    assert body == text and restored[0]['url'] == sources[0]['url']


@pytest.mark.asyncio
async def test_discovery_anchors_queries_and_does_not_read_off_topic_hits(monkeypatch):
    run = research._Run('test', 'test', research.ResearchState(), '')
    run.plan = {'topic': 'energia Italia', 'request': 'Prezzi energia Italia', 'news': False}
    searches = []
    def search(query, news=False):
        searches.append(query)
        return [SimpleNamespace(url='https://www.istat.it/energia', title='Prezzi energia Italia', snippet='Rapporto specifico'),
                SimpleNamespace(url='https://example.org/sport', title='Ricerca approfondita calcio', snippet='Ultime notizie')]
    monkeypatch.setattr(research, '_search_sync', search)
    monkeypatch.setattr(research, 'wikipedia_seeds', AsyncMock(return_value=[]))
    fetch = AsyncMock(return_value=FetchedPage('https://www.istat.it/energia', 'https://www.istat.it/energia', text='Pagina di prova'))
    monkeypatch.setattr(run, 'fetch', fetch)
    monkeypatch.setattr(research, '_read_page', AsyncMock(return_value=[]))
    try:
        await research._crawl_subtopic(run, {'id': 's1', 'title': 'Prezzi'}, ['andamento prezzi'], 1, [])
        assert searches and all('energia Italia' in q for q in searches)
        assert fetch.await_count == 1 and 'istat.it' in fetch.call_args.args[0]
    finally:
        await run.crawler.close()


def test_a_shared_year_is_not_evidence_of_topic_relevance():
    assert topic_words('notizie 2026 energia') == {'energia'}
    from app.services.research_sources import primary_domains
    assert 'mim.gov.it' in primary_domains('intelligenza artificiale scuola')
    for query in scoped_queries('intelligenza artificiale site:mim.gov.it', 'scuola', True)[1:]:
        assert 'site:mim.gov.it' not in query


def test_approved_news_toggle_is_preserved():
    assert not research.normalize_plan({'request': 'ultime notizie', 'news': False})['news']


def test_search_rejects_results_outside_requested_publisher(monkeypatch):
    import ddgs
    class Search:
        def __init__(self, **kw): pass
        def text(self, *args, **kwargs):
            assert kwargs['backend'] != 'auto'
            return [{'title': 'Intelligenza', 'href': 'https://it.wikipedia.org/wiki/Intelligenza'},
                    {'title': 'Scuola e IA', 'href': 'https://www.ansa.it/scuola/ia'}]
    monkeypatch.setattr(ddgs, 'DDGS', Search)
    rows = research._search_sync('intelligenza artificiale scuola site:ansa.it')
    assert [r.url for r in rows] == ['https://www.ansa.it/scuola/ia']


def test_official_mirrors_are_not_independent_confirmations():
    from app.services.research_sources import source_origin
    assert source_origin('https://scuolafutura.pubblica.istruzione.it/ia') == source_origin('https://www.mim.gov.it/ia')
    assert source_origin('https://www.bbc.co.uk/news') == source_origin('https://www.bbc.com/news')
    assert source_origin('https://it.euronews.com/article') == source_origin('https://www.euronews.com/article')


@pytest.mark.asyncio
async def test_native_discovery_urls_still_have_to_pass_the_reader(monkeypatch):
    run = research._Run('openai', 'test', research.ResearchState(), '')
    run.plan = {'topic': 'energia Italia', 'request': 'Prezzi energia Italia', 'news': False}
    monkeypatch.setattr(research, '_search_sync', lambda *a: [])
    monkeypatch.setattr(research, 'wikipedia_seeds', AsyncMock(return_value=[]))
    llm = AsyncMock(return_value=json.dumps({'sources': [{'title': 'Energy report', 'url': 'https://www.istat.it/energia', 'snippet': 'Specific data'}]}))
    monkeypatch.setattr(run, 'llm', llm)
    monkeypatch.setattr(run, 'fetch', AsyncMock(return_value=FetchedPage('https://www.istat.it/energia', 'https://www.istat.it/energia', error='HTTP 403')))
    try:
        facts = await research._crawl_subtopic(run, {'id': 's1', 'title': 'Prezzi'}, ['andamento prezzi'], 1, [])
        assert facts == [] and not run.state.sources
        assert llm.call_args.kwargs['web_search']
    finally:
        await run.crawler.close()
