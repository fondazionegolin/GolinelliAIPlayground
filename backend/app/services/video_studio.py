"""Video Studio pipeline: source text -> screenplay -> reference sheets + keyframes -> 5 s shots -> final cut.

Visual consistency strategy
  1. The LLM "director" writes a *style bible* and a cast of entities (characters, objects, settings),
     each with one locked, detailed visual description reused verbatim in every prompt.
  2. Each entity gets a reference sheet image (GPT image). Every shot keyframe is generated with the
     sheets of the entities in that shot plus the previous keyframe as reference images, so the same
     character / object keeps its look across framings.
  3. Each shot becomes a 5 s clip (animatic: slow camera move + narration caption, ffmpeg) and the
     clips are concatenated. Image-to-video via Runware (runware_service) can replace step 3 later.
"""
import asyncio
import base64
import io
import logging
import textwrap
import os
import subprocess
import tempfile
import time
import uuid
from typing import Any, Optional

from sqlalchemy import select

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.video_project import VideoProject
from app.services.json_extract import extract_json
from app.services.llm_service import llm_service
from app.services.storage_service import storage_service

logger = logging.getLogger(__name__)

SHOT_SECONDS = 5
MAX_SHOTS = 12

STYLES: dict[str, dict] = {
    "flat_2d": {"label": "Illustrazione 2D piatta", "prompt": "flat 2D vector illustration, clean shapes, bold solid colors, minimal shading, friendly educational explainer style"},
    "watercolor": {"label": "Acquerello", "prompt": "soft watercolor illustration, visible paper texture, gentle color bleeding, hand-painted children's science book style"},
    "pixar_3d": {"label": "3D animato", "prompt": "stylized 3D animated film look, soft global illumination, rounded friendly shapes, vivid colors, subsurface scattering"},
    "paper_cutout": {"label": "Paper cut-out", "prompt": "layered paper cut-out collage, handmade craft look, soft drop shadows between layers, matte colors"},
    "scientific": {"label": "Illustrazione scientifica", "prompt": "scientific textbook illustration, precise labelled-diagram look, clean linework, muted natural palette on a light background"},
    "clay": {"label": "Claymation", "prompt": "claymation stop-motion look, handmade plasticine textures, soft studio lighting, shallow depth of field"},
    "documentary": {"label": "Documentario realistico", "prompt": "photorealistic nature-documentary cinematography, natural light, shallow depth of field, high detail"},
    "isometric": {"label": "Infografica isometrica", "prompt": "isometric 3D infographic style, clean geometric forms, pastel palette, soft shadows, white background"},
}

# gpt-image sizes (image) and delivered video size per aspect ratio.
ASPECTS = {
    "16:9": {"image": "1536x1024", "w": 1280, "h": 720},
    "9:16": {"image": "1024x1536", "w": 720, "h": 1280},
    "1:1": {"image": "1024x1024", "w": 960, "h": 960},
}
IMAGE_COST_EST_USD = 0.05  # rough per-image estimate (medium quality); the API does not return a cost

_LANG = {"it": "italiano", "en": "English"}

DIRECTOR_SYSTEM = """You are a director and screenwriter of short educational documentary videos.
Turn the source material into a screenplay of visually-driven shots of exactly {seconds} seconds each.
The video is understood mainly through images: every shot must SHOW a concept (process, structure, cause/effect), not just a talking head.

Return ONLY a JSON object:
{{
  "title": "short video title",
  "logline": "one sentence on what the viewer will understand",
  "style_bible": "2-3 sentences, English: palette, lighting, camera language, mood. Applies to every shot.",
  "entities": [
    {{"id": "e1", "name": "...", "kind": "character|object|setting",
      "description": "English. ONE locked, concrete visual description (shape, colors, size, materials, distinctive marks). Reused verbatim in every shot, so be specific and visual."}}
  ],
  "shots": [
    {{"n": 1, "title": "...",
      "narration": "voice-over text in {language}, 1-2 short sentences that fit {seconds} seconds",
      "visual": "English. The STILL composition at the first frame: framing, what is where, which entities are present. No text/labels in the image.",
      "motion": "English. What moves during {seconds} seconds and how the camera moves. One simple action, no cuts.",
      "entities": ["e1"]}}
  ]
}}
Rules: exactly {n_shots} shots; at most 5 entities; keep the same entity ids across shots; one simple continuous action per shot;
never put readable text in images; scientifically accurate; level: {level}."""


def build_style_prefix(project: VideoProject) -> str:
    style = STYLES.get(project.style_key, STYLES["flat_2d"])["prompt"]
    bible = (project.script or {}).get("style_bible", "")
    return f"{style}. {bible}".strip()


