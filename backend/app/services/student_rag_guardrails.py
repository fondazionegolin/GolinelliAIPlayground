import re


STUDENT_RAG_NO_ANSWER = "Questa informazione non è presente nei documenti che hai caricato."
_STUDENT_RAG_CITATION_RE = re.compile(r"\[\[(\d+)\]\]")
_STUDENT_RAG_EXTERNAL_REF_RE = re.compile(
    r"(https?://|www\.|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:it|com|org|net|edu|gov|info|io)\b)",
    re.IGNORECASE,
)


def build_student_rag_history_context(history: list[dict]) -> str:
    """Keep only prior user turns to avoid feeding prior assistant hallucinations back in."""
    prior_questions = []
    for item in history:
        if item.get("role") != "user":
            continue
        content = str(item.get("content") or "").strip()
        if content:
            prior_questions.append(content)
    if not prior_questions:
        return ""
    return "\n".join(f"- {question}" for question in prior_questions[-3:])


def is_valid_student_rag_response(response: str, citation_count: int) -> bool:
    text = (response or "").strip()
    if not text:
        return False
    if text == STUDENT_RAG_NO_ANSWER:
        return True
    if _STUDENT_RAG_EXTERNAL_REF_RE.search(text):
        return False

    citation_matches = [int(match) for match in _STUDENT_RAG_CITATION_RE.findall(text)]
    if not citation_matches:
        return False
    if any(index < 1 or index > citation_count for index in citation_matches):
        return False

    return True
