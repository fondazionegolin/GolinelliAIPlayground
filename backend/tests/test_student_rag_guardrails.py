import importlib.util
from pathlib import Path

MODULE_PATH = Path(__file__).resolve().parents[1] / "app" / "services" / "student_rag_guardrails.py"
SPEC = importlib.util.spec_from_file_location("student_rag_guardrails", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)

STUDENT_RAG_NO_ANSWER = MODULE.STUDENT_RAG_NO_ANSWER
build_student_rag_history_context = MODULE.build_student_rag_history_context
is_valid_student_rag_response = MODULE.is_valid_student_rag_response


def test_student_rag_accepts_exact_no_answer_message():
    assert is_valid_student_rag_response(STUDENT_RAG_NO_ANSWER, 3) is True


def test_student_rag_rejects_response_without_internal_citations():
    response = "Il reddito complessivo e' 148.000 euro."
    assert is_valid_student_rag_response(response, 2) is False


def test_student_rag_rejects_external_domains():
    response = "Consulta davideberti.it per capire il rigo corretto [[1]]"
    assert is_valid_student_rag_response(response, 2) is False


def test_student_rag_rejects_out_of_range_citations():
    response = "Il valore indicato e' 26.000 euro [[3]]"
    assert is_valid_student_rag_response(response, 2) is False


def test_student_rag_history_keeps_only_user_messages():
    history = [
        {"role": "user", "content": "prima domanda"},
        {"role": "assistant", "content": "risposta sbagliata [[1]]"},
        {"role": "user", "content": "seconda domanda"},
    ]

    assert build_student_rag_history_context(history) == "- prima domanda\n- seconda domanda"
