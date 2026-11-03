import io
from pathlib import Path

import pytest
from openpyxl import Workbook

from app.services.spreadsheet_attachments import extract_excel_text, is_excel


def xlsx_workbook():
    book = Workbook()
    sheet = book.active
    sheet.title = "Vendite"
    sheet.append(["Prodotto", "Quantita", "Prezzo"])
    sheet.append(["Matite", 4, 2.5])
    sheet.append(["Quaderni", 6, 3])
    sheet = book.create_sheet("Obiettivi")
    sheet.append(["Mese", "Totale"])
    sheet.append(["Novembre", 28])
    data = io.BytesIO()
    book.save(data)
    return data.getvalue()


@pytest.mark.parametrize("extension", ["xlsx", "xls"])
def test_excel_chat_extracts_multiple_sheets_headers_and_values(extension):
    data = xlsx_workbook() if extension == "xlsx" else (Path(__file__).parent / "fixtures/chat_excel.xls").read_bytes()
    text = extract_excel_text(data)
    for expected in ["Vendite", "Obiettivi", "Prodotto", "Matite", "Quaderni", "Novembre", "28"]:
        assert expected in text
    assert "media=" in text and "tot=" in text


def test_excel_is_detected_with_generic_clipboard_mime_and_uppercase_extension():
    assert is_excel("DATI.XLSX", "application/octet-stream")
    assert is_excel("dati.xls", "application/octet-stream")
    assert is_excel("clipboard", "application/vnd.ms-excel")
    assert not is_excel("dati.csv", "text/csv")


def test_corrupted_excel_is_reported_instead_of_sending_empty_context():
    with pytest.raises(ValueError, match="File Excel non leggibile"):
        extract_excel_text(b"not an Excel workbook")


@pytest.mark.asyncio
async def test_student_teacherbot_upload_sends_excel_context_and_selected_model(monkeypatch):
    from types import SimpleNamespace
    from unittest.mock import AsyncMock
    from uuid import uuid4
    from fastapi import UploadFile
    from starlette.datastructures import Headers
    from starlette.requests import Request
    from app.api.v1.endpoints import teacherbots
    from app.models.teacherbot import TeacherbotMessage
    from app.services.chat_attachments import message_with_attachment_context

    identity = uuid4()
    student = SimpleNamespace(id=identity, tenant_id=identity)
    conversation = SimpleNamespace(session_id=identity, teacherbot_id=identity)
    session = SimpleNamespace(id=identity)
    class_obj = SimpleNamespace(id=identity, teacher_id=identity, school_grade=None)
    bot = SimpleNamespace(id=identity, enable_escape_room=False, llm_provider="openai", llm_model="bot-default",
                          system_prompt="Aiuta lo studente", temperature=0.7)
    saved = []
    results = [SimpleNamespace(scalar_one_or_none=lambda: conversation),
               SimpleNamespace(first=lambda: (session, class_obj)), SimpleNamespace(scalar_one=lambda: bot),
               SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: [saved[0]]))]
    db = SimpleNamespace(execute=AsyncMock(side_effect=results), add=saved.append, commit=AsyncMock(), refresh=AsyncMock())
    monkeypatch.setattr(teacherbots, "validate_selection", AsyncMock(return_value=("openrouter", "vendor/chosen")))
    monkeypatch.setattr(teacherbots, "_build_kb_context", AsyncMock(return_value=""))
    monkeypatch.setattr(teacherbots, "save_document_thumbnail", AsyncMock(return_value=None))
    monkeypatch.setattr(teacherbots, "route_image_intent", AsyncMock(return_value={"intent": "none"}))

    async def anonymize(text):
        return SimpleNamespace(text=text)

    async def augment(messages):
        return messages

    monkeypatch.setattr(teacherbots, "anonymize_text_async", anonymize)
    monkeypatch.setattr(teacherbots, "augment_chat_messages_with_urls", augment)
    monkeypatch.setattr(teacherbots.credit_service, "check_availability", AsyncMock(return_value=True))
    monkeypatch.setattr(teacherbots.credit_service, "track_usage", AsyncMock())
    response = SimpleNamespace(content="Ho letto i due fogli", provider="openrouter", model="vendor/chosen", prompt_tokens=50, completion_tokens=10)
    generate = AsyncMock(return_value=response)
    monkeypatch.setattr(teacherbots.llm_service, "generate", generate)
    upload = UploadFile(file=io.BytesIO(xlsx_workbook()), filename="dati.XLSX", headers=Headers({"content-type": "application/octet-stream"}))
    result = await teacherbots.send_teacherbot_message_with_files(
        identity, Request({"type": "http", "headers": []}), db, student,
        content="Riassumi i fogli", files=[upload], llm_provider="openrouter", llm_model="vendor/chosen",
    )
    assert result.model == "vendor/chosen"
    sent = generate.call_args.kwargs
    assert (sent["provider"], sent["model"]) == ("openrouter", "vendor/chosen")
    assert "Vendite" in sent["messages"][-1]["content"] and "Obiettivi" in sent["messages"][-1]["content"]
    assert isinstance(saved[0], TeacherbotMessage)
    assert "Matite" in message_with_attachment_context(saved[0])
