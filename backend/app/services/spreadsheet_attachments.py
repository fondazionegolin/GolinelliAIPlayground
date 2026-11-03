"""Read Excel attachments through the same extractor used by document chat."""
from app.services.document_processor import document_processor


def is_excel(filename: str, mime_type: str) -> bool:
    return filename.lower().endswith((".xlsx", ".xls")) or mime_type in {
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel",
    }


def extract_excel_text(file_data: bytes) -> str:
    steps: list[str] = []
    text, _ = document_processor._extract_xlsx(file_data, steps)
    if not text.strip():
        raise ValueError("File Excel non leggibile: verifica che non sia danneggiato o protetto da password")
    return text
