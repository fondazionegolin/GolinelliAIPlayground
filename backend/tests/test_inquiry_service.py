from app.schemas.teacherbot import InquiryConfig
from app.services import inquiry_service as svc


SP = svc.InquirySuspect(id='s1', name='Elio')


def _cfg(**over):
    base = dict(
        npc_name="Elio", case_title="Caso", truth="Fu il giardiniere", final_question="Chi?", correct_answer="Il giardiniere",
        clues=[
            {"id": "a", "text": "clue a", "tier": 1},
            {"id": "b", "text": "clue b", "tier": 2},
            {"id": "c", "text": "clue c", "tier": 3},
        ],
    )
    base.update(over)
    return InquiryConfig.model_validate(base)


def test_tier1_unlocks_immediately_and_flag_is_defensive_or_reveal():
    d = svc.apply_turn(_cfg(), SP, "probing_question", ["a"], 0, 0, [])
    assert d.unlocked_clue_id == "a"
    assert d.flag in ("cooperative", "nervous", "dramatic")


def test_tier2_needs_trust_or_pressure():
    cfg = _cfg()
    d = svc.apply_turn(cfg, SP, "small_talk", ["b"], 0, 0, [])
    assert d.unlocked_clue_id is None
    d = svc.apply_turn(cfg, SP, "empathy_rapport", ["b"], 2, 0, [])
    assert d.unlocked_clue_id == "b"


def test_tier3_needs_two_prior_clues():
    cfg = _cfg()
    assert svc.apply_turn(cfg, SP, "direct_accusation", ["c"], 5, 8, ["a"]).unlocked_clue_id is None
    assert svc.apply_turn(cfg, SP, "direct_accusation", ["c"], 5, 8, ["a", "b"]).unlocked_clue_id == "c"


def test_manipulation_never_unlocks():
    d = svc.apply_turn(_cfg(), SP, "manipulation", ["a"], 9, 9, [])
    assert d.unlocked_clue_id is None


def test_disabled_flag_falls_back_and_probing_escalates():
    cfg = _cfg(flag_intensity={"defensive": 0, "nervous": 3})
    d = svc.apply_turn(cfg, SP, "probing_question", [], 0, 5, [])
    assert d.flag == "nervous"
    cfg = _cfg(flag_intensity={f: 0 for f in ("defensive", "nervous", "persuasive", "dramatic", "humorous", "cooperative")})
    assert svc.apply_turn(cfg, SP, "probing_question", [], 0, 0, []).flag is None


def test_stage_direction_hides_locked_clues():
    cfg = _cfg()
    d = svc.apply_turn(cfg, SP, "probing_question", ["a"], 0, 0, [])
    text = svc.build_stage_direction(cfg, d, "it")
    assert "clue a" in text and "clue b" not in text


def test_suspect_bound_clue_only_unlocks_for_owner():
    cfg = _cfg(
        suspects=[{"id": "s1", "name": "A"}, {"id": "s2", "name": "B", "is_culprit": True}],
        clues=[{"id": "a", "text": "x", "tier": 1, "suspect_id": "s2"}, {"id": "b", "text": "y", "tier": 1}],
    )
    a, b = cfg.suspects
    assert svc.apply_turn(cfg, a, "probing_question", ["a"], 0, 0, []).unlocked_clue_id is None
    assert svc.apply_turn(cfg, b, "probing_question", ["a"], 0, 0, []).unlocked_clue_id == "a"
    assert svc.apply_turn(cfg, a, "probing_question", ["b"], 0, 0, []).unlocked_clue_id == "b"


def test_legacy_config_becomes_one_suspect_and_bad_clue_owner_cleared():
    cfg = _cfg(npc_name="Elio", npc_role="custode", clues=[{"id": "a", "text": "x", "suspect_id": "zzz"}])
    assert [s.name for s in cfg.suspects] == ["Elio"]
    assert cfg.clues[0].suspect_id is None


def test_npc_prompt_hides_full_truth_in_multi():
    cfg = _cfg(
        truth="TOP SECRET SOLUTION",
        suspects=[{"id": "s1", "name": "A", "knowledge": "own secret"}, {"id": "s2", "name": "B", "is_culprit": True}],
    )
    text = svc.build_npc_instructions(cfg, cfg.suspects[0], "it")
    assert "own secret" in text and "TOP SECRET SOLUTION" not in text
    assert "colpevole" in svc.build_npc_instructions(cfg, cfg.suspects[1], "it")
