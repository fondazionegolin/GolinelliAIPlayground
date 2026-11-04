"""Video Studio pipeline: source text -> screenplay -> reference sheets + keyframes -> 5 s shots -> final cut.

Visual consistency strategy
  1. The LLM "director" writes a *style bible* and a cast of entities (characters, objects, settings),
     each with one locked, detailed visual description reused verbatim in every prompt.
  2. Each entity gets a reference sheet image (GPT image). Every shot keyframe is generated with the
     sheets of the entities in that shot plus the previous keyframe as reference images, so the same
     character / object keeps its look across framings.
  3. Each shot becomes a 5 s clip (animatic: slow camera move + narration caption, ffmpeg) and the
     clips are concatenated. Admins can also select OpenRouter image-to-video models for step 3.
"""
import asyncio
import base64
import copy
import hashlib
import io
import json
import logging
import textwrap
import os
import subprocess
import tempfile
import time
import uuid
import httpx
from typing import Any, Optional

from sqlalchemy import select

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.core.pricing import USD_TO_EUR
from app.models.user import User
from app.models.video_project import VideoProject
from app.services import background_jobs, voice_lab, voice_lab_billing
from app.services.credit_service import credit_service
from app.services.json_extract import extract_json
from app.services.llm_service import llm_service
from app.services.storage_service import storage_service
from app.services import openrouter

logger = logging.getLogger(__name__)

SHOT_SECONDS = 5
MAX_SHOTS = 12          # shots the director writes
MAX_TIMELINE = 40       # clips on the timeline (generated + uploaded)
TRANSITIONS = {  # ffmpeg xfade name -> Italian label ("none" = hard cut)
    "none": "Taglio netto", "fade": "Dissolvenza", "fadeblack": "Dissolvenza da nero", "fadewhite": "Dissolvenza da bianco",
    "wipeleft": "Tendina a sinistra", "wiperight": "Tendina a destra", "slideleft": "Scorrimento a sinistra",
    "slideright": "Scorrimento a destra", "circleopen": "Cerchio che si apre", "zoomin": "Zoom", "pixelize": "Pixel",
    "radial": "Radiale",
}
VOICE_CHARS_PER_SECOND = 14.0  # spoken Italian/English, used to size clips before the voice exists

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
# gpt-image list prices (USD, 1536x1024 / 1024x1536) per quality; the API does not return a cost.
IMAGE_COST_BY_QUALITY = {"low": 0.016, "medium": 0.063, "high": 0.25}
IMAGE_COST_EST_USD = IMAGE_COST_BY_QUALITY["medium"]

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


def new_id() -> str:
    return uuid.uuid4().hex[:8]


def ensure_ids(script: dict) -> dict:
    """Legacy projects have no stable shot ids: derive them once from the shot number."""
    for shot in script.get("shots", []):
        shot.setdefault("id", f"s{shot.get('n')}")
    return script


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
    user = f"SOURCE MATERIAL:\n{project.source_text[:12000]}"
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
            "id": new_id(),
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



INSERT_SYSTEM = """You are the director of a short educational video. The screenplay already exists; the user wants ONE new shot added.
Write that single shot so it fits the story: same tone, language, visual style and cast. It sits between the PREVIOUS and NEXT shots
(either may be missing) and must flow naturally from one to the other without repeating them.
Return ONLY a JSON object:
{{"title": "...", "narration": "voice-over in {language}, 1-2 short sentences that fit {seconds} seconds (empty string if the user wants no voice)",
 "visual": "English. The STILL composition at the first frame: framing, what is where, which cast members are present. No text/labels in the image.",
 "motion": "English. What moves during {seconds} seconds and how the camera moves. One simple action, no cuts.",
 "entities": ["ids of the existing cast members that appear"]}}
Use only these entity ids: {ids}. Never put readable text in images."""