async def generate_script(project: VideoProject) -> dict:
    n_shots = int(max(2, min(MAX_SHOTS, project.target_shots or 6)))
    system = DIRECTOR_SYSTEM.format(
        seconds=SHOT_SECONDS,
        n_shots=n_shots,
        language=_LANG.get(project.language, project.language),
        level="clear for secondary-school students",
    )
    user = f"SOURCE MATERIAL:\n{project.source_text[:24000]}"
    if project.brief:
        user = f"DIRECTOR'S BRIEF (what to convey and how):\n{project.brief}\n\n{user}"
    resp = await llm_service.generate(
        [{"role": "user", "content": user}],
        system_prompt=system,
        temperature=0.6,
        max_tokens=6000,
        allow_web_search=False,
    )
    data = extract_json(resp.content)
    shots = []
    for i, s in enumerate(data.get("shots") or [], start=1):
        shots.append({
            "n": i,
            "title": str(s.get("title") or f"Shot {i}"),
            "narration": str(s.get("narration") or ""),
            "visual": str(s.get("visual") or ""),
            "motion": str(s.get("motion") or ""),
            "entities": [str(e) for e in (s.get("entities") or [])],
            "status": "pending",
        })
    if not shots:
        raise ValueError("Lo script generato non contiene shot")
    entities = [
        {"id": str(e.get("id")), "name": str(e.get("name", "")), "kind": str(e.get("kind", "object")),
         "description": str(e.get("description", ""))}
        for e in (data.get("entities") or []) if e.get("id")
    ]
    return {
        "title": str(data.get("title") or project.title),
        "logline": str(data.get("logline") or ""),
        "style_bible": str(data.get("style_bible") or ""),
        "entities": entities,
        "shots": shots[:MAX_SHOTS],
    }


# ── background runs ──────────────────────────────────────────────────────────

_running: dict[uuid.UUID, asyncio.Task] = {}


def is_running(project_id: uuid.UUID) -> bool:
    t = _running.get(project_id)
    return bool(t and not t.done())


def launch(project_id: uuid.UUID, coro_factory) -> None:
    task = asyncio.create_task(coro_factory(project_id))
    _running[project_id] = task
    task.add_done_callback(lambda _t: _running.pop(project_id, None))


async def _save(project_id: uuid.UUID, mutate) -> None:
    """Re-load the project, apply mutate(project, script) to a fresh copy of the script and commit."""
    async with AsyncSessionLocal() as db:
        project = await db.get(VideoProject, project_id)
        if not project:
            return
        script = dict(project.script or {})
        mutate(project, script)
        project.script = script  # reassign so JSONB change is detected
        await db.commit()


async def _put(key: str, data: bytes, content_type: str) -> None:
    await asyncio.to_thread(storage_service.upload_file, key, data, content_type)


async def _get(key: str) -> bytes:
    return await asyncio.to_thread(storage_service.download_file, key)


async def _gpt_image(prompt: str, size: str, refs: list[bytes]) -> bytes:
    """One image via OpenAI gpt-image. With references it uses images.edit (multi-image input)."""
    client = llm_service.openai_client
    if client is None:
        raise RuntimeError("OPENAI_API_KEY non configurata")
    model = settings.OPENAI_IMAGE_MODEL
    quality = settings.VIDEO_STUDIO_IMAGE_QUALITY
    if refs:
        files = [(f"ref{i}.jpg", data, "image/jpeg") for i, data in enumerate(refs[:8])]
        resp = await client.images.edit(model=model, image=files, prompt=prompt, n=1, size=size, quality=quality)
    else:
        resp = await client.images.generate(model=model, prompt=prompt, n=1, size=size, quality=quality)
    b64 = resp.data[0].b64_json
    if not b64:
        raise RuntimeError("Il modello immagine non ha restituito dati")
    return base64.b64decode(b64)


def _jpeg(png: bytes) -> bytes:
    from PIL import Image
    with Image.open(io.BytesIO(png)) as im:
        out = io.BytesIO()
        im.convert("RGB").save(out, format="JPEG", quality=92)
        return out.getvalue()


