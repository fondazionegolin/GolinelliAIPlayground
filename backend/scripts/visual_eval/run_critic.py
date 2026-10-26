"""Applies the art-direction reviewer to dumped scenes, using a PNG render of each (from the frontend evalDumps test).

Usage (inside the api container): python -m scripts.visual_eval.run_critic DIR case [case ...]
Reads DIR/<case>.json and DIR/<case>-render.png, writes the reviewed scene back as `scene_reviewed` + `review`.
"""
import asyncio
import base64
import json
import sys
import time
from pathlib import Path

from app.services.visual_dialogue import Inventory
from app.services.visual_comprehension import Grounding
from app.services.visual_review import review_drawing


async def main():
    out = Path(sys.argv[1])
    for name in sys.argv[2:]:
        dump = json.loads((out / f"{name}.json").read_text())
        png = "data:image/png;base64," + base64.b64encode((out / f"{name}-render.png").read_bytes()).decode()
        grounding = Grounding.model_validate({"subject": "x", "overview": "x", "regions": dump["regions"]})
        usage = []

        async def on_usage(response, stage):
            usage.append(response.completion_tokens)
        started = time.monotonic()
        source = "data:image/png;base64," + base64.b64encode((out / f"{name}.png").read_bytes()).decode()
        scene, review, applied = await review_drawing(png, dump["scene"], grounding, dump["message"], dump.get("issues", []), on_usage, source=source,
                                                     request=dump.get("prompt", ""))
        dump.update(scene_reviewed=scene, review={**review.model_dump(), "applied": applied, "seconds": round(time.monotonic() - started, 1)})
        (out / f"{name}.json").write_text(json.dumps(dump, ensure_ascii=False, indent=1))
        print(name, review.verdict, {k: getattr(review, k) for k in ("insight", "legibility", "alignment", "clarity", "restraint")},
              f"ops={len(review.ops)} applied={applied}", review.notes)


if __name__ == "__main__":
    asyncio.run(main())
