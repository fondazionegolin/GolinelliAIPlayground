import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.services import js_imports, vibe_gate, vibe_output, vibe_pipeline, vibe_quality, vibe_runs, vibe_verify
from app.api.v1.endpoints import coding


def project(extra=''):
    return [{'path': 'App.tsx', 'content': 'export default function App(){ return <div>Hello</div> }'},
            {'path': 'styles.css', 'content': 'body { margin:0 }'},
            {'path': 'types.ts', 'content': extra}]


@pytest.mark.parametrize('literal', [
    "const stopwords = ['by','from','not'];",
    '''const text = "import 'missing-pkg'";''',
    "// import Missing from 'missing-pkg'\n/* export * from 'other' */",
    "const source = `import x from 'missing-pkg'`;",
    '''const pattern = /import 'missing-pkg'/;''',
    "const hint = 'process.env.SECRET and createRoot(';",
])
def test_validator_ignores_literals_and_comments(literal):
    assert not vibe_gate.blocking(vibe_gate.static_issues(project(literal)))
    assert not coding._check_broken_imports(project(literal))


def test_module_imports_positions_and_actual_dependencies():
    code = "// import 'fake'\nimport {\n Thing\n} from 'real-package';\nexport * from './types';\nconst x=import('dynamic');\nconst fs=require('node:fs');\nimport './styles.css'"
    assert [name for name, _ in js_imports.module_imports(code)] == ['real-package', './types', 'dynamic', 'node:fs', './styles.css']
    issues = vibe_gate.static_issues(project(code))
    assert any(i.rule == 'no-node-module' for i in issues)
    assert next(i for i in issues if 'real-package' in i.message).line == 2
    assert not coding._extract_relative_imports("const data=['from','./not-a-module'];")
    assert coding._extract_relative_imports("export { x } from './actual'") == ['./actual']


def test_validator_still_catches_browser_contract_violations():
    issues = vibe_gate.static_issues(project("import x from 'next/navigation';\ndocument.getElementById('root');\nprocess.env.TOKEN"))
    assert {'no-next', 'no-root-lookup', 'no-process-env'} <= {i.rule for i in issues}


@pytest.mark.asyncio
async def test_real_bundler_catches_missing_export_but_accepts_stopwords():
    issues, ran = await vibe_gate.check_project(project("export const words=['by','from','not']"))
    assert ran and not vibe_gate.blocking(issues)
    files = project('export const OTHER = []')
    files[0]['content'] = "import { DEMO_USERS } from './types'; export default function App(){return <div>{DEMO_USERS.length}</div>}"
    issues, ran = await vibe_gate.check_project(files)
    assert ran and any('No matching export' in i.message for i in issues)


@pytest.mark.parametrize('raw', [
    '=== FILE: App.tsx ===\nexport default function App(){return null}\n=== END ===',
    '{"files":[{"path":"App.tsx","content":"export default function App(){return null}"}]}',
    '[{"filename":"App.tsx","code":"export default function App(){return null}"}]',
    '```json\n{"App.tsx":"export default function App(){return null}"}\n```',
    '### App.tsx\n```tsx\nexport default function App(){return null}\n```',
    '```tsx filename=App.tsx\nexport default function App(){return null}\n```',
])
def test_recovers_provider_independent_file_formats(raw):
    assert [f['path'] for f in vibe_output.recover_files(raw)] == ['App.tsx']


@pytest.mark.parametrize('path', ['../App.tsx', '/App.tsx', 'C:/App.tsx', 'a/../App.tsx', 'main.tsx', 'index.html', 'description.md'])
def test_recovery_rejects_unsafe_and_platform_files(path):
    assert vibe_output.recover_files(json.dumps({'files': [{'path': path, 'content': 'code'}]})) == []


def test_truncated_output_is_not_recovered_as_complete():
    assert not vibe_output.recover_files('=== FILE: App.tsx ===\nexport default function App(){')
    assert not vibe_output.recover_files('```tsx\nexport default function App(){return null}\n```')


def test_quality_and_manual_edit_invalidation():
    files = project('')
    validation = vibe_quality.assessment(files, bundler_ran=True)
    validation['runtime'] = 'observed'
    old = {'validation': validation}
    assert vibe_quality.saved_artifacts(files, previous=old)['validation']['runtime'] == 'observed'
    edited = project('export const changed=1')
    forged = {'validation': validation}
    new = vibe_quality.saved_artifacts(edited, previous=old, supplied=forged)['validation']
    assert new['source_hash'] != validation['source_hash']
    assert new['build'] == new['runtime'] == 'not_checked'
    assert vibe_quality.saved_artifacts(files, supplied=forged)['validation']['build'] == 'not_checked'
    assert vibe_quality.build_status({**validation, 'runtime': 'failed'}) == 'needs_review'
    assert vibe_quality.build_status({**validation, 'features': 'not_checked', 'features_required': True}) == 'needs_review'


