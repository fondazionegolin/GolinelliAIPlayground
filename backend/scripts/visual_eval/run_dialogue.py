"""Two-turn check of the ask-once-then-act flow: if the tutor asks, answer with the first options and expect it to build.

Usage (inside the api container): python -m scripts.visual_eval.run_dialogue OUT_DIR case "request"
"""
import asyncio
import json
import sys
import time
from pathlib import Path

from app.services.visual_dialogue import converse
from scripts.visual_eval.cases import CASES, data_url


async def main():
    out, name, request = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
    out.mkdir(parents=True, exist_ok=True)
    image = CASES[name][0]()
    url = data_url(image)

    async def on_usage(response, stage):
        pass
    messages, state, inventory, turns = [{"role": "user", "content": request}], {}, None, []
    for turn in range(2):
        started = time.monotonic()
        inv, state, reply = await converse(url, inventory, state, messages, on_usage)
        inventory = inv.model_dump()
        scene = reply["focus"].get("drawing")
        turns.append({"seconds": round(time.monotonic() - started, 1), "action": state.get("action"), "questions": reply.get("questions"),
                      "message": reply["content"][:400], "sliders": [len(e["plot"]["sliders"]) for e in (scene or {}).get("elements", []) if e["kind"] == "plot" and e.get("plot")],
                      "widgets": reply.get("widgets"), "drawing_failed": reply["focus"].get("drawing_failed", False)})
        print(json.dumps(turns[-1], ensure_ascii=False))
        messages.append({"role": "assistant", **reply})
        if not reply.get("questions"):
            break
        answers = "Risposte:\n" + "\n".join(f"• {q['question']} → {q['options'][0]}" for q in reply["questions"])
        messages.append({"role": "user", "content": answers})
    (out / f"{name}.png").write_bytes(__import__("base64").b64decode(url.split(",", 1)[1]))
    (out / f"{name}.json").write_text(json.dumps({"case": name, "ok": True, "width": image.width, "height": image.height, "regions": inventory["grounding"]["regions"],
                                                 "message": reply["content"], "scene": scene, "turns": turns, "widgets": state.get("widgets")}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    asyncio.run(main())