async def draft_shot(project: VideoProject, script: dict, prompt: str, position: int) -> dict:
    """LLM: turn the user's request into a shot that fits the existing screenplay at `position`."""
    shots = script.get("shots", [])
    entities = script.get("entities", [])

    def brief(sh: Optional[dict]) -> str:
        if not sh:
            return "(none)"
        return f"{sh.get('title', '')} | narration: {sh.get('narration', '')} | visual: {sh.get('visual', '')}"

    context = (
        f"VIDEO: {script.get('title', project.title)}\nLOGLINE: {script.get('logline', '')}\nSTYLE BIBLE: {script.get('style_bible', '')}\n"
        "CAST:\n" + "\n".join(f"- {e['id']} {e.get('name', '')}: {e.get('description', '')}" for e in entities)
        + f"\n\nPREVIOUS SHOT: {brief(shots[position - 1] if 0 < position <= len(shots) else None)}"
        + f"\nNEXT SHOT: {brief(shots[position] if 0 <= position < len(shots) else None)}"
        + f"\n\nUSER REQUEST FOR THE NEW SHOT:\n{prompt.strip()[:2000]}"
    )
    system = INSERT_SYSTEM.format(seconds=SHOT_SECONDS, language=_LANG.get(project.language, project.language),
                                  ids=", ".join(e["id"] for e in entities) or "(none)")
    resp = await llm_service.generate([{"role": "user", "content": context}], system_prompt=system,
                                      temperature=0.6, max_tokens=1200, allow_web_search=False)
    data = extract_json(resp.content)
    known = {e["id"] for e in entities}
    visual = str(data.get("visual") or "").strip()
    if not visual:
        raise ValueError("Non sono riuscito a scrivere la clip: riprova con una descrizione più precisa")
    return {
        "id": new_id(), "n": 0, "title": str(data.get("title") or "Nuova clip")[:120],
        "narration": str(data.get("narration") or ""), "visual": visual, "motion": str(data.get("motion") or ""),
        "entities": [str(e) for e in (data.get("entities") or []) if str(e) in known], "status": "pending",
    }


async def run_insert_clip(project_id: uuid.UUID, shot_id: str) -> None:
    """Image, clip and voice for ONE new shot, then the final cut. Other clips are left untouched."""
    await run_storyboard(project_id, [shot_id])
    async with AsyncSessionLocal() as db:
        project = await db.get(VideoProject, project_id)
        if not project or project.status == "failed" or project.error:
            return
    await _save(project_id, lambda p, s: setattr(p, "status", "rendering"))
    await run_render(project_id, [shot_id])


# ── background runs ──────────────────────────────────────────────────────────

_running: set[uuid.UUID] = set()
_job_ctx: dict[uuid.UUID, background_jobs.JobContext] = {}
BUSY_STATUSES = ("storyboarding", "rendering", "scripting")


def is_running(project_id: uuid.UUID) -> bool:
    return project_id in _running


async def launch(project_id: uuid.UUID, coro_factory, *, owner: User, title: str, expected_seconds: float = 120,
                 description: Optional[str] = None) -> None:
    """Run a long step as a background job: survives page changes and shows in the navbar indicator."""
    _running.add(project_id)

    async def work(ctx: background_jobs.JobContext):
        _job_ctx[project_id] = ctx
        try:
            await coro_factory(project_id)
        except asyncio.CancelledError:
            def stop(p, s):
                p.status = "storyboard_ready" if any(x.get("keyframe_key") for x in s.get("shots", [])) else "script_ready"
                p.phase_label, p.error = None, "Operazione annullata"
            await asyncio.shield(_save(project_id, stop))
            raise
        finally:
            _job_ctx.pop(project_id, None)
            _running.discard(project_id)
        async with AsyncSessionLocal() as db:
            project = await db.get(VideoProject, project_id)
            if project and project.error:
                raise RuntimeError(project.error)
        return {"project_id": str(project_id)}

    try:
        await background_jobs.start_task_job(
            background_jobs.JobOwner(tenant_id=owner.tenant_id, user_id=owner.id),
            kind="video_studio", title=title, description=description,
            route=f"/teacher/video-studio/{project_id}", resource_id=str(project_id),
            expected_seconds=expected_seconds, work=work)
    except Exception:
        _running.discard(project_id)
        raise


async def _phase(project_id: uuid.UUID, label: str, fraction: Optional[float] = None) -> None:
    """Update the project's visible phase and the navbar job progress."""
    await _save(project_id, lambda p, s: setattr(p, "phase_label", label))
    ctx = _job_ctx.get(project_id)
    if ctx:
        await ctx.progress(fraction, label, force=True)


def reconcile_stale(project: VideoProject) -> bool:
    """A busy status with no live task means the server restarted mid-run: report it as interrupted."""
    if project.status in BUSY_STATUSES and project.id not in _running:
        has_images = any(x.get("keyframe_key") for x in (project.script or {}).get("shots", []))
        project.status = "storyboard_ready" if has_images else ("script_ready" if (project.script or {}).get("shots") else "draft")
        project.phase_label = None
        project.error = "Generazione interrotta (riavvio del server). Riavviala: ciò che era già pronto non viene rifatto né ripagato."
        return True
    return False