@pytest.mark.parametrize('raw', ['', 'not json', '{"results":[]}', '{"results":[{"id":"F1","status":"ok"}]}'])
def test_malformed_or_partial_conformance_is_never_a_pass(raw):
    assert not vibe_verify.valid_assessment(raw, [('F1','One'),('F2','Two')])


def test_complete_conformance_assessment():
    assert vibe_verify.valid_assessment('{"results":[{"id":"F1","status":"ok"}]}', [('F1', 'One')])


@pytest.mark.asyncio
async def test_silent_model_times_out_and_closes_stream(monkeypatch):
    closed = []
    async def model(**kwargs):
        try:
            await asyncio.sleep(5)
            yield 'late'
        finally: closed.append(True)
    monkeypatch.setattr(vibe_pipeline.llm_service, 'generate_stream', model)
    monkeypatch.setattr(vibe_pipeline, 'IDLE_SECONDS', .02)
    run = vibe_pipeline.Run(('vendor','model'),('vendor','model'))
    token = vibe_pipeline.current.set(run)
    try:
        with pytest.raises(TimeoutError):
            _ = [s async for s in vibe_pipeline.stream(provider='vendor', model='model')]
    finally: vibe_pipeline.current.reset(token)
    assert closed and run.calls[0]['status'] == 'timeout'
    assert run.calls[0]['response_chars'] == 0


@pytest.mark.asyncio
async def test_reasoning_and_code_refresh_idle_deadline(monkeypatch):
    async def model(**kwargs):
        for _ in range(5):
            await asyncio.sleep(.015)
            kwargs['reasoning_sink']('thinking')
        for _ in range(5):
            await asyncio.sleep(.015)
            yield 'code'
    monkeypatch.setattr(vibe_pipeline.llm_service, 'generate_stream', model)
    monkeypatch.setattr(vibe_pipeline, 'IDLE_SECONDS', .06)
    run = vibe_pipeline.Run(('vendor', 'model'), ('vendor', 'model'))
    token = vibe_pipeline.current.set(run)
    try:
        assert [chunk async for chunk in vibe_pipeline.stream()] == ['code'] * 5
    finally:
        vibe_pipeline.current.reset(token)


@pytest.mark.asyncio
async def test_allowed_fallback_and_partial_stream_recovery(monkeypatch):
    calls=[]
    async def model(**kwargs):
        calls.append((kwargs['provider'], kwargs['model']))
        if kwargs['model'] == 'primary': raise RuntimeError('provider down')
        yield '=== FILE: App.tsx ===\nexport default function App(){return null}\n=== END ==='
    monkeypatch.setattr(vibe_pipeline.llm_service, 'generate_stream', model)
    run=vibe_pipeline.Run(('vendor','primary'),('enabled-vendor','fallback'))
    token=vibe_pipeline.current.set(run)
    try:
        text=''.join([v async for v in coding._coding_generate_stream([], '', provider='vendor',model='primary')])
        assert vibe_output.recover_files(text)
    finally: vibe_pipeline.current.reset(token)
    assert calls == [('vendor','primary'),('enabled-vendor','fallback')]
    assert run.recovery[0]['reason'] == 'stream_unavailable'


@pytest.mark.asyncio
async def test_run_deadline_is_an_error_and_context_is_cleaned(monkeypatch):
    closed=[]
    async def source():
        try:
            await asyncio.sleep(5)
            yield 'unexpected'
        finally: closed.append(True)
    monkeypatch.setattr(vibe_pipeline, 'TOTAL_SECONDS', .02)
    run=vibe_pipeline.Run(('v','m'),('v','m'))
    result=''.join([v async for v in vibe_pipeline.events(source(),run)])
    assert 'generation_timeout' in result and closed
    assert vibe_pipeline.current.get() is None


@pytest.mark.asyncio
async def test_start_guard_rejects_active_job_without_entering_body(monkeypatch):
    session=SimpleNamespace(scalar=AsyncMock(side_effect=[True,SimpleNamespace(id=uuid4())]))
    class Scope:
        async def __aenter__(self):return session
        async def __aexit__(self,*args):pass
    monkeypatch.setattr(vibe_runs,'AsyncSessionLocal',Scope)
    with pytest.raises(HTTPException) as exc:
        async with vibe_runs.generation_start(uuid4(),uuid4()):
            pytest.fail('duplicate request entered generation')
    assert exc.value.status_code == 409 and exc.value.detail['job_id']


