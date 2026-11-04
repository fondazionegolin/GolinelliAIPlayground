import copy
import subprocess
import tempfile
import os
from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.api.v1.endpoints import video_studio as ep
from app.services import openrouter, video_studio as vs


def _media(args: list[str], ext: str) -> bytes:
    with tempfile.TemporaryDirectory() as tmp:
        out = os.path.join(tmp, f"o.{ext}")
        subprocess.run(["ffmpeg", "-y", *args, out], capture_output=True, check=True)
        return open(out, "rb").read()


def video(secs: float) -> bytes:
    return _media(["-f", "lavfi", "-i", f"color=c=red:s=320x180:d={secs}", "-c:v", "libx264", "-pix_fmt", "yuv420p"], "mp4")


def voice(secs: float) -> bytes:
    return _media(["-f", "lavfi", "-i", f"sine=f=440:d={secs}"], "mp3")


def test_pricing_per_second_resolution_and_audio():
    veo = {"pricing_skus": {"duration_seconds_with_audio": "0.08", "duration_seconds_without_audio": "0.05",
                            "duration_seconds_with_audio_720p": "0.05", "duration_seconds_without_audio_720p": "0.03"}}
    assert openrouter.sku_usd_per_second(veo, "720p", False) == pytest.approx(0.03)
    assert openrouter.sku_usd_per_second(veo, "720p", True) == pytest.approx(0.05)
    cents = {"pricing_skus": {"cents_per_video_output_second_480p": "0.5", "cents_per_video_output_second_720p": "1"}}
    assert openrouter.sku_usd_per_second(cents, "720p", False) == pytest.approx(0.01)


def test_pricing_video_tokens_estimate():
    seedance = {"pricing_skus": {"video_tokens": "0.0000035", "video_tokens_without_audio": "0.0000035"}}
    usd = openrouter.sku_usd_per_second(seedance, "720p", False)
    assert usd == pytest.approx(0.0000035 * 1280 * 720 * 24 / 1024)


def test_duration_and_resolution_choice():
    assert openrouter.pick_duration([4, 6, 8], 5.2) == 6
    assert openrouter.pick_duration([4, 6, 8], 30) == 8
    assert openrouter.default_resolution(["480p", "720p", "1080p"]) == "720p"
    assert openrouter.default_resolution(["480p"]) == "480p"


def test_upload_is_normalised_with_thumbnail():
    data, thumb, duration = vs.normalise_upload(video(2))
    assert duration == pytest.approx(2.0, abs=0.2) and thumb[:2] == b"\xff\xd8"


@pytest.mark.asyncio
async def test_update_script_reorders_trims_and_splits_without_losing_media():
    shots = [{"id": "a", "n": 1, "title": "A", "narration": "uno", "visual": "v1", "motion": "", "entities": [],
              "video_key": "k/shot_a.mp4", "keyframe_key": "k/key_a.jpg", "clip_dur": 5.0, "audio_key": "k/voice_a.mp3", "audio_dur": 2.0},
             {"id": "b", "n": 2, "title": "B", "narration": "due", "visual": "v2", "motion": "", "entities": [],
              "video_key": "k/shot_b.mp4", "keyframe_key": "k/key_b.jpg", "clip_dur": 4.0}]
    project = SimpleNamespace(id=uuid4(), owner_id=uuid4(), script={"shots": copy.deepcopy(shots), "entities": []},
                              final_key="final", status="done",
                              title="t", style_key="flat_2d", aspect="16:9", language="it", target_shots=6,
                              phase_label=None, cost_usd=0, error=None, updated_at=None, source_text="", brief=None)

    class Db:
        async def get(self, *_): return project
        async def commit(self): pass
        async def refresh(self, *_): pass

    admin = SimpleNamespace(id=project.owner_id)
    incoming = copy.deepcopy(shots)
    incoming.reverse()                       # B first
    incoming[0].update(trim_in=0.5, trim_out=99)   # trim_out beyond the clip must be clamped
    incoming[1].update(trim_in=1.0, trim_out=3.0)
    incoming[1]["video_key"] = "evil/other.mp4"     # media keys are server-owned
    split = {**incoming[1], "id": "c", "clone_of": "a", "narration": "", "trim_in": 3.0, "trim_out": 5.0}
    incoming.append(split)
    out = await ep.update_script(project.id, ep.ScriptUpdate(script={"shots": incoming, "entities": []}), admin, Db())
    got = {s["id"]: s for s in out["script"]["shots"]}
    assert [s["id"] for s in out["script"]["shots"]] == ["b", "a", "c"]
    assert got["b"]["trim_out"] == 19.0 and got["b"]["trim_in"] == 0.5  # stretched up to clip + 15 s hold
    assert got["a"]["video_key"] == "k/shot_a.mp4" and got["a"]["audio_key"] == "k/voice_a.mp3"
    assert got["c"]["video_key"] == "k/shot_a.mp4" and "audio_key" not in got["c"]
    assert project.final_key is None




def shot(clip, trans="none", dur=0.6, audio=0.0, **extra):
    d = {"clip_dur": clip, "trim_in": 0, "trim_out": clip, "transition": trans, "transition_dur": dur, "video_key": "v"}
    if audio:
        d.update(audio_key="a", audio_dur=audio, audio_in=0, audio_out=audio)
    d.update(extra)
    return d


def test_layout_overlaps_transitions_and_never_overlaps_voices():
    lay = vs.layout([shot(4, audio=3), shot(4, "fade", 1.0, audio=3), shot(3)])
    assert [round(x["start"], 2) for x in lay] == [0, 3.0, 7.0]
    # voice 2 would start at 3.0 while voice 1 speaks until 3.0 -> starts right after it, no overlap
    assert lay[1]["audio_abs"] == pytest.approx(3.0)
    long_voice = vs.layout([shot(2, audio=5), shot(4, "fade", 1.0, audio=2)])
    assert long_voice[0]["dur"] == pytest.approx(5.0)          # clip held for its voice
    assert long_voice[1]["audio_abs"] >= 5.0                    # waits for the previous voice
    moved = vs.layout([shot(4, audio=2, audio_offset=1.5)])
    assert moved[0]["audio_abs"] == pytest.approx(1.5)


def test_final_cut_with_transition_voice_trim_and_hold():
    shots = [shot(4, audio=3), shot(3, "wipeleft", 1.0, audio=2, audio_in=0.5, audio_out=2.0)]
    lay = vs.layout(shots)
    segs = [vs._video_segment(video(5), s["trim_in"], s["trim_out"], pos["dur"], 640, 360) for s, pos in zip(shots, lay)]
    for seg, pos in zip(segs, lay):
        assert vs._probe(seg[0])[0] == pytest.approx(pos["dur"], abs=0.2)
    final = vs._final_cut(segs, [voice(3), voice(2)], shots, lay)
    duration, has_audio = vs._probe(final)
    assert has_audio and duration == pytest.approx(lay[-1]["start"] + lay[-1]["dur"], abs=0.3)


def test_stretched_clip_and_hard_cut_final_cut():
    shots = [shot(2, trim_out=5.0, clip_dur=2.0), shot(2)]
    lay = vs.layout(shots)
    segs = [vs._video_segment(video(2), 0, s["trim_out"], pos["dur"], 640, 360) for s, pos in zip(shots, lay)]
    final = vs._final_cut(segs, [None, None], shots, lay)
    assert vs._probe(final)[0] == pytest.approx(7.0, abs=0.3)
