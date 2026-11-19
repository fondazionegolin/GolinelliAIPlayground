"""One bounded generation budget and diagnostic trace, independent of provider/model names."""
import asyncio
import contextvars
import time
from dataclasses import dataclass, field

from app.services.llm_service import LLMResponse, llm_service

TOTAL_SECONDS = 1200.0  # a finished, verified project beats a fast broken one: the quality loop needs room
STREAM_SECONDS = 240.0
IDLE_SECONDS = 75.0
REPAIR_SECONDS = 60.0
MAX_OUTPUT_TOKENS = 128_000  # ceiling accepted by every enabled provider (verified); output limits are 4x the old ones on purpose
MAX_CALLS = 60  # architect + up to 4 writers + their self-repair + continuation/gate/conformance passes


@dataclass
class Run:
    primary: tuple[str, str]
    fallback: tuple[str, str]
    started: float = field(default_factory=time.monotonic)
    calls: list = field(default_factory=list)
    recovery: list = field(default_factory=list)

    def timeout(self, seconds):
        remaining = TOTAL_SECONDS - (time.monotonic() - self.started)
        if remaining <= 0: raise TimeoutError('generation budget')
        return min(seconds, remaining)

    def begin(self, provider, model, kind):
        if len(self.calls) >= MAX_CALLS: raise RuntimeError('Limite di chiamate della generazione raggiunto')
        call = {'provider': provider, 'model': model, 'kind': kind, 'status': 'running'}
        self.calls.append(call)
        return call

    def diagnostic(self):
        return {'elapsed_ms': round((time.monotonic() - self.started) * 1000), 'calls': self.calls,
                'recovery': self.recovery, 'limit_seconds': TOTAL_SECONDS}


current: contextvars.ContextVar[Run | None] = contextvars.ContextVar('vibe_run', default=None)


async def generate(**kwargs):
    """Non-streaming call (repairs, continuations, format recovery). Inside a run it is served through
    `stream` with hidden reasoning off: a hard per-call deadline used to kill reasoning models mid-answer
    (60 s timeouts with nothing saved), while the stream is bounded by inactivity and the run budget."""
    phase = kwargs.pop('phase', 'completion')
    run = current.get()
    if run is None:
        # Small helper calls outside a run (interview, checklist): reasoning models would think silently for
        # minutes on a non-streaming call, so those providers go through the stream with thinking off.
        if kwargs.get('provider') in ('deepseek', 'openrouter') and not any(isinstance(m.get('content'), list) for m in kwargs.get('messages') or []):
            parts = [c async for c in llm_service.generate_stream(thinking=False, **{k: v for k, v in kwargs.items() if k != 'anthropic_options'})]
            text = ''.join(parts)
            return LLMResponse(content=text, provider=kwargs['provider'], model=kwargs.get('model') or '',
                               prompt_tokens=sum(len(str(m.get('content', ''))) for m in kwargs.get('messages', [])) // 4, completion_tokens=len(text) // 4)
        return await llm_service.generate(**kwargs)
    if kwargs.get('max_tokens'): kwargs['max_tokens'] = min(kwargs['max_tokens'], MAX_OUTPUT_TOKENS)
    # All verification/repair helpers stay within the section's model policy as well.
    kwargs.setdefault('provider', run.primary[0]); kwargs.setdefault('model', run.primary[1])
    kwargs.pop('anthropic_options', None)
    if any(isinstance(m.get('content'), list) for m in kwargs.get('messages') or []):
        # Image input (screenshot review): provider adapters take it only on the non-streaming path.
        call = run.begin(kwargs['provider'], kwargs['model'], phase)
        start = time.monotonic()
        try:
            async with asyncio.timeout(run.timeout(120.0)):
                value = await llm_service.generate(**kwargs)
            call.update(status='completed', response_chars=len(value.content or ''), prompt_tokens=getattr(value, 'prompt_tokens', None), completion_tokens=getattr(value, 'completion_tokens', None))
            return value
        except BaseException as exc:
            call.update(status='timeout' if isinstance(exc, TimeoutError) else 'cancelled' if isinstance(exc, asyncio.CancelledError) else 'error', error_type=type(exc).__name__)
            raise
        finally: call['elapsed_ms'] = round((time.monotonic() - start) * 1000)
    kwargs.setdefault('thinking', False)
    parts: list[str] = []
    async for chunk in stream(phase=phase, **kwargs):
        parts.append(chunk)
    call = run.calls[-1]
    return LLMResponse(content=''.join(parts), provider=kwargs['provider'], model=kwargs['model'],
                       prompt_tokens=call.get('prompt_tokens') or 0, completion_tokens=call.get('completion_tokens') or 0)


async def stream(**kwargs):
    """Bound provider inactivity and total time; close the provider iterator on every exit."""
    phase = kwargs.pop('phase', 'codegen')
    if kwargs.get('max_tokens'): kwargs['max_tokens'] = min(kwargs['max_tokens'], MAX_OUTPUT_TOKENS)
    run = current.get()
    if run is None:
        async for chunk in llm_service.generate_stream(**kwargs): yield chunk
        return
    call = run.begin(kwargs.get('provider'), kwargs.get('model'), phase)
    start = time.monotonic(); chars = 0; thinking = 0
    sink = kwargs.get('reasoning_sink')
    loop = asyncio.get_running_loop()
    idle = asyncio.timeout(IDLE_SECONDS)
    def reasoning(text):
        nonlocal thinking
        thinking += len(text)
        if text and not idle.expired(): idle.reschedule(loop.time() + IDLE_SECONDS)
        if sink: sink(text)
    kwargs.update(reasoning_sink=reasoning, allow_web_search=False)
    iterator = llm_service.generate_stream(**kwargs)
    try:
        async with asyncio.timeout(run.timeout(STREAM_SECONDS)), idle:
            first = True
            while True:
                try:
                    chunk = await anext(iterator)
                except StopAsyncIteration: break
                if not chunk: continue
                idle.reschedule(loop.time() + IDLE_SECONDS)
                if first: call['first_text_ms'] = round((time.monotonic() - start) * 1000)
                first = False; chars += len(chunk)
                if chars > 1_000_000: raise RuntimeError('Output della generazione troppo esteso')
                yield chunk
        if not chars: raise RuntimeError('Il modello non ha restituito testo utilizzabile')
        call['status'] = 'completed'
    except BaseException as exc:
        call.update(status='timeout' if isinstance(exc, TimeoutError) else 'cancelled' if isinstance(exc, asyncio.CancelledError) else 'error', error_type=type(exc).__name__)
        raise
    finally:
        call.update(elapsed_ms=round((time.monotonic() - start) * 1000), response_chars=chars, reasoning_chars=thinking)
        prompt_chars = len(kwargs.get('system_prompt') or '') + sum(
            len(str(message.get('content', ''))) for message in kwargs.get('messages', [])
        )
        call.update(prompt_tokens=(prompt_chars + 3) // 4, completion_tokens=(chars + thinking + 3) // 4)
        await iterator.aclose()


async def events(source, run):
    token = current.set(run)
    try:
        async with asyncio.timeout(TOTAL_SECONDS):
            async for chunk in source: yield chunk
    except TimeoutError:
        yield 'data: {"type":"error","code":"generation_timeout","message":"La generazione ha raggiunto il limite di tempo. La versione precedente è conservata; riprova con una modifica più piccola."}\n\n'
    finally:
        await source.aclose()
        current.reset(token)
