"""PDF report of a finished live interaction: per-student performance, response times and every answer given."""
from __future__ import annotations

import html
import io
import statistics
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

import fitz  # PyMuPDF
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.live_interaction import LiveEscapeParticipant, LiveInteraction, LiveInteractionResponse
from app.models.session import Class, Session, SessionStudent
from app.models.user import User

SENTIMENT_LABEL = {"positive": "Positivo", "neutral": "Neutro", "negative": "Negativo"}
TYPE_LABEL = {"mcq": "Quiz a risposta multipla", "wordwall": "Nuvola di parole", "opinion": "Opinione", "feedback": "Feedback rapido"}


def _esc(value: Any) -> str:
    return html.escape("" if value is None else str(value))


def _parse(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


def fmt_seconds(value: float | None) -> str:
    if value is None:
        return "—"
    if value < 10:
        return f"{value:.1f} s"
    total = int(round(value))
    return f"{total} s" if total < 60 else f"{total // 60} min {total % 60:02d} s"


def fmt_dt(value: datetime | None) -> str:
    return value.astimezone().strftime("%d/%m/%Y %H:%M") if value else "—"


def pct(part: int, whole: int) -> str:
    return f"{round(100 * part / whole)}%" if whole else "—"


def answer_text(slide: dict, response: dict) -> str:
    kind = slide.get("type")
    if kind == "mcq":
        options = slide.get("options") or []
        index = response.get("selected_option")
        if isinstance(index, int) and 0 <= index < len(options):
            return f"{chr(65 + index)}. {options[index]}"
        return "—"
    if kind == "wordwall":
        return ", ".join(str(word) for word in response.get("words") or []) or "—"
    if kind == "feedback":
        return SENTIMENT_LABEL.get(str(response.get("sentiment")), str(response.get("sentiment") or "—"))
    return str(response.get("text") or "—")


def is_graded(slide: dict) -> bool:
    return slide.get("type") == "mcq" and isinstance(slide.get("correct_option"), int)


async def collect(db: AsyncSession, li: LiveInteraction) -> dict[str, Any]:
    """Everything the report prints, as plain data (also what the tests assert on)."""
    session = (await db.execute(select(Session).where(Session.id == li.session_id))).scalar_one_or_none()
    klass = (await db.execute(select(Class).where(Class.id == session.class_id))).scalar_one_or_none() if session else None
    teacher = (await db.execute(select(User).where(User.id == li.created_by))).scalar_one_or_none()
    students = (await db.execute(select(SessionStudent).where(SessionStudent.session_id == li.session_id))).scalars().all()
    meta = {
        "title": li.title,
        "session": getattr(session, "name", None),
        "class": getattr(klass, "name", None),
        "teacher": " ".join(filter(None, [getattr(teacher, "first_name", None), getattr(teacher, "last_name", None)])) or None,
        "started_at": li.started_at,
        "ended_at": li.ended_at,
        "duration": (li.ended_at - li.started_at).total_seconds() if li.started_at and li.ended_at else None,
        "enrolled": len(students),
        "type": li.interaction_type,
    }
    if li.interaction_type == "escape_room":
        return {"meta": meta, **await _collect_escape(db, li)}
    return {"meta": meta, **await _collect_slides(db, li, students)}


async def _collect_slides(db: AsyncSession, li: LiveInteraction, students: list[SessionStudent]) -> dict[str, Any]:
    slides = li.slides_json or []
    timings = {int(k): _parse(v) for k, v in (li.slide_timings or {}).items()}
    if 0 not in timings:
        timings[0] = li.started_at
    rows = (await db.execute(
        select(LiveInteractionResponse, SessionStudent.nickname)
        .join(SessionStudent, LiveInteractionResponse.student_id == SessionStudent.id)
        .where(LiveInteractionResponse.live_interaction_id == li.id)
        .order_by(LiveInteractionResponse.slide_index, LiveInteractionResponse.created_at)
    )).all()

    per_slide: list[dict] = [{"index": i, "slide": slide, "responses": []} for i, slide in enumerate(slides)]
    per_student: dict[str, dict] = {}
    for response, nickname in rows:
        if response.slide_index >= len(slides):
            continue
        slide = slides[response.slide_index]
        started = timings.get(response.slide_index)
        seconds = max(0.0, (response.created_at - started).total_seconds()) if started and response.created_at else None
        graded = is_graded(slide)
        correct = (response.response_json or {}).get("selected_option") == slide.get("correct_option") if graded else None
        entry = {"nickname": nickname, "text": answer_text(slide, response.response_json or {}), "correct": correct, "seconds": seconds,
                 "option": (response.response_json or {}).get("selected_option")}
        per_slide[response.slide_index]["responses"].append(entry)
        stats = per_student.setdefault(nickname, {"nickname": nickname, "answered": 0, "graded": 0, "correct": 0, "times": []})
        stats["answered"] += 1
        if graded:
            stats["graded"] += 1
            stats["correct"] += 1 if correct else 0
        if seconds is not None:
            stats["times"].append(seconds)

    for student in students:
        per_student.setdefault(student.nickname, {"nickname": student.nickname, "answered": 0, "graded": 0, "correct": 0, "times": []})
    ranking = []
    for stats in per_student.values():
        times = stats.pop("times")
        stats["avg_seconds"] = statistics.fmean(times) if times else None
        stats["min_seconds"] = min(times) if times else None
        stats["max_seconds"] = max(times) if times else None
        stats["accuracy"] = stats["correct"] / stats["graded"] if stats["graded"] else None
        ranking.append(stats)
    ranking.sort(key=lambda s: (-(s["accuracy"] if s["accuracy"] is not None else -1), -s["answered"], s["avg_seconds"] if s["avg_seconds"] is not None else 1e9, s["nickname"].lower()))

    all_times = [r["seconds"] for s in per_slide for r in s["responses"] if r["seconds"] is not None]
    graded_total = sum(s["graded"] for s in ranking)
    correct_total = sum(s["correct"] for s in ranking)
    return {
        "slides": per_slide,
        "students": ranking,
        "summary": {
            "participants": sum(1 for s in ranking if s["answered"]),
            "responses": sum(s["answered"] for s in ranking),
            "graded": graded_total,
            "correct": correct_total,
            "avg_seconds": statistics.fmean(all_times) if all_times else None,
            "median_seconds": statistics.median(all_times) if all_times else None,
            "slides": len(slides),
        },
    }


async def _collect_escape(db: AsyncSession, li: LiveInteraction) -> dict[str, Any]:
    challenges = li.slides_json or []
    rows = (await db.execute(
        select(LiveEscapeParticipant, SessionStudent.nickname)
        .join(SessionStudent, LiveEscapeParticipant.student_id == SessionStudent.id)
        .where(LiveEscapeParticipant.live_interaction_id == li.id)
    )).all()
    now = datetime.now(timezone.utc)
    participants = []
    for participant, nickname in rows:
        end = participant.completed_at or li.ended_at or now
        participants.append({
            "nickname": nickname,
            "completed": participant.completed_at is not None,
            "step": participant.current_step,
            "attempts": participant.attempts,
            "duration": max(0.0, (end - participant.started_at).total_seconds()),
            "answers": participant.answers_json or [],
            "started_at": participant.started_at,
        })
    participants.sort(key=lambda p: (not p["completed"], p["duration"] if p["completed"] else -p["step"]))
    rank = 0
    for p in participants:
        rank += 1 if p["completed"] else 0
        p["rank"] = rank if p["completed"] else None
    per_challenge = []
    for index, challenge in enumerate(challenges):
        tries = [a for p in participants for a in p["answers"] if a.get("step_index") == index]
        per_challenge.append({
            "index": index,
            "statement": challenge.get("false_statement", ""),
            "prompt": challenge.get("prompt", ""),
            "accepted": [str(a) for a in challenge.get("accepted_answers") or []],
            "attempts": len(tries),
            "correct": sum(1 for a in tries if a.get("correct")),
            "solved_by": sum(1 for p in participants if p["step"] > index),
        })
    durations = [p["duration"] for p in participants if p["completed"]]
    return {
        "challenges": per_challenge,
        "participants": participants,
        "summary": {
            "participants": len(participants),
            "completed": len(durations),
            "avg_seconds": statistics.fmean(durations) if durations else None,
            "attempts": sum(p["attempts"] for p in participants),
        },
    }


# ── rendering ─────────────────────────────────────────────────────────────────

CSS = """
body { font-family: sans-serif; font-size: 9.5pt; color: #1e293b; }
h1 { font-size: 20pt; color: #1a1a2e; margin: 0 0 2pt 0; }
h2 { font-size: 13pt; color: #1a1a2e; margin: 14pt 0 5pt 0; padding-bottom: 2pt; border-bottom: 1.5pt solid #e85c8d; }
h3 { font-size: 11pt; margin: 10pt 0 2pt 0; color: #1a1a2e; }
p { margin: 2pt 0; }
.muted { color: #64748b; font-size: 8.5pt; }
.pill { font-size: 8pt; color: #be185d; }
table { border-collapse: collapse; width: 100%; margin: 4pt 0 6pt 0; }
th { color: #475569; font-size: 8pt; text-align: left; padding: 3pt 4pt; border-bottom: 1.2pt solid #1a1a2e; }
td { padding: 3pt 4pt; border-bottom: 0.5pt solid #e2e8f0; font-size: 9pt; }
.num { text-align: right; }
.ok { color: #047857; font-weight: bold; }
.ko { color: #b91c1c; font-weight: bold; }
.kpi td { background-color: #f1f5f9; text-align: center; border: 2pt solid #ffffff; padding: 6pt 3pt; }
.kpi .v { font-size: 15pt; font-weight: bold; color: #1a1a2e; }
.kpi .l { font-size: 7.5pt; color: #64748b; }
"""


def _kpis(items: list[tuple[str, str]]) -> str:
    cells = "".join(f'<td><span class="v">{_esc(v)}</span><br/><span class="l">{_esc(l)}</span></td>' for v, l in items)
    return f'<table class="kpi"><tr>{cells}</tr></table>'


def _meta_block(meta: dict) -> str:
    kind = "Escape room" if meta["type"] == "escape_room" else "Sessione interattiva"
    lines = [
        f"{kind} · Classe: {_esc(meta['class'] or '—')} · Sessione: {_esc(meta['session'] or '—')}",
        f"Docente: {_esc(meta['teacher'] or '—')} · Inizio: {fmt_dt(meta['started_at'])} · Fine: {fmt_dt(meta['ended_at'])} · Durata: {fmt_seconds(meta['duration'])}",
    ]
    return "".join(f'<p class="muted">{line}</p>' for line in lines)


def render_html(data: dict[str, Any]) -> str:
    meta = data["meta"]
    parts = [f"<h1>{_esc(meta['title'])}</h1>", '<p class="pill">REPORT DELLA SESSIONE LIVE</p>', _meta_block(meta)]
    parts.append(_render_escape(data) if meta["type"] == "escape_room" else _render_slides(data))
    parts.append(f'<p class="muted">Documento generato il {fmt_dt(datetime.now(timezone.utc))} da Golinelli.ai. I tempi di risposta sono misurati dal momento in cui la domanda è stata mostrata alla classe.</p>')
    return "".join(parts)


def _render_slides(data: dict[str, Any]) -> str:
    meta, summary = data["meta"], data["summary"]
    out = ["<h2>Riepilogo della classe</h2>"]
    out.append(_kpis([
        (f"{summary['participants']}/{meta['enrolled']}", "partecipanti"),
        (str(summary["slides"]), "domande/attività"),
        (str(summary["responses"]), "risposte raccolte"),
        (pct(summary["correct"], summary["graded"]), "risposte corrette"),
        (fmt_seconds(summary["avg_seconds"]), "tempo medio di risposta"),
    ]))

    out.append("<h2>Indicatori per studente</h2>")
    out.append('<table><tr><th>Studente</th><th class="num">Risposte</th><th class="num">Corrette</th><th class="num">Accuratezza</th>'
               '<th class="num">Tempo medio</th><th class="num">Più veloce</th><th class="num">Più lento</th></tr>')
    for s in data["students"]:
        accuracy = "—" if s["accuracy"] is None else f"{round(100 * s['accuracy'])}%"
        correct = f"{s['correct']}/{s['graded']}" if s["graded"] else "—"
        absent = ' <span class="muted">(non ha risposto)</span>' if not s["answered"] else ""
        out.append(f"<tr><td>{_esc(s['nickname'])}{absent}</td><td class=\"num\">{s['answered']}/{summary['slides']}</td><td class=\"num\">{correct}</td>"
                   f"<td class=\"num\">{accuracy}</td><td class=\"num\">{fmt_seconds(s['avg_seconds'])}</td>"
                   f"<td class=\"num\">{fmt_seconds(s['min_seconds'])}</td><td class=\"num\">{fmt_seconds(s['max_seconds'])}</td></tr>")
    out.append("</table>")

    out.append("<h2>Dettaglio per domanda</h2>")
    for item in data["slides"]:
        slide, responses = item["slide"], item["responses"]
        times = [r["seconds"] for r in responses if r["seconds"] is not None]
        label = TYPE_LABEL.get(slide.get("type"), "Attività")
        out.append(f"<h3>{item['index'] + 1}. {_esc(slide.get('question') or slide.get('prompt') or '')}</h3>")
        graded_note = ""
        if is_graded(slide):
            ok = sum(1 for r in responses if r["correct"])
            graded_note = f" · corrette {ok}/{len(responses)} ({pct(ok, len(responses))})"
        out.append(f'<p class="muted">{label} · {len(responses)}/{meta["enrolled"]} risposte{graded_note} · tempo medio {fmt_seconds(statistics.fmean(times) if times else None)}</p>')
        if slide.get("type") == "mcq":
            out.append('<table><tr><th>Opzione</th><th class="num">Scelte</th><th class="num">Quota</th></tr>')
            for index, option in enumerate(slide.get("options") or []):
                count = sum(1 for r in responses if r["option"] == index)
                right = index == slide.get("correct_option")
                mark = ' <span class="ok">✓ corretta</span>' if right else ""
                out.append(f"<tr><td>{chr(65 + index)}. {_esc(option)}{mark}</td><td class=\"num\">{count}</td>"
                           f"<td class=\"num\">{pct(count, len(responses))}</td></tr>")
            out.append("</table>")
        if responses:
            out.append('<table><tr><th>Studente</th><th>Risposta</th><th>Esito</th><th class="num">Tempo</th></tr>')
            for r in sorted(responses, key=lambda r: (r["seconds"] is None, r["seconds"] or 0)):
                esito = "" if r["correct"] is None else ('<span class="ok">Corretta</span>' if r["correct"] else '<span class="ko">Errata</span>')
                out.append(f"<tr><td>{_esc(r['nickname'])}</td><td>{_esc(r['text'])}</td><td>{esito}</td><td class=\"num\">{fmt_seconds(r['seconds'])}</td></tr>")
            out.append("</table>")
        else:
            out.append('<p class="muted">Nessuna risposta raccolta.</p>')
    return "".join(out)


def _render_escape(data: dict[str, Any]) -> str:
    summary = data["summary"]
    out = ["<h2>Riepilogo della classe</h2>"]
    out.append(_kpis([
        (str(summary["participants"]), "partecipanti"),
        (f"{summary['completed']}/{summary['participants']}", "hanno completato"),
        (fmt_seconds(summary["avg_seconds"]), "tempo medio di completamento"),
        (str(summary["attempts"]), "tentativi totali"),
    ]))
    out.append("<h2>Classifica e indicatori per studente</h2>")
    out.append('<table><tr><th class="num">#</th><th>Studente</th><th>Stato</th><th class="num">Enigmi risolti</th><th class="num">Tentativi</th><th class="num">Tempo</th></tr>')
    total = len(data["challenges"])
    for p in data["participants"]:
        state = '<span class="ok">Completata</span>' if p["completed"] else "Non completata"
        out.append(f"<tr><td class=\"num\">{p['rank'] or '—'}</td><td>{_esc(p['nickname'])}</td><td>{state}</td>"
                   f"<td class=\"num\">{p['step']}/{total}</td><td class=\"num\">{p['attempts']}</td><td class=\"num\">{fmt_seconds(p['duration'])}</td></tr>")
    out.append("</table><h2>Dettaglio per enigma</h2>")
    for c in data["challenges"]:
        out.append(f"<h3>{c['index'] + 1}. {_esc(c['statement'] or c['prompt'])}</h3>")
        out.append(f'<p class="muted">Risolto da {c["solved_by"]}/{summary["participants"]} · tentativi {c["attempts"]} (corretti {c["correct"]}) · risposta attesa: {_esc(", ".join(c["accepted"]) or "—")}</p>')
    out.append("<h2>Tentativi di ogni studente</h2>")
    for p in data["participants"]:
        if not p["answers"]:
            continue
        out.append(f"<h3>{_esc(p['nickname'])}</h3><table><tr><th>Enigma</th><th>Risposta data</th><th>Esito</th><th class=\"num\">Dopo</th></tr>")
        for a in p["answers"]:
            at = _parse(a.get("submitted_at"))
            after = (at - p["started_at"]).total_seconds() if at and p["started_at"] else None
            esito = '<span class="ok">Corretta</span>' if a.get("correct") else '<span class="ko">Errata</span>'
            out.append(f"<tr><td>{int(a.get('step_index', 0)) + 1}</td><td>{_esc(a.get('value'))}</td><td>{esito}</td><td class=\"num\">{fmt_seconds(after)}</td></tr>")
        out.append("</table>")
    return "".join(out)


def html_to_pdf(body: str, footer: str) -> bytes:
    buffer = io.BytesIO()
    writer = fitz.DocumentWriter(buffer)
    story = fitz.Story(html=f"<body>{body}</body>", user_css=CSS)
    page = fitz.paper_rect("a4")
    area = page + (40, 40, -40, -48)
    more = True
    while more:
        device = writer.begin_page(page)
        more, _ = story.place(area)
        story.draw(device)
        writer.end_page()
    writer.close()
    doc = fitz.open(stream=buffer.getvalue(), filetype="pdf")
    for number, pdf_page in enumerate(doc, start=1):
        pdf_page.insert_text((40, page.height - 26), footer, fontsize=7.5, color=(0.4, 0.45, 0.55))
        label = f"Pagina {number} di {len(doc)}"
        pdf_page.insert_text((page.width - 40 - fitz.get_text_length(label, fontsize=7.5), page.height - 26), label, fontsize=7.5, color=(0.4, 0.45, 0.55))
    out = doc.tobytes(deflate=True)
    doc.close()
    return out


async def build_pdf(db: AsyncSession, li: LiveInteraction) -> bytes:
    import asyncio

    data = await collect(db, li)
    return await asyncio.to_thread(html_to_pdf, render_html(data), f"Golinelli.ai · {li.title}"[:90])