async def run_storyboard(project_id: uuid.UUID, only_shots: Optional[list[int]] = None) -> None:
    """Reference sheets for entities, then one keyframe per shot (sequential: each uses the previous)."""
    async with AsyncSessionLocal() as db:
        project = await db.get(VideoProject, project_id)
        script = project.script
        prefix = build_style_prefix(project)
        size = ASPECTS.get(project.aspect, ASPECTS["16:9"])["image"]
        base = f"video-studio/{project_id}"
    entities = {e["id"]: e for e in script.get("entities", [])}
    made = 0
    try:
        for ent in entities.values():
            if ent.get("sheet_key"):
                continue
            await _save(project_id, lambda p, s, ent=ent: setattr(p, "phase_label", f"Scheda: {ent['name']}"))
            kind_hint = (
                "environment concept art, wide establishing view" if ent.get("kind") == "setting"
                else "single subject on a plain neutral background, centered, full view, character/object reference sheet"
            )
            png = await _gpt_image(f"{prefix}. {kind_hint}. {ent['name']}: {ent['description']}. No text, no labels.", size, [])
            key = f"{base}/sheet_{ent['id']}.jpg"
            await _put(key, _jpeg(png), "image/jpeg")
            made += 1
            ver = int(time.time())

            def apply(p, s, ent=ent, key=key, ver=ver):
                for e in s.get("entities", []):
                    if e["id"] == ent["id"]:
                        e["sheet_key"], e["sheet_ver"] = key, ver
            await _save(project_id, apply)
            ent["sheet_key"] = key

        prev_key: Optional[str] = None
        total = len(script.get("shots", []))
        for shot in script.get("shots", []):
            n = shot["n"]
            if only_shots and n not in only_shots:
                prev_key = shot.get("keyframe_key") or prev_key
                continue
            if shot.get("keyframe_key") and not only_shots:
                prev_key = shot["keyframe_key"]
                continue
            await _save(project_id, lambda p, s, n=n: setattr(p, "phase_label", f"Immagine shot {n}/{total}"))
            ref_keys = [entities[e]["sheet_key"] for e in shot.get("entities", []) if e in entities and entities[e].get("sheet_key")]
            if prev_key:
                ref_keys.append(prev_key)
            refs = [await _get(k) for k in ref_keys]
            cast = "; ".join(
                f"{entities[e]['name']}: {entities[e]['description']}" for e in shot.get("entities", []) if e in entities
            )
            prompt = (
                f"{prefix}. {shot['visual']}. Cast (keep their exact appearance from the reference images): {cast}. "
                "Keep the same visual style, palette and character designs as the reference images. "
                "Keep the key subject in the central area of the frame. No text or labels."
            )
            png = await _gpt_image(prompt, size, refs)
            key = f"{base}/key_{n}.jpg"
            jpg = _jpeg(png)
            await _put(key, jpg, "image/jpeg")
            made += 1
            prev_key = key
            ver = int(time.time())

            def apply_shot(p, s, n=n, key=key, ver=ver):
                for sh in s.get("shots", []):
                    if sh["n"] == n:
                        sh.update(keyframe_key=key, keyframe_ver=ver, status="keyframe", error=None)
                        sh.pop("video_key", None)  # clip is stale once the image changes
            await _save(project_id, apply_shot)

        def done(p, s):
            p.status, p.phase_label, p.error = "storyboard_ready", None, None
            p.final_key = None
            p.cost_usd = (p.cost_usd or 0) + made * IMAGE_COST_EST_USD
        await _save(project_id, done)
    except Exception as exc:  # noqa: BLE001
        logger.exception("video studio storyboard failed")
        msg = str(exc) or exc.__class__.__name__

        def fail(p, s):
            p.status, p.phase_label, p.error = "failed", None, msg
            p.cost_usd = (p.cost_usd or 0) + made * IMAGE_COST_EST_USD
        await _save(project_id, fail)


FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def _clip_from_image(image: bytes, caption: str, width: int, height: int, zoom_in: bool, seconds: int) -> bytes:
    """5 s clip: slow zoom (Ken Burns) on the keyframe plus the narration as a caption."""
    frames = seconds * 25
    with tempfile.TemporaryDirectory() as tmp:
        img = os.path.join(tmp, "in.jpg")
        out = os.path.join(tmp, "out.mp4")
        with open(img, "wb") as fh:
            fh.write(image)
        zoom = (
            "min(zoom+0.0007,1.18)" if zoom_in else "if(eq(on,0),1.18,max(zoom-0.0007,1.0))"
        )
        vf = (
            f"scale={width * 2}:{height * 2}:force_original_aspect_ratio=increase,crop={width * 2}:{height * 2},"
            f"zoompan=z='{zoom}':d={frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s={width}x{height}:fps=25"
        )
        if caption.strip():
            cap = os.path.join(tmp, "cap.txt")
            lines = textwrap.wrap(caption.strip(), width=44 if width >= height else 30)[:4]
            with open(cap, "w", encoding="utf-8") as fh:
                fh.write(chr(10).join(lines))
            vf += (
                f",drawtext=textfile={cap}:fontfile={FONT_PATH}:fontcolor=white:fontsize={max(22, height // 26)}"
                f":box=1:boxcolor=black@0.55:boxborderw=14:line_spacing=6:x=(w-text_w)/2:y=h-text_h-{height // 14}"
            )
        cmd = ["ffmpeg", "-y", "-loop", "1", "-i", img, "-vf", vf, "-t", str(seconds), "-r", "25",
               "-c:v", "libx264", "-preset", "fast", "-crf", "21", "-pix_fmt", "yuv420p", "-an", out]
        proc = subprocess.run(cmd, capture_output=True, timeout=300)
        if proc.returncode != 0:
            raise RuntimeError(f"ffmpeg: {proc.stderr.decode(errors='ignore')[-400:]}")
        with open(out, "rb") as fh:
            return fh.read()