async def _save(project_id: uuid.UUID, mutate) -> None:
    """Re-load the project, apply mutate(project, script) to a fresh copy of the script and commit."""
    async with AsyncSessionLocal() as db:
        project = await db.get(VideoProject, project_id)
        if not project:
            return
        script = copy.deepcopy(project.script or {})
        ensure_ids(script)
        mutate(project, script)
        project.script = script  # reassign so JSONB change is detected
        await db.commit()


def _patch_shot(script: dict, shot_id: str, **fields) -> None:
    for sh in script.get("shots", []):
        if sh["id"] == shot_id:
            sh.update(fields)


async def _charge(project_id: uuid.UUID, provider: str, model: str, usd: float, detail: dict) -> None:
    """Add a real/estimated provider cost to the project and to the owner's credit budget."""
    if usd <= 0:
        return
    async with AsyncSessionLocal() as db:
        project = await db.get(VideoProject, project_id)
        if not project:
            return
        project.cost_usd = (project.cost_usd or 0) + usd
        owner = await db.get(User, project.owner_id)
        if owner and owner.tenant_id:
            await credit_service.track_usage(
                db, owner.tenant_id, provider, model, round(usd * USD_TO_EUR, 6),
                {"type": "video_studio", "service": "Video Studio", "project_id": str(project_id), **detail},
                teacher_id=owner.id,
            )
        await db.commit()


async def _put(key: str, data: bytes, content_type: str) -> None:
    await asyncio.to_thread(storage_service.upload_file, key, data, content_type)


async def _get(key: str) -> bytes:
    return await asyncio.to_thread(storage_service.download_file, key)


def image_cost_usd() -> float:
    return IMAGE_COST_BY_QUALITY.get(settings.VIDEO_STUDIO_IMAGE_QUALITY, IMAGE_COST_EST_USD)


async def _gpt_image(prompt: str, size: str, refs: list[bytes], quality: Optional[str] = None) -> bytes:
    """One image via OpenAI gpt-image. With references it uses images.edit (multi-image input)."""
    client = llm_service.openai_client
    if client is None:
        raise RuntimeError("OPENAI_API_KEY non configurata")
    model = settings.OPENAI_IMAGE_MODEL
    quality = quality or settings.VIDEO_STUDIO_IMAGE_QUALITY
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


def sheet_entities(script: dict) -> set[str]:
    """Reference sheets only pay off for entities that recur: single-use ones live in the shot prompt."""
    counts: dict[str, int] = {}
    for shot in script.get("shots", []):
        for e in shot.get("entities", []):
            counts[e] = counts.get(e, 0) + 1
    return {e for e, n in counts.items() if n >= 2}


async def run_storyboard(project_id: uuid.UUID, only_shots: Optional[list[str]] = None) -> None:
    """Reference sheets for recurring entities, then one keyframe per shot (sequential: each uses the previous)."""
    async with AsyncSessionLocal() as db:
        project = await db.get(VideoProject, project_id)
        script = ensure_ids(copy.deepcopy(project.script))
        prefix = build_style_prefix(project)
        size = ASPECTS.get(project.aspect, ASPECTS["16:9"])["image"]
        base = f"video-studio/{project_id}"
    entities = {e["id"]: e for e in script.get("entities", [])}
    recurring = sheet_entities(script)
    unit = image_cost_usd()
    try:
        for ent in entities.values():
            if ent.get("sheet_key") or ent["id"] not in recurring:
                continue
            await _save(project_id, lambda p, s, ent=ent: setattr(p, "phase_label", f"Scheda: {ent['name']}"))
            kind_hint = (
                "environment concept art, wide establishing view" if ent.get("kind") == "setting"
                else "single subject on a plain neutral background, centered, full view, character/object reference sheet"
            )
            # Sheets are only references for the keyframes: low quality is enough and ~4x cheaper.
            png = await _gpt_image(f"{prefix}. {kind_hint}. {ent['name']}: {ent['description']}. No text, no labels.", size, [], "low")
            key = f"{base}/sheet_{ent['id']}.jpg"
            await _put(key, _jpeg(png), "image/jpeg")
            await _charge(project_id, "openai", settings.OPENAI_IMAGE_MODEL, IMAGE_COST_BY_QUALITY["low"], {"step": "sheet"})
            ver = int(time.time())

            def apply(p, s, ent=ent, key=key, ver=ver):
                for e in s.get("entities", []):
                    if e["id"] == ent["id"]:
                        e["sheet_key"], e["sheet_ver"] = key, ver
            await _save(project_id, apply)
            ent["sheet_key"] = key

        prev_key: Optional[str] = None
        shots = [s for s in script.get("shots", [])]
        total = len(shots)
        for idx, shot in enumerate(shots, start=1):
            sid = shot["id"]
            if shot.get("source") == "upload":
                prev_key = shot.get("keyframe_key") or prev_key
                continue
            if only_shots and sid not in only_shots:
                prev_key = shot.get("keyframe_key") or prev_key
                continue
            if shot.get("keyframe_key") and not only_shots:
                prev_key = shot["keyframe_key"]
                continue
            await _phase(project_id, f"Immagine {idx}/{total}", 0.1 + 0.88 * (idx - 1) / max(total, 1))
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
            key = f"{base}/key_{sid}.jpg"
            await _put(key, _jpeg(png), "image/jpeg")
            await _charge(project_id, "openai", settings.OPENAI_IMAGE_MODEL, unit, {"step": "keyframe"})
            prev_key = key
            ver = int(time.time())

            def apply_shot(p, s, sid=sid, key=key, ver=ver):
                for sh in s.get("shots", []):
                    if sh["id"] == sid:
                        sh.update(keyframe_key=key, keyframe_ver=ver, status="keyframe", error=None)
                        for stale in ("video_key", "video_ver", "clip_dur", "trim_in", "trim_out"):
                            sh.pop(stale, None)  # the clip is stale once the image changes
            await _save(project_id, apply_shot)

        def done(p, s):
            p.status, p.phase_label, p.error = "storyboard_ready", None, None
            p.final_key = None
        await _save(project_id, done)
    except Exception as exc:  # noqa: BLE001
        logger.exception("video studio storyboard failed")
        msg = str(exc) or exc.__class__.__name__

        def fail(p, s):
            p.status, p.phase_label, p.error = "failed", None, msg
        await _save(project_id, fail)


