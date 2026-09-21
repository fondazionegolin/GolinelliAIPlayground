from app.api.v1.endpoints.llm import (
    RealtimeHistoryMessage,
    _format_voice_history,
    _voice_mode_wrapper,
)


def test_voice_wrapper_continues_existing_conversation_without_restarting():
    history = [
        RealtimeHistoryMessage(role="user", content="Perché il cielo è blu?"),
        RealtimeHistoryMessage(role="assistant", content="Dipende dalla diffusione di Rayleigh."),
        RealtimeHistoryMessage(role="user", content="E al tramonto cosa cambia?"),
    ]

    instructions = _voice_mode_wrapper(
        "Sei un tutor di scienze.",
        "it",
        exam_mode=False,
        history=history,
    )

    assert "Perché il cielo è blu?" in instructions
    assert "E al tramonto cosa cambia?" in instructions
    assert "La conversazione è già in corso" in instructions
    assert "non salutare" in instructions
    assert "Inizia salutando" not in instructions


def test_voice_history_is_bounded_and_uses_recent_turns():
    history = [
        RealtimeHistoryMessage(role="user", content=f"messaggio-{index} " + ("x" * 1500))
        for index in range(30)
    ]

    formatted = _format_voice_history(history, is_english=False)

    assert "messaggio-29" in formatted
    assert "messaggio-0" not in formatted
    assert len(formatted) < 11000