async def run_animatic(project_id: uuid.UUID, only_shots: Optional[list[int]] = None) -> None:
    """Turn each keyframe into a 5 s clip, then assemble the final cut."""
    async with AsyncSessionLocal() as db:
        project = await db.get(VideoProject, project_id)
        script = project.script
        dims = ASPECTS.get(project.aspect, ASPECTS["16:9"])
        base = f"video-studio/{project_id}"
    shots = [s for s in script.get("shots", []) if s.get("keyframe_key") and (not only_shots or s["n"] in only_shots)]
    if not only_shots:
        shots = [s for s in shots if not s.get("video_key")]
    failures: list[str] = []
    try:
        for shot in shots:
            n = shot["n"]
            await _save(project_id, lambda p, s, n=n: setattr(p, "phase_label", f"Montaggio shot {n}"))
            try:
                image = await _get(shot["keyframe_key"])
                clip = await asyncio.to_thread(
                    _clip_from_image, image, shot.get("narration", ""), dims["w"], dims["h"], n % 2 == 1, SHOT_SECONDS
                )
                key = f"{base}/shot_{n}.mp4"
                await _put(key, clip, "video/mp4")
                ver = int(time.time())

                def ok(p, s, n=n, key=key, ver=ver):
                    for sh in s.get("shots", []):
                        if sh["n"] == n:
                            sh.update(video_key=key, video_ver=ver, status="video", error=None)
                await _save(project_id, ok)
            except Exception as exc:  # noqa: BLE001
                logger.exception("video studio clip %s failed", n)
                failures.append(f"shot {n}: {exc}")

                def bad(p, s, n=n, msg=str(exc)):
                    for sh in s.get("shots", []):
                        if sh["n"] == n:
                            sh["status"], sh["error"] = "failed", msg
                await _save(project_id, bad)
    finally:
        if failures:
            msg = "; ".join(failures)[:900]
            await _save(project_id, lambda p, s: (setattr(p, "status", "storyboard_ready"), setattr(p, "error", msg), setattr(p, "phase_label", None)))
    if not failures:
        await run_assemble(project_id)


def _concat(clips: list[bytes]) -> bytes:
    with tempfile.TemporaryDirectory() as tmp:
        lines = []
        for i, data in enumerate(clips):
            path = os.path.join(tmp, f"c{i}.mp4")
            with open(path, "wb") as fh:
                fh.write(data)
            lines.append(f"file '{path}'")
        listing = os.path.join(tmp, "list.txt")
        with open(listing, "w") as fh:
            fh.write("\n".join(lines))
        out = os.path.join(tmp, "out.mp4")
        cmd = ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", listing,
               "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p",
               "-movflags", "+faststart", out]
        proc = subprocess.run(cmd, capture_output=True, timeout=600)
        if proc.returncode != 0:
            raise RuntimeError(f"ffmpeg: {proc.stderr.decode(errors='ignore')[-400:]}")
        with open(out, "rb") as fh:
            return fh.read()


async def run_assemble(project_id: uuid.UUID) -> None:
    async with AsyncSessionLocal() as db:
        project = await db.get(VideoProject, project_id)
        keys = [s["video_key"] for s in sorted(project.script.get("shots", []), key=lambda x: x["n"]) if s.get("video_key")]
    if not keys:
        await _save(project_id, lambda p, s: (setattr(p, "error", "Nessuno shot montato"), setattr(p, "status", "storyboard_ready")))
        return
    try:
        await _save(project_id, lambda p, s: (setattr(p, "status", "rendering"), setattr(p, "phase_label", "Montaggio finale")))
        clips = [await _get(k) for k in keys]
        final = await asyncio.to_thread(_concat, clips)
        key = f"video-studio/{project_id}/final.mp4"
        await _put(key, final, "video/mp4")

        def done(p, s):
            p.final_key, p.status, p.phase_label, p.error = key, "done", None, None
        await _save(project_id, done)
    except Exception as exc:  # noqa: BLE001
        logger.exception("video studio assemble failed")
        msg = str(exc)

        def fail(p, s):
            p.status, p.phase_label, p.error = "failed", None, msg
        await _save(project_id, fail)
