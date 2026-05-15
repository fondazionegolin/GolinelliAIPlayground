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


def apply_output_language_instruction(system_prompt: str, ui_language: str) -> str:
    return f"{system_prompt.rstrip()}\n\n{build_output_language_instruction(ui_language)}"
