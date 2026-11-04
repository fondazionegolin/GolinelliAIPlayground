"""Tabular results of a task: one row per student, one column per question.

Pure functions (no DB access) so the same matrix feeds the JSON API, the CSV
export and the PDF report.
"""
from __future__ import annotations

import csv
import io
import json
from html import escape
from typing import Any, Iterable


def _obj(raw: str | None) -> Any:
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return None


def _first(data: dict, *keys: str) -> Any:
    for key in keys:
        if data.get(key) is not None:
            return data[key]
    return None


def _int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str) and value.strip().lstrip("-").isdigit():
        return int(value.strip())
    return None


def _quiz_questions(task_content: Any) -> list[dict]:
    if not isinstance(task_content, dict):
        return []
    raw = task_content.get("questions") or task_content.get("domande") or []
    questions: list[dict] = []
    for index, item in enumerate(raw if isinstance(raw, list) else []):
        if not isinstance(item, dict):
            continue
        options = _first(item, "options", "opzioni") or []
        kind = item.get("type") or ("mcq" if options else "open")
        questions.append({
            "index": index,
            "type": kind if kind in ("mcq", "open", "scale") else "mcq",
            "text": str(_first(item, "question", "text", "domanda") or f"Domanda {index + 1}"),
            "options": [str(o) for o in options] if isinstance(options, list) else [],
            "correct_index": _int(_first(item, "correctIndex", "correct_index", "correct")),
            "min": _int(item.get("min")) if _int(item.get("min")) is not None else 1,
            "max": _int(item.get("max")) if _int(item.get("max")) is not None else 5,
            "sample_answer": item.get("sampleAnswer"),
        })
    return questions


def _answers_by_question(content_json: str | None) -> dict[int, dict]:
    data = _obj(content_json)
    items = data if isinstance(data, list) else (data or {}).get("answers") or (data or {}).get("risposte") or []
    out: dict[int, dict] = {}
    for position, item in enumerate(items if isinstance(items, list) else []):
        if not isinstance(item, dict):
            continue
        idx = _int(_first(item, "questionIndex", "question_index"))
        out[position if idx is None else idx] = item
    return out


def _cell(question: dict, answer: dict | None) -> dict:
    """Normalise one answer into {display, value, correct}."""
    if answer is None:
        return {"display": "", "value": None, "correct": None, "answered": False}
    if question["type"] == "open":
        text = str(_first(answer, "text", "risposta") or "").strip()
        return {"display": text, "value": text, "correct": None, "answered": bool(text)}
    if question["type"] == "scale":
        value = answer.get("value")
        return {
            "display": "" if value is None else str(value),
            "value": value,
            "correct": None,
            "answered": value is not None,
        }
    selected = _int(_first(answer, "selectedIndex", "selected_index"))
    if selected is None or not (0 <= selected < len(question["options"])):
        return {"display": "", "value": None, "correct": None, "answered": False}
    correct = None if question["correct_index"] is None else selected == question["correct_index"]
    return {
        "display": question["options"][selected],
        "value": selected,
        "correct": correct,
        "answered": True,
    }


def _question_stats(question: dict, cells: list[dict], submitted: int) -> dict:
    answered = [c for c in cells if c["answered"]]
    stats: dict[str, Any] = {"answered": len(answered), "submitted": submitted}
    if question["type"] == "mcq":
        counts = [0] * len(question["options"])
        for cell in answered:
            counts[cell["value"]] += 1
        graded = [c for c in answered if c["correct"] is not None]
        stats["distribution"] = counts
        stats["correct_percent"] = (
            round(sum(1 for c in graded if c["correct"]) / len(graded) * 100) if graded else None
        )
    elif question["type"] == "scale":
        values = [c["value"] for c in answered if isinstance(c["value"], (int, float))]
        lo, hi = question["min"], question["max"]
        counts = [0] * max(hi - lo + 1, 1)
        for v in values:
            if lo <= v <= hi:
                counts[int(v) - lo] += 1
        stats["distribution"] = counts
        stats["average"] = round(sum(values) / len(values), 2) if values else None
    return stats


