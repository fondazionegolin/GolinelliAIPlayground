"""Runs the visual tutor on the golden set against the configured provider and stores scene, latency and tokens.

Usage (inside the api container):  python -m scripts.visual_eval.run_eval OUT_DIR [case ...]
Then render the dumps in the frontend:  VC_EVAL_DIR=OUT_DIR npx vitest run render
"""
import asyncio
import json
import os
import sys
import time
from pathlib import Path

from app.services import model_roles
from app.services.visual_dialogue import converse
from app.services.visual_selection import Selection
from scripts.visual_eval.cases import CASES, data_url


async def run_case(name: str, out: Path):
    make, prompt, *rest = CASES[name]
    selection = Selection.model_validate(rest[0]) if rest else None
    image = make()
    url = data_url(image)
    usage = []

    async def on_usage(response, stage):
        usage.append({"stage": stage, "prompt_tokens": response.prompt_tokens, "completion_tokens": response.completion_tokens,
                      "at": round(time.monotonic() - started, 1)})

    started = time.monotonic()
    result = {"case": name, "prompt": prompt, "width": image.width, "height": image.height, "selection": rest[0] if rest else None}
    try:
        inventory, state, reply = await converse(url, None, {}, [{"role": "user", "content": prompt}], on_usage, selection=selection)
        result.update(ok=True, regions=[r.model_dump() for r in inventory.grounding.regions],
                      message=reply["content"], scene=reply["focus"].get("drawing"))
    except Exception as exc:  # the point of the harness is to see failures too
        result.update(ok=False, error=f"{type(exc).__name__}: {exc}")
    result.update(seconds=round(time.monotonic() - started, 1), usage=usage)
    (out / f"{name}.png").write_bytes(__import__("base64").b64decode(url.split(",", 1)[1]))
    (out / f"{name}.json").write_text(json.dumps(result, ensure_ascii=False, indent=1))
    print(f"{name}: ok={result['ok']} {result['seconds']}s calls={len(usage)} tokens_out={sum(u['completion_tokens'] or 0 for u in usage)}")


async def main():
    # VC_TUTOR=provider:model overrides the director/tutor role for A/B runs.
    if os.environ.get("VC_TUTOR"):
        provider, model = os.environ["VC_TUTOR"].split(":", 1)
        model_roles.set_local("vision.tutor", provider, model)
    out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
    for name in sys.argv[2:] or list(CASES):
        await run_case(name, out)


if __name__ == "__main__":
    asyncio.run(main())