@pytest.mark.asyncio
async def test_start_guard_rejects_concurrent_start_before_job_exists(monkeypatch):
    session=SimpleNamespace(scalar=AsyncMock(return_value=False))
    class Scope:
        async def __aenter__(self):return session
        async def __aexit__(self,*args):pass
    monkeypatch.setattr(vibe_runs,'AsyncSessionLocal',Scope)
    with pytest.raises(HTTPException) as exc:
        async with vibe_runs.generation_start(uuid4(),uuid4()):pytest.fail('duplicate start')
    assert exc.value.status_code == 409
    assert session.scalar.await_count == 1


@pytest.mark.asyncio
@pytest.mark.parametrize('provider', ['openai','anthropic','openrouter','deepseek','gemini'])
async def test_public_stream_closes_provider_on_early_exit(monkeypatch, provider):
    from app.services.llm_service import LLMService
    service=object.__new__(LLMService)
    closed=[]
    async def source(*args,**kwargs):
        try:
            yield 'first'
            await asyncio.sleep(5)
        finally:closed.append(True)
    monkeypatch.setattr(service,'_stream_'+provider,source)
    iterator=service.generate_stream([],provider=provider,model='test',allow_web_search=False)
    assert await anext(iterator)=='first'
    await iterator.aclose()
    assert closed


@pytest.mark.asyncio
@pytest.mark.parametrize('provider', ['openai','deepseek','gemini'])
async def test_sdk_stream_is_closed_on_early_exit(provider):
    from app.services.llm_service import LLMService
    class SDK:
        async def __aiter__(self):
            yield SimpleNamespace(choices=[SimpleNamespace(delta=SimpleNamespace(content='first'))])
            await asyncio.sleep(5)
        close=AsyncMock()
    stream=SDK()
    service=object.__new__(LLMService)
    setattr(service,provider+'_client',SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=AsyncMock(return_value=stream)))))
    iterator=service.generate_stream([],provider=provider,model='test',allow_web_search=False)
    assert await anext(iterator)=='first'
    await iterator.aclose()
    stream.close.assert_awaited()


def test_explicit_unsupported_stack_does_not_match_teaching_content():
    assert vibe_output.requires_unsupported_stack('Scrivi in Python 3 un programma VeriBot')
    assert not vibe_output.requires_unsupported_stack('Crea un sito per un corso dal titolo Scrivi in Python')


def test_changing_brief_preserves_build_but_invalidates_feature_verdict():
    files=project('')+[{'path':'spec.md','content':'F1: Greeting'}]
    validation=vibe_quality.assessment(files,bundler_ran=True,features_checked=True)
    validation['runtime']='observed'
    changed=project('')+[{'path':'spec.md','content':'F1: Greeting\nF2: Search'}]
    result=vibe_quality.saved_artifacts(changed,previous={'validation':validation})['validation']
    assert result['build']=='passed' and result['runtime']=='observed'
    assert result['features']=='not_checked' and result['features_required']
    assert vibe_quality.build_status(result)=='needs_review'


@pytest.mark.asyncio
@pytest.mark.parametrize('path,content', [
    ('App.tsx', "import data from '/etc/passwd'; export default function App(){return null}"),
    ('App.tsx', "import data from '../private.json'; export default function App(){return null}"),
    ('App.tsx', r"import data from '\u002e\u002e/private.json'; export default function App(){return null}"),
    ('App.tsx', 'const load = (name) => import(`../../private/${name}.json`); export default function App(){return null}'),
    ('styles.css', '@import "/etc/private.css";'),
    ('styles.css', 'body{background:url(../../private.png)}'),
])
async def test_bundler_never_reads_outside_project(monkeypatch,path,content):
    spawn=AsyncMock(side_effect=AssertionError('unsafe imports reached bundler'))
    monkeypatch.setattr(vibe_gate.asyncio,'create_subprocess_exec',spawn)
    files=[f for f in project('') if f['path']!=path]+[{'path':path,'content':content}]
    issues,ran=await vibe_gate.build_check(files)
    assert not ran and any(i.rule=='outside-project-import' for i in issues)
    spawn.assert_not_awaited()


def test_css_text_and_safe_asset_paths_are_not_outside_imports():
    files=[{'path':'styles.css','content':'/* @import "/etc/fake"; */\n.x{content:"url(/etc/fake)";background:url(https://example.test/image.png)}'},
           {'path':'components/App.tsx','content':"import x from '../types'; export default function App(){return null}"}]
    assert not vibe_gate.unsafe_imports(files)