FONT_PATH = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def _ffmpeg(cmd: list[str], timeout: int = 300) -> None:
    proc = subprocess.run(cmd, capture_output=True, timeout=timeout)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg: {proc.stderr.decode(errors='ignore')[-400:]}")


def _probe(data: bytes) -> tuple[float, bool]:
    """(duration seconds, has audio stream) of a media blob."""
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, "in.media")
        with open(path, "wb") as fh:
            fh.write(data)
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", path],
            capture_output=True, timeout=60, check=True,
        )
    info = json.loads(out.stdout)
    duration = float(info.get("format", {}).get("duration") or 0)
    has_audio = any(s.get("codec_type") == "audio" for s in info.get("streams", []))
    return duration, has_audio


def _clip_from_image(image: bytes, caption: str, width: int, height: int, zoom_in: bool, seconds: int) -> bytes:
    """Fallback clip: slow zoom (Ken Burns) on the keyframe plus the narration as a caption."""
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
        cmd = ["ffmpeg", "-y", "-loop", "1", "-i", img, "-vf", vf, "-t", str(seconds), "-r", "25",
               "-c:v", "libx264", "-preset", "fast", "-crf", "21", "-pix_fmt", "yuv420p", "-an", out]
        _ffmpeg(cmd)
        with open(out, "rb") as fh:
            return fh.read()


def estimate_clip_seconds(narration: str) -> float:
    return max(1.0, len((narration or "").strip()) / VOICE_CHARS_PER_SECOND + 0.6)


async def _render_settings(project_id: uuid.UUID) -> tuple[dict, str, dict]:
    async with AsyncSessionLocal() as db:
        project = await db.get(VideoProject, project_id)
        script = project.script or {}
        return script.get("render_settings") or {"provider": "local"}, project.aspect, ensure_ids(copy.deepcopy(script))