def build_task_results(task: Any, students: Iterable[Any], submissions: Iterable[Any]) -> dict:
    """`submissions` must already be the latest one per student."""
    task_type = task.task_type.value if task.task_type else "exercise"
    content = _obj(task.content_json)
    questions = _quiz_questions(content) if task_type == "quiz" else []
    by_student = {s.student_id: s for s in submissions}

    rows: list[dict] = []
    for student in sorted(students, key=lambda s: (s.nickname or "").casefold()):
        sub = by_student.get(student.id)
        row: dict[str, Any] = {
            "student_id": str(student.id),
            "student_nickname": student.nickname,
            "submitted": sub is not None,
            "submission_id": str(sub.id) if sub else None,
            "submitted_at": sub.submitted_at.isoformat() if sub and sub.submitted_at else None,
            "score": sub.score if sub else None,
            "feedback": sub.feedback if sub else None,
            "feedback_published": bool(sub and sub.feedback_published_at),
            "answers": [],
            "text": None,
        }
        if questions:
            answers = _answers_by_question(sub.content_json) if sub else {}
            row["answers"] = [_cell(q, answers.get(q["index"]) if sub else None) for q in questions]
            if sub and not row["score"] and sub.content:
                row["score"] = sub.content
        elif sub:
            structured = _obj(sub.content_json)
            text = (sub.content or "").strip()
            if isinstance(structured, dict):
                text = str(_first(structured, "text", "content", "description") or text)
            row["text"] = text
        rows.append(row)

    submitted_count = sum(1 for r in rows if r["submitted"])
    question_stats = [
        _question_stats(q, [r["answers"][q["index"]] for r in rows if r["submitted"]], submitted_count)
        for q in questions
    ]
    return {
        "task": {
            "id": str(task.id),
            "title": task.title,
            "description": task.description,
            "task_type": task_type,
            "due_at": task.due_at.isoformat() if task.due_at else None,
        },
        "questions": questions,
        "question_stats": question_stats,
        "rows": rows,
        "totals": {"students": len(rows), "submitted": submitted_count},
    }


def _score_percent(score: str | None) -> int | None:
    if not score:
        return None
    head = score.split("+")[0].strip()
    parts = head.split("/")
    if len(parts) == 2 and all(p.strip().isdigit() for p in parts) and int(parts[1]) > 0:
        return round(int(parts[0]) / int(parts[1]) * 100)
    return None


def _csv_safe(value: Any) -> str:
    """Neutralise spreadsheet formula injection from student-provided text."""
    text = "" if value is None else str(value)
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


def _submitted_rows(results: dict) -> list[dict]:
    """Reports list only the students who handed in; the roster of missing ones stays in the UI."""
    return [row for row in results["rows"] if row["submitted"]]


def results_header(results: dict) -> list[str]:
    head = ["Studente", "Stato", "Consegnato il"]
    if results["questions"]:
        head += [f"D{q['index'] + 1}. {q['text']}" for q in results["questions"]]
        head += ["Punteggio", "%"]
    else:
        head += ["Risposta", "Voto"]
    head += ["Feedback docente"]
    return head


def results_grid(results: dict) -> list[list[str]]:
    """Header + one row per student: the same grid the spreadsheet view shows."""
    grid = [results_header(results)]
    for row in _submitted_rows(results):
        line = [
            row["student_nickname"],
            "Consegnato",
            (row["submitted_at"] or "")[:16].replace("T", " "),
        ]
        if results["questions"]:
            line += [c["display"] for c in row["answers"]]
            pct = _score_percent(row["score"])
            line += [row["score"] or "", "" if pct is None else str(pct)]
        else:
            line += [row["text"] or "", row["score"] or ""]
        line.append(row["feedback"] or "")
        grid.append([_csv_safe(v) for v in line])
    return grid


def results_csv(results: dict) -> bytes:
    """Semicolon-separated, UTF-8 with BOM: opens correctly in Italian Excel."""
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";", lineterminator="\r\n")
    writer.writerows(results_grid(results))
    return ("﻿" + buffer.getvalue()).encode("utf-8")


# ── PDF report ────────────────────────────────────────────────────────────────

_CSS = """
body { font-family: sans-serif; font-size: 9pt; color: #17151b; }
h1 { font-size: 17pt; margin: 0 0 2pt 0; }
h2 { font-size: 12pt; margin: 14pt 0 4pt 0; color: #17151b; border-bottom: 1pt solid #d9d4e6; }
h3 { font-size: 10pt; margin: 8pt 0 2pt 0; }
p { margin: 2pt 0; }
.muted { color: #6e6679; }
table { border-collapse: collapse; width: 100%; }
th { background-color: #17151b; color: #ffffff; text-align: left; padding: 3pt; font-size: 8pt; }
td { border-bottom: 0.5pt solid #ece9f4; padding: 3pt; vertical-align: top; font-size: 8pt; }
.ok { color: #1278bd; } .ko { color: #fe004d; }
.bar { background-color: #3ea9f4; height: 7pt; }
.barok { background-color: #1278bd; height: 7pt; }
"""


def _bar(percent: int, good: bool = False) -> str:
    width = max(0, min(100, percent))
    cls = "barok" if good else "bar"
    return f'<table><tr><td style="border:0;padding:0;width:{width}%"><div class="{cls}"></div></td><td style="border:0;padding:0"></td></tr></table>' if width else ""


