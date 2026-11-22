"""Notebook p5.js agent: static camera/full-screen findings, diff review and the repair round after browser verification."""
import asyncio

from app.api.v1.endpoints import notebooks as nb


MISALIGNED = """let video, handPose, hands = [];
function preload() { handPose = ml5.handPose(); }
function setup() {
  createCanvas(windowWidth, windowHeight);
  video = createCapture(VIDEO);
  video.size(width, height);
  handPose.detectStart(video, (r) => { hands = r; });
}
function draw() {
  image(video, 0, 0, width, height);
  const kp = hands[0].keypoints[0];
  circle(width - kp.x, kp.y, 10);
}
"""

ALIGNED = """let video, handPose, hands = [];
function preload() { handPose = ml5.handPose(); }
function setup() {
  createCanvas(windowWidth, windowHeight);
  video = createCapture(VIDEO); video.size(640, 480); video.hide();
  handPose.detectStart(video, (r) => { hands = r; });
}
function draw() {
  GolinelliCam.draw(video);
  for (const hand of hands) {
    const p = GolinelliCam.videoPoint(hand.keypoints[0], video);
    circle(p.x, p.y, 10);
  }
}
function windowResized() { resizeCanvas(windowWidth, windowHeight); }
"""


def test_static_findings_flag_full_screen_camera_bugs():
    findings = " ".join(nb._p5_static_findings(MISALIGNED, []))
    assert "«ml5»" in findings  # library used but not active
    assert "windowResized" in findings
    assert "video.size(width" in findings
    assert "GolinelliCam.draw" in findings
    assert "[0]" in findings


def test_static_findings_clean_for_golinellicam_sketch():
    assert nb._p5_static_findings(ALIGNED, ["ml5"]) == []


def test_review_diff_text_marks_added_and_removed_lines():
    text = nb._format_hunks_for_review(nb._build_hunks("a\nb\nc", "a\nB\nc"))
    assert "-b" in text and "+B" in text


def test_repair_round_diffs_against_student_code_and_adds_camera_reviewer(monkeypatch):
    seen_focuses: list[str] = []
    seen_inputs: dict = {}

    async def fake_codegen(project_type, active_source, last_output, user_prompt, provider, model,
                           previous_failures="", context_note=""):
        seen_inputs["source"] = active_source
        seen_inputs["errors"] = last_output
        seen_inputs["context"] = context_note
        return ("piano", "corretto", [{"search": "image(video, 0, 0, width, height);", "replace": "GolinelliCam.draw(video);"}], [], None)

    async def fake_review(project_type, content, user_prompt, last_output, focus, provider, model,
                          syntax_error="", diff_text="", findings=None):
        seen_focuses.append(focus)
        assert "+  GolinelliCam.draw(video);" in diff_text
        return [], []

    monkeypatch.setattr(nb, "_notebook_codegen_edits", fake_codegen)
    monkeypatch.setattr(nb, "_notebook_review_edits", fake_review)

    student_code = "function setup() { createCanvas(400, 400); }\nfunction draw() { background(0); }\n"

    async def run():
        out = []
        async for kind, payload in nb._run_agent_pipeline_stream(
            "p5js", MISALIGNED, "1. TypeError: Cannot read properties of undefined (reading 'keypoints')",
            "metti un cerchio sul polso", False, override=("x", "y"),
            diff_base=student_code, active_libraries=["ml5"],
        ):
            out.append((kind, payload))
        return out

    events = asyncio.run(run())
    proposals, _summary = [p for k, p in events if k == "final"][0]
    assert seen_inputs["source"] == MISALIGNED  # the agent fixes its own previous proposal
    assert "keypoints" in seen_inputs["errors"]
    assert "Librerie p5 attive nel notebook: ml5" in seen_inputs["context"]
    assert sorted(seen_focuses) == ["bugs", "camera", "requirements"]
    proposal = proposals[0]
    # The diff shown to the student is against their real code, not against the failed proposal.
    assert proposal["line_end"] == len(student_code.splitlines())
    removed = [r["text"] for h in proposal["hunks"] for r in h["rows"] if r["op"] == "del"]
    assert any("createCanvas(400, 400)" in line for line in removed)
    assert "GolinelliCam.draw(video);" in proposal["replacement"]