async def run_clips(project_id: uuid.UUID, only_ids: Optional[list[str]] = None) -> list[str]:
    """One clip per generated shot from its keyframe. Returns the failure messages."""
    settings_, aspect, script = await _render_settings(project_id)
    dims = ASPECTS.get(aspect, ASPECTS["16:9"])
    base = f"video-studio/{project_id}"
    shots = [s for s in script.get("shots", [])
             if s.get("source") != "upload" and s.get("keyframe_key") and (not only_ids or s["id"] in only_ids)]
    if not only_ids:
        shots = [s for s in shots if not s.get("video_key")]
    failures: list[str] = []
    model_info: dict = {}
    if settings_["provider"] == "openrouter" and shots:
        async with httpx.AsyncClient(timeout=30) as client:
            model_info = next((m for m in await openrouter.video_catalog(client) if m["id"] == settings_["model"]), {})
        if not model_info:
            msg = "Il modello video non è più disponibile su OpenRouter"
            await _save(project_id, lambda p, s: [_patch_shot(s, sh["id"], status="failed", error=msg) for sh in shots])
            return [msg]
    for k, shot in enumerate(shots):
        sid = shot["id"]
        pos = [s["id"] for s in script["shots"]].index(sid) + 1
        await _phase(project_id, f"Clip {k + 1}/{len(shots)}", 0.03 + 0.67 * k / max(len(shots), 1))
        try:
            image = await _get(shot["keyframe_key"])
            usd = 0.0
            if settings_["provider"] == "openrouter":
                duration = settings_.get("duration") or openrouter.pick_duration(
                    model_info["supported_durations"], estimate_clip_seconds(shot.get("narration", "")))
                async with httpx.AsyncClient(timeout=120) as client:
                    job_id = shot.get("openrouter_job_id")
                    if not job_id:
                        job_id = await openrouter.submit_video(
                            client, model=settings_["model"],
                            prompt=f"{script.get('style_bible', '')}\n{shot.get('visual', '')}\nMotion: {shot.get('motion', '')}",
                            image=image, duration=duration, aspect_ratio=aspect,
                            resolution=settings_.get("resolution"),
                            # Voice-over comes from ElevenLabs: do not pay for model-generated audio when optional.
                            generate_audio=False if model_info.get("generate_audio") and not settings_.get("model_audio") else None,
                        )
                        await _save(project_id, lambda p, s, sid=sid, job_id=job_id: _patch_shot(s, sid, openrouter_job_id=job_id))
                    clip, usd = await openrouter.wait_video(client, job_id)
            else:
                clip = await asyncio.to_thread(
                    _clip_from_image, image, shot.get("narration", ""), dims["w"], dims["h"], pos % 2 == 1, SHOT_SECONDS)
            length, _ = await asyncio.to_thread(_probe, clip)
            key = f"{base}/shot_{sid}.mp4"
            await _put(key, clip, "video/mp4")
            await _charge(project_id, "openrouter" if usd else "local", settings_.get("model") or "animatic", usd, {"step": "clip"})
            ver = int(time.time())

            def ok(p, s, sid=sid, key=key, ver=ver, length=round(length, 2)):
                for sh in s.get("shots", []):
                    if sh["id"] == sid:
                        sh.update(video_key=key, video_ver=ver, status="video", error=None,
                                  clip_dur=length, trim_in=0.0, trim_out=length)
                        sh.pop("openrouter_job_id", None)
            await _save(project_id, ok)
        except Exception as exc:  # noqa: BLE001
            logger.exception("video studio clip %s failed", sid)
            failures.append(f"clip {pos}: {exc}")

            def bad(p, s, sid=sid, msg=str(exc), terminal=isinstance(exc, openrouter.VideoJobFailed)):
                _patch_shot(s, sid, status="failed", error=msg)
                if terminal:
                    for sh in s.get("shots", []):
                        if sh["id"] == sid:
                            sh.pop("openrouter_job_id", None)
            await _save(project_id, bad)
    return failures


def voice_signature(voice_id: str, text: str) -> str:
    return hashlib.sha1(f"{voice_id}|{settings.VIDEO_STUDIO_TTS_MODEL}|{text.strip()}".encode()).hexdigest()[:16]


async def tts(text: str, voice_id: str, language: str) -> bytes:
    body: dict[str, Any] = {"text": text.strip(), "model_id": settings.VIDEO_STUDIO_TTS_MODEL,
                            "voice_settings": {"stability": 0.5, "similarity_boost": 0.75, "use_speaker_boost": True}}
    if any(tag in settings.VIDEO_STUDIO_TTS_MODEL for tag in ("v2_5", "v3")):
        body["language_code"] = language
    resp = await voice_lab.request("POST", f"/v1/text-to-speech/{voice_lab.identifier(voice_id)}",
                                   params={"output_format": "mp3_44100_128"}, json=body)
    return voice_lab.audio(resp)


