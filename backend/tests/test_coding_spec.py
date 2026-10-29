from app.api.v1.endpoints.coding import _kb_content_for_prompt, _parse_spec_output


def test_parse_spec_output_splits_spec_and_milestones():
    raw = (
        "# Piattaforma\n\n## Funzioni\n1. F1 login\n\n@@MILESTONES@@\n"
        '[{"title": "Scheletro", "goal": "Navigazione e login", "features": ["F1"]},'
        ' {"title": "Admin", "goal": "Pannello", "features": ["F2", "F3"]}]'
    )
    spec, milestones = _parse_spec_output(raw)
    assert spec.startswith("# Piattaforma")
    assert "@@MILESTONES@@" not in spec
    assert [m["title"] for m in milestones] == ["Scheletro", "Admin"]
    assert milestones[1]["features"] == ["F2", "F3"]


def test_parse_spec_output_survives_bad_milestone_json():
    spec, milestones = _parse_spec_output("# Solo spec\n\n@@MILESTONES@@\nnon json")
    assert spec == "# Solo spec"
    assert milestones == []


def test_parse_spec_output_caps_milestones():
    items = ",".join('{"title": "m%d", "goal": "g"}' % i for i in range(10))
    _, milestones = _parse_spec_output(f"# S\n@@MILESTONES@@\n[{items}]")
    assert len(milestones) == 6


def test_spec_md_gets_larger_kb_window():
    big = "x" * 20000
    assert len(_kb_content_for_prompt({"path": "spec.md", "content": big})) == 20000
    assert len(_kb_content_for_prompt({"path": "description.md", "content": big})) == 8000


def test_delimited_parser_collects_files_and_flags_truncation():
    from app.api.v1.endpoints.coding import _DelimitedFileParser

    parser = _DelimitedFileParser()
    events = parser.feed("=== FILE: App.tsx ===\nexport default function App(){}\n=== END ===\n=== FILE: types.ts ===\nexport const x = {\n  a: 1,\n")
    events += parser.finish()
    assert [f["path"] for f in parser.files] == ["App.tsx"]
    assert parser.truncated_path == "types.ts"
    assert {e["type"] for e in events} >= {"file_start", "file_done"}


def test_delimited_parser_skips_platform_owned_and_accepts_missing_end_between_files():
    from app.api.v1.endpoints.coding import _DelimitedFileParser

    parser = _DelimitedFileParser()
    parser.feed("=== FILE: index.html ===\n<html/>\n=== END ===\n=== FILE: a.ts ===\nx\n=== FILE: b.ts ===\ny\n=== END ===\n")
    parser.finish()
    assert [f["path"] for f in parser.files] == ["a.ts", "b.ts"]
    assert parser.truncated_path is None


def test_parse_architect_plan_and_design_root_guard():
    from app.api.v1.endpoints.coding import _ensure_design_root, _parse_architect_plan

    plan = _parse_architect_plan([
        "1 | App.tsx | radice | export default function App()",
        "- 2 | components/Header.tsx | navbar | export default function Header(props: { t: string })",
        "2 | index.html | no | x",
        "garbage",
    ])
    assert [(p["worker"], p["path"]) for p in plan] == [(1, "App.tsx"), (2, "components/Header.tsx")]

    files = [
        {"path": "design-system.md", "content": "x\n:root {\n  --ds-primary: #fff;\n}\n"},
        {"path": "styles.css", "content": "body{margin:0}"},
    ]
    out = {f["path"]: f["content"] for f in _ensure_design_root(files)}
    assert out["styles.css"].startswith(":root {")


def test_delimited_parser_accepts_balanced_file_without_end():
    from app.api.v1.endpoints.coding import _DelimitedFileParser

    parser = _DelimitedFileParser()
    parser.feed("=== FILE: a.ts ===\nexport const a = { b: [1, 2] }\n")
    parser.finish()
    assert [f["path"] for f in parser.files] == ["a.ts"]
    assert parser.truncated_path is None
