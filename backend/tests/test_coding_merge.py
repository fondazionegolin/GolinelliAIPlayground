from app.services.coding_merge import changed_files, merge_file_sets, merge_text


def f(path, content):
    return {"path": path, "language": "javascript", "content": content}


BASE = "a\nb\nc\nd\ne\n"


def test_disjoint_edits_merge():
    ours = "A\nb\nc\nd\ne\n"
    theirs = "a\nb\nc\nd\nE\n"
    merged, conflict = merge_text(BASE, ours, theirs)
    assert not conflict
    assert merged == "A\nb\nc\nd\nE\n"


def test_same_line_conflict_keeps_ours():
    merged, conflict = merge_text(BASE, "a\nX\nc\nd\ne\n", "a\nY\nc\nd\ne\n")
    assert conflict
    assert merged == "a\nX\nc\nd\ne\n"


def test_identical_edits_are_not_conflicts():
    merged, conflict = merge_text(BASE, "a\nX\nc\nd\ne\n", "a\nX\nc\nd\ne\n")
    assert not conflict and merged == "a\nX\nc\nd\ne\n"


def test_insertions_at_different_places():
    merged, conflict = merge_text(BASE, "top\na\nb\nc\nd\ne\n", "a\nb\nc\nd\ne\nbottom\n")
    assert not conflict
    assert merged == "top\na\nb\nc\nd\ne\nbottom\n"


def test_two_different_insertions_at_same_point_conflict():
    _, conflict = merge_text(BASE, "a\nx\nb\nc\nd\ne\n", "a\ny\nb\nc\nd\ne\n")
    assert conflict


def test_file_sets_new_deleted_and_conflict():
    base = [f("a.js", BASE), f("old.js", "x"), f("c.js", "1\n")]
    ours = [f("a.js", "A\nb\nc\nd\ne\n"), f("old.js", "x"), f("c.js", "ours\n")]
    theirs = [f("a.js", "a\nb\nc\nd\nE\n"), f("new.js", "n"), f("c.js", "theirs\n")]
    merged, conflicts = merge_file_sets(base, ours, theirs)
    by = {m["path"]: m["content"] for m in merged}
    assert by["a.js"] == "A\nb\nc\nd\nE\n"
    assert by["new.js"] == "n"
    assert "old.js" not in by  # deleted by the contributor, untouched on main
    assert by["c.js"] == "ours\n"
    assert [c["path"] for c in conflicts] == ["c.js"]


def test_delete_vs_modify_is_conflict_and_delete_alone_applies():
    base = [f("a.js", "1"), f("b.js", "1")]
    ours = [f("a.js", "2"), f("b.js", "1")]
    theirs = [f("b.js", "1")]
    merged, conflicts = merge_file_sets(base, ours, theirs)
    assert [c["path"] for c in conflicts] == ["a.js"]
    theirs = [f("a.js", "1")]
    merged, conflicts = merge_file_sets(base, ours, theirs)
    assert not conflicts and {m["path"] for m in merged} == {"a.js"}


def test_changed_files():
    base = [f("a.js", "1"), f("b.js", "1")]
    head = [f("a.js", "2"), f("c.js", "3")]
    out = {c["path"]: c["status"] for c in changed_files(base, head)}
    assert out == {"a.js": "modified", "b.js": "deleted", "c.js": "added"}