@pytest.mark.asyncio
async def test_vibe_team_uses_admin_roles_and_skips_keyless_providers(monkeypatch):
    roles = {'coding.teacher': ('anthropic', 'architect'), 'coding.student': ('deepseek', 'student-architect'),
             'coding.writer': ('openrouter', 'z-ai/glm-5.3')}
    monkeypatch.setattr(coding.model_roles, 'pair_for', lambda role: roles[role])
    keys = {'anthropic': True, 'deepseek': True, 'openrouter': True}
    monkeypatch.setattr(coding.model_selection, 'provider_keys', lambda: keys)
    assert await coding._vibe_team(None, False) == (('anthropic', 'architect'), ('openrouter', 'z-ai/glm-5.3'))
    assert await coding._vibe_team(None, True) == (('deepseek', 'student-architect'), ('openrouter', 'z-ai/glm-5.3'))
    keys['openrouter'] = False
    assert await coding._vibe_team(None, False) == (('anthropic', 'architect'), ('anthropic', 'architect'))
    keys.update(openrouter=True, anthropic=False)
    assert await coding._vibe_team(None, False) == (('openrouter', 'z-ai/glm-5.3'), ('openrouter', 'z-ai/glm-5.3'))


@pytest.mark.asyncio
async def test_parallel_writers_repair_only_their_own_build_errors(monkeypatch):
    architect = ("piano\n@@PLAN@@\n1 | App.tsx | app | export default function App()\n"
                 "2 | components/Card.tsx | card | export default function Card()\n@@SHARED@@\n"
                 "=== FILE: types.ts ===\nexport type T = string\n=== END ===\n")
    writers = {'1': "=== FILE: App.tsx ===\nimport Card from './components/Card'\nexport default function App(){return <Card/>}\n=== END ===\n",
               '2': "=== FILE: components/Card.tsx ===\nexport default function Card(){return <div>{</div>}\n=== END ===\n"}
    seen = []

    async def fake_stream(messages, system_prompt, *, provider, model, phase='codegen', **_):
        seen.append((phase, provider, model))
        if phase == 'architect':
            yield architect
        else:
            yield writers['1' if 'WORKER 1' in messages[0]['content'] else '2']

    async def fake_check(files, allowed=None):
        return [vibe_gate.Issue('components/Card.tsx', 'Unexpected }', line=1, rule='esbuild')], True

    repairs = []

    async def fake_repair(files, issues, provider, model, brief):
        # Like _gate_repair: returns the merged project. The model also (wrongly) rewrote App.tsx.
        repairs.append((provider, model, [i.file for i in issues], brief))
        by_path = {f['path']: f for f in files}
        by_path['components/Card.tsx'] = {'path': 'components/Card.tsx', 'content': 'export default function Card(){return <div/>}'}
        by_path['App.tsx'] = {'path': 'App.tsx', 'content': 'export default function App(){return null} // not mine'}
        return list(by_path.values()), ['components/Card.tsx', 'App.tsx'], 0, 0
    monkeypatch.setattr(coding, '_coding_generate_stream', fake_stream)
    monkeypatch.setattr(coding.vibe_gate, 'check_project', fake_check)
    monkeypatch.setattr(coding, '_gate_repair', fake_repair)

    frames = [f async for f in coding._parallel_build('ctx', 'anthropic', 'architect', writer=('openrouter', 'glm'), brief='BRIEF')]
    result = frames[-1][1]
    assert result['ok'] and result['self_repaired'] == ['components/Card.tsx']
    files = {f['path']: f['content'] for f in result['generated']}
    assert files['components/Card.tsx'] == 'export default function Card(){return <div/>}'
    assert 'not mine' not in files['App.tsx']  # worker 2 may not rewrite worker 1's file
    assert repairs == [('openrouter', 'glm', ['components/Card.tsx'], 'BRIEF')]
    assert seen[0] == ('architect', 'anthropic', 'architect')
    assert sorted(seen[1:]) == [('writer', 'openrouter', 'glm')] * 2


@pytest.mark.parametrize('source', [
    "export default function R(){\n  return <div><p>Ecco l'elenco delle fotocamere</p></div>\n}\n",
    "export default function R(){\n  const n = 3\n  return <p>L'utente ha {n} scelte e dell'altro {n}</p>\n}",
    'export const t = "dell\'obiettivo";\nexport const u = \'l\\\'uso\';',
])
def test_italian_apostrophes_in_text_do_not_look_truncated(source):
    assert vibe_output.looks_complete(source)


@pytest.mark.parametrize('source', [
    "export default function R(){\n  return <div>\n",
    "export const A = [\n  { id: 1, nome: 'Alpha' },\n  { id: 2, nome: 'Be",
    "export const t = `ciao ${x",
    "export const A = ",
])
def test_real_truncation_is_still_detected(source):
    assert not vibe_output.looks_complete(source)


def test_output_limits_are_four_times_larger_and_bounded():
    assert vibe_pipeline.MAX_OUTPUT_TOKENS == 128_000
    import inspect
    text = inspect.getsource(coding._parallel_build)
    assert 'max_tokens=128000' in text and 'max_tokens=56000' in text
