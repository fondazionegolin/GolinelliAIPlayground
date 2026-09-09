import json
from types import SimpleNamespace
from uuid import uuid4

from app.api.v1.endpoints.teacher import (
    _format_task_analysis_markdown,
    _parse_structured_task_analysis,
)


def test_task_analysis_is_formatted_and_lists_every_student():
    anna = SimpleNamespace(id=uuid4(), nickname="Anna")
    luca = SimpleNamespace(id=uuid4(), nickname="Luca")
    raw = json.dumps({
        "overview": {
            "summary": "La classe comprende i concetti principali.",
            "completion_summary": "Anna ha consegnato; Luca non ha consegnato.",
            "strengths": ["Buona comprensione generale"],
            "gaps": ["Approfondire gli esempi"],
            "suggestions": ["Riprendere il tema con un esercizio guidato"],
        },
        "student_reports": [{
            "student_nickname": "Anna",
            "response_summary": "Risposta completa e pertinente.",
            "strengths": ["Argomentazione chiara"],
            "gaps": [],
            "suggestions": ["Aggiungere un esempio"],
        }],
        "student_flags": [],
    })

    parsed = _parse_structured_task_analysis(raw, [anna, luca], {str(anna.id)})
    markdown = _format_task_analysis_markdown(
        parsed,
        task_title="Compito di prova",
        session_title="Classe 3A",
        submission_count=1,
        total_students=2,
    )

    assert [report["student_nickname"] for report in parsed["student_reports"]] == ["Anna", "Luca"]
    assert parsed["student_reports"][1]["response_summary"] == "Nessuna risposta consegnata."
    assert "## Sintesi della classe" in markdown
    assert "## Analisi per studente" in markdown
    assert "### Anna" in markdown
    assert "### Luca" in markdown
    assert "**Stato:** Consegna mancante" in markdown
    assert '"overview"' not in markdown


def test_malformed_json_is_not_exposed_to_the_teacher():
    student = SimpleNamespace(id=uuid4(), nickname="Marta")

    parsed = _parse_structured_task_analysis(
        '```json\n{"overview": broken}\n```',
        [student],
        {str(student.id)},
    )
    markdown = _format_task_analysis_markdown(
        parsed,
        task_title="Verifica",
        session_title="Classe 2B",
        submission_count=1,
        total_students=1,
    )

    assert '"overview"' not in markdown
    assert "non è stato possibile organizzarla automaticamente" in markdown
