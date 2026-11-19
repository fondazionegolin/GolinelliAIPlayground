import pytest

from app.services import vibe_qa


def project(css, jsx):
    return [{'path': 'styles.css', 'content': css}, {'path': 'App.tsx', 'content': jsx}]


def test_css_gaps_find_classes_without_rules():
    files = project('.btn { color: red } /* .ghost { } */', '''export default function App(){
      const on = true
      return <div className="app hero"><button className={`btn ${on ? 'active' : ''}`}>x</button><p className="ghost">y</p></div>}''')
    gaps = vibe_qa.css_gaps(files)
    assert set(gaps) == {'app', 'hero', 'ghost'}  # `btn` is defined; the commented `.ghost` rule does not count
    total, styled = vibe_qa.css_coverage(files)
    assert (total, styled) == (4, 1)


def test_css_gaps_respect_companion_stylesheets():
    files = [{'path': 'components/Card.css', 'content': '.card { padding: 8px } .card-title { font-weight: 700 }'},
             {'path': 'components/Card.tsx', 'content': "export default () => <div className=\"card\"><h2 className='card-title'>t</h2></div>"}]
    assert vibe_qa.css_gaps(files) == {}


def test_defects_rank_blockers_first_and_score_reflects_them():
    files = project('body{margin:0}', 'export default function App(){return <div className="x">a</div>}')
    report = {
        'typecheck': {'errors': [{'file': 'App.tsx', 'line': 3, 'code': 'TS2339', 'message': "Property 's' does not exist"}, {'file': 'App.tsx', 'line': 1, 'code': 'TS6133', 'message': 'unused'}]},
        'build': {'ok': True},
        'runtime': {'ran': True, 'viewports': [
            {'name': 'mobile', 'blank': False, 'overflowX': True, 'overflowing': ['div.row (900px)'], 'smallTapTargets': ['button.brand'], 'axe': [{'id': 'color-contrast', 'impact': 'serious', 'help': 'Contrasto', 'count': 3, 'nodes': [{'target': '.x'}]}]},
            {'name': 'desktop', 'blank': True, 'pageErrors': ['boom']},
        ]},
        'crawl': {'crashes': [{'control': 'Inizia', 'message': 'x is undefined'}], 'deadControls': ['a', 'b', 'c']},
        'acceptance': [{'id': 'T1', 'feature': 'F1', 'title': 'Quiz', 'passed': False, 'failedStep': 2, 'step': 'click Avanti', 'error': 'non trovato'}],
    }
    defects = vibe_qa.defects_from_report(report, files)
    kinds = [(d.severity, d.kind) for d in defects]
    assert kinds[0][0] == 'blocker'
    assert ('major', 'types') in kinds and ('major', 'responsive') in kinds and ('major', 'a11y') in kinds and ('major', 'flow') in kinds and ('major', 'css') in kinds
    assert not any('TS6133' in d.message for d in defects)  # unused variable is not a defect
    card = vibe_qa.scorecard(report, files, defects)
    assert card['overall'] <= 40 and card['browser_checked'] and not vibe_qa.is_good(card, defects)


def test_clean_project_scores_high_and_passes():
    files = project('.app{display:grid}', 'export default () => <div className="app">ok</div>')
    report = {'typecheck': {'errors': []}, 'build': {'ok': True}, 'runtime': {'ran': True, 'viewports': [{'name': 'desktop', 'textLength': 300, 'axe': []}]}, 'crawl': {}, 'acceptance': []}
    defects = vibe_qa.defects_from_report(report, files)
    card = vibe_qa.scorecard(report, files, defects, {'score': 92})
    assert defects == [] and card['overall'] >= 90 and vibe_qa.is_good(card, defects)


def test_without_browser_only_static_dimensions_count():
    files = project('', 'export default () => <div className="a b c">x</div>')
    card = vibe_qa.scorecard(None, files, vibe_qa.defects_from_report({}, files))
    assert card['runtime'] is None and card['styling'] == 0 and card['browser_checked'] is False


def test_acceptance_tests_are_extracted_and_sanitised():
    spec = '# P\n## Test di accettazione\n```json\n[{"id":"T1","feature":"F1","title":"x","steps":[{"do":"click","text":"Avvia"},{"do":"rm -rf"},{"do":"expectText","text":"Fatto"}]},{"id":"T2","steps":[]}]\n```\n'
    tests = vibe_qa.extract_tests(spec)
    assert len(tests) == 1 and [s['do'] for s in tests[0]['steps']] == ['click', 'expectText']
    assert vibe_qa.clean_tests('not a list') == []


@pytest.mark.asyncio
async def test_run_degrades_when_service_is_absent(monkeypatch):
    monkeypatch.setattr(vibe_qa.settings, 'VIBE_QA_URL', '', raising=False)
    assert not vibe_qa.available()
    assert await vibe_qa.run(project('', 'x')) is None


def test_literal_backslash_in_jsx_text_is_a_visible_defect():
    files = project('.a{}', "export default () => <p className=\"a\">Come funziona l\\'affinità</p>")
    defects = vibe_qa.defects_from_report({}, files)
    assert any(d.kind == 'visual' and "affinità" in d.message for d in defects)
    ok = project('.a{}', "const s = 'l\\'uso'; export default () => <p className=\"a\">{s} l'affinità</p>")
    assert not [d for d in vibe_qa.defects_from_report({}, ok) if d.kind == 'visual']