async def run_voice(project_id: uuid.UUID, only_ids: Optional[list[str]] = None) -> list[str]:
    """ElevenLabs voice-over for every shot whose narration/voice changed since its last audio."""
    async with AsyncSessionLocal() as db:
        project = await db.get(VideoProject, project_id)
        script = ensure_ids(copy.deepcopy(project.script or {}))
        language = project.language
    voice = script.get("voice") or {}
    if not voice.get("voice_id"):
        if any(sh.get("audio_key") for sh in script.get("shots", [])):  # voice-over switched off
            def strip(p, s):
                for sh in s.get("shots", []):
                    for k in ("audio_key", "audio_ver", "audio_dur", "audio_sig"):
                        sh.pop(k, None)
            await _save(project_id, strip)
        return []
    failures: list[str] = []
    all_shots = script.get("shots", [])
    for i, shot in enumerate(all_shots, start=1):
        text = (shot.get("narration") or "").strip()
        sid = shot["id"]
        if only_ids and sid not in only_ids:
            continue
        if not text:
            if shot.get("audio_key"):
                await _save(project_id, lambda p, s, sid=sid: [sh.pop(k, None) for sh in s["shots"] if sh["id"] == sid
                                                              for k in ("audio_key", "audio_ver", "audio_dur", "audio_sig")])
            continue
        sig = voice_signature(voice["voice_id"], text)
        if shot.get("audio_key") and shot.get("audio_sig") == sig:
            continue
        await _phase(project_id, f"Voce {i}/{len(all_shots)}", 0.7 + 0.2 * (i - 1) / max(len(all_shots), 1))
        try:
            audio = await tts(text, voice["voice_id"], language)
            length, _ = await asyncio.to_thread(_probe, audio)
            key = f"video-studio/{project_id}/voice_{sid}.mp3"
            await _put(key, audio, "audio/mpeg")
            quote = voice_lab_billing.quote("tts", characters=len(text), model=settings.VIDEO_STUDIO_TTS_MODEL)
            await _charge(project_id, "elevenlabs", settings.VIDEO_STUDIO_TTS_MODEL, quote["usd"], {"step": "voice", "characters": len(text)})
            ver = int(time.time())
            await _save(project_id, lambda p, s, sid=sid, key=key, ver=ver, length=round(length, 2), sig=sig:
                        _patch_shot(s, sid, audio_key=key, audio_ver=ver, audio_dur=length, audio_sig=sig, audio_in=0.0, audio_out=length))
        except Exception as exc:  # noqa: BLE001
            logger.exception("video studio voice %s failed", sid)
            detail = exc.detail if hasattr(exc, "detail") else str(exc)
            failures.append(f"voce {i}: {detail}")
    return failures


MAX_HOLD = 15.0  # seconds a clip may be stretched past its end (last frame held)


def layout(shots: list[dict]) -> list[dict]:
    """Where every clip and voice-over sits on the output timeline.

    Mirrors `layoutShots` in the frontend (usePlayback.ts): keep both in sync.
    A transition overlaps a clip with the previous one; a voice-over starts with its clip unless the previous
    voice is still speaking (then it waits, never overlapping) or the user moved it (`audio_offset`).
    A clip is held on its last frame as long as its voice-over needs.
    """
    out: list[dict] = []
    prev_end = prev_audio_end = prev_dur = 0.0
    for i, shot in enumerate(shots):
        clip_len = max(0.2, float(shot.get("trim_out") or shot.get("clip_dur") or 0) - float(shot.get("trim_in") or 0))
        a_len = 0.0
        if shot.get("audio_key"):
            a_len = max(0.2, float(shot.get("audio_out") or shot.get("audio_dur") or 0) - float(shot.get("audio_in") or 0))
        overlap = 0.0
        if i and shot.get("transition") in TRANSITIONS and shot.get("transition") != "none":
            overlap = max(0.2, min(float(shot.get("transition_dur") or 0.6), prev_dur * 0.9, clip_len * 0.9))
        start = prev_end - overlap if i else 0.0
        if shot.get("audio_offset") is not None:
            audio_abs = max(0.0, start + float(shot["audio_offset"]))
        else:
            audio_abs = max(start, prev_audio_end)
        duration = max(clip_len, audio_abs - start + a_len if a_len else 0.0)
        out.append({"start": start, "dur": duration, "overlap": overlap, "clip_len": clip_len,
                    "audio_abs": audio_abs, "audio_len": a_len})
        prev_end, prev_dur = start + duration, duration
        if a_len:
            prev_audio_end = audio_abs + a_len
    return out


