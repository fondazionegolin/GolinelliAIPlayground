import json
from datetime import datetime
from types import SimpleNamespace
from uuid import uuid4

from app.services.task_results import (
    build_task_results,
    results_csv,
    results_grid,
    results_report_pdf,
)


def _fixture():
    questions = [
        {"question": "2+2?", "options": ["3", "4"], "correctIndex": 1},
        {"question": "Perché?", "type": "open"},
        {"question": "Quanto ti è piaciuto?", "type": "scale", "min": 1, "max": 5},
    ]
    task = SimpleNamespace(
        id=uuid4(), title="Quiz di prova", description=None, due_at=None,
        task_type=SimpleNamespace(value="quiz"),
        content_json=json.dumps({"questions": questions}),
    )
    anna = SimpleNamespace(id=uuid4(), nickname="Anna")
    luca = SimpleNamespace(id=uuid4(), nickname="Luca")
    sub = SimpleNamespace(
        id=uuid4(), student_id=anna.id, submitted_at=datetime(2026, 11, 4, 10, 0),
        score="1/1 + 2 da valutare", content="1/1 + 2 da valutare", feedback=None, feedback_published_at=None,
        content_json=json.dumps({"answers": [
            {"questionIndex": 0, "selectedIndex": 1},
            {"questionIndex": 1, "text": "=HYPERLINK(\"x\")"},
            {"questionIndex": 2, "value": 4},
        ]}),
    )
    return task, [luca, anna], [sub]


def test_matrix_covers_every_student_and_computes_stats():
    task, students, subs = _fixture()
    results = build_task_results(task, students, subs)

    assert [r["student_nickname"] for r in results["rows"]] == ["Anna", "Luca"]
    assert results["totals"] == {"students": 2, "submitted": 1}
    anna, luca = results["rows"]
    assert anna["answers"][0]["correct"] is True
    assert anna["answers"][1]["display"].startswith("=HYPERLINK")
    assert luca["submitted"] is False and luca["answers"][0]["answered"] is False
    assert results["question_stats"][0]["correct_percent"] == 100
    assert results["question_stats"][0]["distribution"] == [0, 1]
    assert results["question_stats"][2]["average"] == 4


def test_csv_neutralises_formulas_and_uses_excel_friendly_format():
    task, students, subs = _fixture()
    results = build_task_results(task, students, subs)
    grid = results_grid(results)
    assert len(grid) == 2  # header + the only student who submitted (Luca is excluded)
    assert "Luca" not in [line[0] for line in grid]
    assert grid[1][4].startswith("'=")  # open answer starting with "=" is escaped
    raw = results_csv(results)
    assert raw.startswith("﻿".encode("utf-8"))
    assert b";" in raw.splitlines()[0]


def test_pdf_report_is_a_valid_pdf():
    task, students, subs = _fixture()
    results = build_task_results(task, students, subs)
    pdf = results_report_pdf(results, "3A", {"overview": {"summary": "Ok", "strengths": ["a"], "gaps": [], "suggestions": []}, "student_reports": []})
    assert pdf.startswith(b"%PDF")