def _bullets(values: list[str]) -> str:
    return "<ul>" + "".join(f"<li>{escape(str(v))}</li>" for v in values) + "</ul>" if values else ""


def results_report_html(results: dict, session_title: str, analysis: dict | None = None) -> str:
    task, totals = results["task"], results["totals"]
    out = [
        f"<h1>{escape(task['title'])}</h1>",
        f'<p class="muted">{escape(session_title)} · Consegne: {totals["submitted"]} su {totals["students"]}</p>',
    ]
    if analysis and isinstance(analysis.get("overview"), dict):
        ov = analysis["overview"]
        out.append("<h2>Sintesi (generata dall'AI)</h2>")
        if ov.get("summary"):
            out.append(f"<p>{escape(str(ov['summary']))}</p>")
        for title, key in (("Punti di forza", "strengths"), ("Da approfondire", "gaps"), ("Azioni suggerite", "suggestions")):
            vals = [v for v in (ov.get(key) or []) if v]
            if vals:
                out.append(f"<h3>{title}</h3>{_bullets(vals)}")

    if results["questions"]:
        out.append("<h2>Risultati per domanda</h2>")
        for q, stats in zip(results["questions"], results["question_stats"]):
            out.append(f"<h3>D{q['index'] + 1}. {escape(q['text'])}</h3>")
            out.append(f'<p class="muted">Risposte: {stats["answered"]} su {stats["submitted"]}</p>')
            if q["type"] == "mcq":
                if stats.get("correct_percent") is not None:
                    out.append(f"<p>Risposte corrette: <b>{stats['correct_percent']}%</b></p>")
                total = max(stats["answered"], 1)
                rows = "".join(
                    f'<tr><td style="width:40%">{"<b>✓ </b>" if i == q["correct_index"] else ""}{escape(opt)}</td>'
                    f'<td style="width:50%">{_bar(round(n / total * 100), i == q["correct_index"])}</td>'
                    f'<td style="width:10%">{n}</td></tr>'
                    for i, (opt, n) in enumerate(zip(q["options"], stats["distribution"]))
                )
                out.append(f"<table>{rows}</table>")
            elif q["type"] == "scale":
                out.append(f"<p>Media: <b>{stats.get('average') if stats.get('average') is not None else '—'}</b> (scala {q['min']}–{q['max']})</p>")
            else:
                out.append('<p class="muted">Domanda aperta: risposte nella tabella sotto.</p>')

    out.append("<h2>Risposte degli studenti</h2>")
    if results["questions"]:
        head = "".join(f"<th>D{q['index'] + 1}</th>" for q in results["questions"])
        body = []
        for row in _submitted_rows(results):
            cells = "".join(
                f'<td class="{"ok" if c["correct"] is True else "ko" if c["correct"] is False else ""}">{escape(c["display"]) or "—"}</td>'
                for c in row["answers"]
            )
            body.append(f"<tr><td><b>{escape(row['student_nickname'])}</b></td>{cells}<td>{escape(row['score'] or '')}</td></tr>")
        out.append(f"<table><tr><th>Studente</th>{head}<th>Punteggio</th></tr>{''.join(body)}</table>")
    else:
        body = "".join(
            f"<tr><td><b>{escape(r['student_nickname'])}</b></td>"
            f"<td>{escape(r['text'] or '')}</td>"
            f"<td>{escape(r['score'] or '')}</td></tr>"
            for r in _submitted_rows(results)
        )
        out.append(f"<table><tr><th style='width:18%'>Studente</th><th>Risposta</th><th style='width:10%'>Voto</th></tr>{body}</table>")

    if analysis and analysis.get("student_reports"):
        out.append("<h2>Note per studente (AI)</h2>")
        for rep in analysis["student_reports"]:
            out.append(f"<h3>{escape(str(rep.get('student_nickname') or ''))}</h3>")
            if rep.get("response_summary"):
                out.append(f"<p>{escape(str(rep['response_summary']))}</p>")
    return f"<html><body>{''.join(out)}</body></html>"


def results_report_pdf(results: dict, session_title: str, analysis: dict | None = None) -> bytes:
    import pymupdf

    html = results_report_html(results, session_title, analysis)
    story = pymupdf.Story(html=html, user_css=_CSS)
    buffer = io.BytesIO()
    writer = pymupdf.DocumentWriter(buffer)
    mediabox = pymupdf.paper_rect("a4")
    where = mediabox + (36, 36, -36, -36)
    more = True
    while more:
        device = writer.begin_page(mediabox)
        more, _ = story.place(where)
        story.draw(device)
        writer.end_page()
    writer.close()
    return buffer.getvalue()
