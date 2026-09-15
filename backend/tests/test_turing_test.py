from types import SimpleNamespace

from app.api.v1.endpoints.turing import _activate_experiment, _human_typing_delay, _report, _student_payload
from app.realtime import gateway


def test_online_student_ids_are_unique_and_exclude_teachers_and_observers():
    session_id = "turing-session"
    gateway.session_presence[session_id] = {"student-a-1", "student-a-2", "student-b", "teacher", "observer"}
    gateway.connected_users.update({
        "student-a-1": {"id": "student-a", "type": "student", "session_id": session_id},
        "student-a-2": {"id": "student-a", "type": "student", "session_id": session_id},
        "student-b": {"id": "student-b", "type": "student", "session_id": session_id},
        "teacher": {"id": "teacher-a", "type": "teacher"},
        "observer": {"id": "student-c", "type": "student", "session_id": session_id, "subjective_observer": True},
    })
    try:
        assert set(gateway.get_online_student_ids(session_id)) == {"student-a", "student-b"}
    finally:
        for sid in gateway.session_presence.pop(session_id):
            gateway.connected_users.pop(sid, None)


def test_experiment_starts_immediately_with_all_connected_students(monkeypatch):
    students = [SimpleNamespace(id="student-a"), SimpleNamespace(id="student-b")]
    experiment = SimpleNamespace(id="experiment-id", status="LOBBY", participant_count=0,
                                 human_student_id=None, started_at=None)
    monkeypatch.setattr("app.api.v1.endpoints.turing.secrets.choice", lambda values: values[0])

    participants = _activate_experiment(experiment, students)

    assert experiment.status == "ACTIVE"
    assert experiment.participant_count == 2
    assert experiment.human_student_id == "student-a"
    assert experiment.started_at is not None
    assert [participant.status for participant in participants] == ["ACTIVE", "ACTIVE"]
    assert [participant.is_human for participant in participants] == [True, False]


def test_human_typing_delay_grows_with_response_length_and_stays_bounded():
    short = _human_typing_delay("Sì, credo di sì.")
    medium = _human_typing_delay(" ".join(["risposta"] * 35))
    long = _human_typing_delay(" ".join(["risposta"] * 200))

    assert 0.9 <= short < medium < long <= 5.5


def test_report_builds_confusion_matrix_and_accuracy():
    experiment = SimpleNamespace(participants=[
        SimpleNamespace(is_human=True, guess="HUMAN", confidence=4),
        SimpleNamespace(is_human=False, guess="HUMAN", confidence=3),
        SimpleNamespace(is_human=False, guess="AI", confidence=5),
        SimpleNamespace(is_human=False, guess=None, confidence=None),
    ])

    report = _report(experiment)

    assert report["completed_participants"] == 3
    assert report["accuracy"] == 0.6667
    assert report["human_recognized"] is True
    assert report["false_human_guesses"] == 1
    assert report["confusion_matrix"] == {
        "human_guessed_human": 1,
        "human_guessed_ai": 0,
        "ai_guessed_human": 1,
        "ai_guessed_ai": 1,
    }


def test_report_excludes_students_not_available_at_start():
    experiment = SimpleNamespace(participants=[
        SimpleNamespace(status="ACTIVE", is_human=True, guess="HUMAN", confidence=4),
        SimpleNamespace(status="ACTIVE", is_human=False, guess="AI", confidence=3),
        SimpleNamespace(status="EXCLUDED", is_human=False, guess=None, confidence=None),
    ])

    report = _report(experiment)

    assert report["total_participants"] == 2
    assert report["completed_participants"] == 2
    assert report["accuracy"] == 1


def test_student_payload_hides_assignment_until_completion():
    participant = SimpleNamespace(
        id="participant-id",
        question_count=0,
        guess=None,
        confidence=None,
        rationale=None,
        is_human=True,
        messages=[],
    )
    experiment = SimpleNamespace(
        id="experiment-id",
        title="Test",
        status="ACTIVE",
        max_questions=5,
        persona_name="Ada",
        avatar_url="/uploads/generated/ada.webp",
        started_at=None,
        completed_at=None,
    )

    active_payload = _student_payload(experiment, participant)
    assert active_payload["participant"]["actual_role"] is None
    assert active_payload["experiment"]["persona_name"] == "Ada"
    assert active_payload["experiment"]["avatar_url"] == "/uploads/generated/ada.webp"

    experiment.status = "COMPLETED"
    completed_payload = _student_payload(experiment, participant)
    assert completed_payload["participant"]["actual_role"] == "HUMAN"
