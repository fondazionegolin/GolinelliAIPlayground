from contextvars import ContextVar
from typing import Optional


SUPPORTED_UI_LANGUAGES = {"it", "en"}


def resolve_ui_language(raw_language: Optional[str]) -> str:
    if not raw_language:
        return "it"

    normalized = raw_language.strip().lower()
    if not normalized:
        return "it"

    primary = normalized.split(",")[0].split(";")[0].strip()
    base = primary.split("-")[0]
    return base if base in SUPPORTED_UI_LANGUAGES else "it"


def build_output_language_instruction(ui_language: str) -> str:
    if ui_language == "en":
        return (
            "OUTPUT LANGUAGE:\n"
            "- Reply in English by default.\n"
            "- Keep the answer fully in English unless the user explicitly asks for another language or provides quoted source text in a different language.\n"
            "- If you generate structured content, labels, quiz text, examples, or explanations, write them in English."
        )

    return (
        "LINGUA DI OUTPUT:\n"
        "- Rispondi in italiano per default.\n"
        "- Mantieni tutta la risposta in italiano, salvo esplicita richiesta dell'utente di usare un'altra lingua o presenza di testo citato in altra lingua.\n"
        "- Se generi contenuti strutturati, etichette, quiz, esempi o spiegazioni, scrivili in italiano."
    )


RESPONSE_LENGTHS = {"concise", "extended", "in_depth"}
DEFAULT_RESPONSE_LENGTH = "concise"

# Set per request by ResponseLengthMiddleware from the X-Response-Length header, so every chat endpoint that
# builds its system prompt through apply_output_language_instruction honours the user's choice.
response_length_var: ContextVar[str] = ContextVar("response_length", default=DEFAULT_RESPONSE_LENGTH)

_LENGTH_GUIDE_IT = {
    "concise": (
        "- Sii CONCISO: vai dritto al punto in 2-5 frasi (indicativamente meno di 90 parole).\n"
        "- Niente preamboli, niente ripetizione della domanda, niente riepilogo finale, niente elenchi di opzioni non richieste.\n"
        "- Usa elenchi puntati solo se rendono la risposta più breve; offri di approfondire solo in una frase."
    ),
    "extended": (
        "- Rispondi in modo ESTESO ma ordinato: circa 150-250 parole, con un esempio quando aiuta.\n"
        "- Evita ripetizioni e premesse inutili; struttura in brevi paragrafi."
    ),
    "in_depth": (
        "- Rispondi in modo APPROFONDITO: trattazione strutturata (anche con sezioni), ragionamento passo-passo, esempi, casi limite e collegamenti utili.\n"
        "- Resta pertinente: approfondisci, non divagare."
    ),
}
_LENGTH_GUIDE_EN = {
    "concise": (
        "- Be CONCISE: get straight to the point in 2-5 sentences (roughly under 90 words).\n"
        "- No preambles, no restating the question, no closing recap, no unrequested lists of options.\n"
        "- Use bullets only when they make the answer shorter; offer to elaborate in at most one sentence."
    ),
    "extended": (
        "- Answer at EXTENDED length but tidy: about 150-250 words, with an example when it helps.\n"
        "- Avoid repetition and needless preamble; use short paragraphs."
    ),
    "in_depth": (
        "- Answer IN DEPTH: structured treatment (sections allowed), step-by-step reasoning, examples, edge cases and useful connections.\n"
        "- Stay relevant: go deeper, do not ramble."
    ),
}


def normalize_response_length(raw: Optional[str]) -> str:
    value = (raw or "").strip().lower().replace("-", "_")
    return value if value in RESPONSE_LENGTHS else DEFAULT_RESPONSE_LENGTH


def build_response_length_instruction(ui_language: str, length: Optional[str] = None) -> str:
    level = normalize_response_length(length or response_length_var.get())
    if ui_language == "en":
        return (
            "RESPONSE LENGTH:\n" + _LENGTH_GUIDE_EN[level] + "\n"
            "- This governs conversational replies only: never truncate documents, code, quizzes or other structured content the user explicitly asks for, and obey explicit length requests from the user."
        )
    return (
        "LUNGHEZZA DELLE RISPOSTE:\n" + _LENGTH_GUIDE_IT[level] + "\n"
        "- Vale per le risposte conversazionali: non troncare documenti, codice, quiz o altri contenuti strutturati richiesti esplicitamente, e rispetta eventuali richieste esplicite di lunghezza dell'utente."
    )


def apply_output_language_instruction(system_prompt: str, ui_language: str) -> str:
    return (
        f"{system_prompt.rstrip()}\n\n{build_output_language_instruction(ui_language)}"
        f"\n\n{build_response_length_instruction(ui_language)}"
    )