def _video_segment(video: bytes, trim_in: float, trim_out: float, duration: float, width: int, height: int) -> tuple[bytes, bool]:
    """One clip as a normalised mp4 of exactly `duration` s (last frame held when stretched).
    Keeps the clip's own sound (uploads) when it has any. Returns (mp4, has_audio)."""
    source_len, has_audio = _probe(video)
    real = max(0.2, min(trim_out - trim_in, source_len - trim_in, duration))
    hold = max(0.0, duration - real)
    with tempfile.TemporaryDirectory() as tmp:
        v_path, out = os.path.join(tmp, "v.mp4"), os.path.join(tmp, "out.mp4")
        with open(v_path, "wb") as fh:
            fh.write(video)
        vf = (f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
              f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=25")
        if hold > 0:
            vf += f",tpad=stop_mode=clone:stop_duration={hold + 0.05:.3f}"
        cmd = ["ffmpeg", "-y", "-ss", f"{trim_in:.3f}", "-t", f"{real:.3f}", "-i", v_path, "-vf", vf,
               "-t", f"{duration:.3f}", "-c:v", "libx264", "-preset", "fast", "-crf", "21", "-pix_fmt", "yuv420p", "-r", "25"]
        if has_audio:
            cmd += ["-af", "aresample=44100,aformat=channel_layouts=stereo", "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-ac", "2"]
        else:
            cmd += ["-an"]
        _ffmpeg(cmd + [out], 600)
        with open(out, "rb") as fh:
            return fh.read(), has_audio


def _final_cut(segments: list[tuple[bytes, bool]], voices: list[Optional[bytes]], shots: list[dict], lay: list[dict]) -> bytes:
    """Video: xfade for transitions, hard cuts otherwise. Audio: every voice-over (trimmed, faded) and every
    clip's own sound positioned on the output timeline, then mixed: transitions never merge two voices."""
    with tempfile.TemporaryDirectory() as tmp:
        cmd = ["ffmpeg", "-y"]
        for i, (data, _) in enumerate(segments):
            path = os.path.join(tmp, f"s{i}.mp4")
            with open(path, "wb") as fh:
                fh.write(data)
            cmd += ["-i", path]
        n = len(segments)
        voice_input: dict[int, int] = {}
        for i, voice in enumerate(voices):
            if voice is not None:
                path = os.path.join(tmp, f"v{i}.mp3")
                with open(path, "wb") as fh:
                    fh.write(voice)
                voice_input[i] = n + len(voice_input)
                cmd += ["-i", path]
        silence = n + len(voice_input)
        cmd += ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo"]

        norm = "settb=AVTB,setpts=PTS-STARTPTS,fps=25,format=yuv420p,setsar=1"
        parts = [f"[{i}:v]{norm}[n{i}]" for i in range(n)]
        label = "n0"
        for i in range(1, n):
            out = f"v{i}"
            if lay[i]["overlap"] > 0:
                parts.append(f"[{label}][n{i}]xfade=transition={shots[i]['transition']}:duration={lay[i]['overlap']:.3f}:offset={lay[i]['start']:.3f}[{out}]")
            else:
                parts.append(f"[{label}][n{i}]concat=n=2:v=1:a=0[{out}]")
            label = out
        video_end = lay[-1]["start"] + lay[-1]["dur"]
        audio_end = max([x["audio_abs"] + x["audio_len"] for x in lay] + [0.0])
        total = max(video_end, audio_end)
        if total > video_end + 0.01:  # a voice-over placed past the last clip: hold the final frame
            parts.append(f"[{label}]tpad=stop_mode=clone:stop_duration={total - video_end + 0.05:.3f}[vend]")
            label = "vend"

        mix = [f"[{silence}:a]atrim=0:{total:.3f}[sil]"]
        names = ["[sil]"]
        for i, (_, has_audio) in enumerate(segments):
            if has_audio:
                ms = int(lay[i]["start"] * 1000)
                dur = lay[i]["dur"]
                mix.append(f"[{i}:a]afade=t=in:st=0:d=0.05,afade=t=out:st={max(0.0, dur - 0.15):.3f}:d=0.15,adelay={ms}|{ms}[c{i}]")
                names.append(f"[c{i}]")
        for i, idx in voice_input.items():
            a_in = float(shots[i].get("audio_in") or 0)
            length = lay[i]["audio_len"]
            ms = int(lay[i]["audio_abs"] * 1000)
            fade_in, fade_out = min(0.08, length / 3), min(0.25, length / 3)
            mix.append(f"[{idx}:a]aresample=44100,aformat=channel_layouts=stereo,atrim=start={a_in:.3f}:end={a_in + length:.3f},"
                       f"asetpts=PTS-STARTPTS,afade=t=in:st=0:d={fade_in:.3f},afade=t=out:st={max(0.0, length - fade_out):.3f}:d={fade_out:.3f},"
                       f"adelay={ms}|{ms}[w{i}]")
            names.append(f"[w{i}]")
        mix.append(f"{''.join(names)}amix=inputs={len(names)}:normalize=0:duration=first[aout]")
        out_path = os.path.join(tmp, "out.mp4")
        cmd += ["-filter_complex", ";".join(parts + mix), "-map", f"[{label}]", "-map", "[aout]", "-t", f"{total:.3f}",
                "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "25",
                "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-ac", "2", "-movflags", "+faststart", out_path]
        _ffmpeg(cmd, 1800)
        with open(out_path, "rb") as fh:
            return fh.read()


async def run_assemble(project_id: uuid.UUID) -> None:
    """Final cut honouring the timeline: order, trims, transitions, and the voice-over track."""
    async with AsyncSessionLocal() as db:
        project = await db.get(VideoProject, project_id)
        shots = [s for s in ensure_ids(copy.deepcopy(project.script or {})).get("shots", []) if s.get("video_key")]
        dims = ASPECTS.get(project.aspect, ASPECTS["16:9"])
    if not shots:
        await _save(project_id, lambda p, s: (setattr(p, "error", "Nessuna clip da montare"), setattr(p, "status", "storyboard_ready"), setattr(p, "phase_label", None)))
        return
    try:
        await _save(project_id, lambda p, s: setattr(p, "status", "rendering"))
        await _phase(project_id, "Montaggio finale", 0.92)
        videos = [await _get(sh["video_key"]) for sh in shots]
        for sh, video in zip(shots, videos):  # trims are stored against the real clip length
            clip_dur = float(sh.get("clip_dur") or 0) or (await asyncio.to_thread(_probe, video))[0]
            sh["clip_dur"] = clip_dur
            t_in = max(0.0, min(float(sh.get("trim_in") or 0), clip_dur - 0.2))
            sh["trim_in"] = t_in
            sh["trim_out"] = max(t_in + 0.2, min(float(sh.get("trim_out") or clip_dur), clip_dur + MAX_HOLD))
            if sh.get("audio_key"):
                a_dur = float(sh.get("audio_dur") or 0)
                a_in = max(0.0, min(float(sh.get("audio_in") or 0), max(a_dur - 0.2, 0)))
                sh["audio_in"] = a_in
                sh["audio_out"] = max(a_in + 0.2, min(float(sh.get("audio_out") or a_dur), a_dur or 1e9))
        lay = layout(shots)
        segments = [await asyncio.to_thread(_video_segment, v, sh["trim_in"], sh["trim_out"], pos["dur"], dims["w"], dims["h"])
                    for v, sh, pos in zip(videos, shots, lay)]
        voices = [await _get(sh["audio_key"]) if sh.get("audio_key") else None for sh in shots]
        final = await asyncio.to_thread(_final_cut, segments, voices, shots, lay)
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


async def run_render(project_id: uuid.UUID, only_ids: Optional[list[str]] = None) -> None:
    """Clips -> voice-over -> final cut. Stops before the cut if any clip or voice line failed."""
    failures: list[str] = []
    try:
        failures += await run_clips(project_id, only_ids)
        failures += await run_voice(project_id, only_ids)
    except Exception as exc:  # noqa: BLE001
        logger.exception("video studio render failed")
        failures.append(str(exc))
    if failures:
        msg = "; ".join(failures)[:900]
        await _save(project_id, lambda p, s: (setattr(p, "status", "storyboard_ready"), setattr(p, "error", msg), setattr(p, "phase_label", None)))
        return
    await run_assemble(project_id)


def normalise_upload(data: bytes) -> tuple[bytes, bytes, float]:
    """Uploaded clip -> (h264 mp4 <= 1280 px wide, jpeg thumbnail, duration)."""
    with tempfile.TemporaryDirectory() as tmp:
        src, out, thumb = (os.path.join(tmp, n) for n in ("src.media", "out.mp4", "thumb.jpg"))
        with open(src, "wb") as fh:
            fh.write(data)
        _ffmpeg(["ffmpeg", "-y", "-i", src, "-map", "0:v:0", "-map", "0:a:0?",
                 "-vf", "scale='min(1280,iw)':-2,fps=25", "-c:v", "libx264", "-preset", "fast", "-crf", "22",
                 "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-ac", "2",
                 "-movflags", "+faststart", out], 900)
        with open(out, "rb") as fh:
            video = fh.read()
        duration, _ = _probe(video)
        _ffmpeg(["ffmpeg", "-y", "-ss", f"{min(0.5, duration / 2):.2f}", "-i", out, "-frames:v", "1", "-q:v", "3", thumb], 60)
        with open(thumb, "rb") as fh:
            return video, fh.read(), duration
