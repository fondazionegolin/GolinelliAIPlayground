LEGAL_DOCUMENTS = [
    {
        "key": "license_terms",
        "title": "Termini e licenza piattaforma",
        "version": "2026-11",
        "source_url": "/terms",
        "accept_label": "Accetto termini e licenza",
    },
    {
        "key": "ai_act_dpia",
        "title": "AI Act DPIA",
        "version": "2026-06",
        "source_url": "/docs/audit-ai.pdf",
        "accept_label": "Accetto AI Act DPIA",
    },
    {
        "key": "privacy_dpa",
        "title": "Informativa privacy e DPA",
        "version": "2.0",
        "source_url": "/docs/informativa-privacy-v2.0.pdf",
        "accept_label": "Ho letto e accetto l’informativa privacy e DPA",
    },
]

# Consents shown to students (not teachers) for specific third-party providers used
# by a platform feature. Tracked separately from LEGAL_DOCUMENTS because students
# authenticate as SessionStudent, not User.
STUDENT_CONSENTS = [
    {
        "key": "deepseek_privacy",
        "title": "Informativa privacy DeepSeek",
        "version": "2026-09",
        "source_url": "https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html",
        "accept_label": "Ho letto e accetto",
    },
]


# ── Onboarding istituti: doppia accettazione ─────────────────────────────────
# Il dirigente (school owner) accetta, oltre ai documenti base, l'accordo con cui
# assume il ruolo di deployer/titolare nel proprio istituto. I docenti invitati
# dal dirigente accettano, oltre ai documenti base, la dichiarazione d'uso.
DEPLOYER_AGREEMENT = {
    "key": "deployer_agreement",
    "title": "Accordo di adozione e responsabilità del Dirigente (deployer)",
    "version": "2026-10-27",  # allineato all'informativa privacy v2.0 del 26/10/2026
    "source_url": "/legal/deployer-agreement",
    "accept_label": "Accetto in qualità di Dirigente/legale rappresentante",
}

TEACHER_USE_DECLARATION = {
    "key": "teacher_use_declaration",
    "title": "Dichiarazione d'uso del docente",
    "version": "2026-10-27",  # allineata all'informativa privacy v2.0 del 26/10/2026
    "source_url": "/legal/teacher-declaration",
    "accept_label": "Dichiaro di aver letto e accetto le condizioni d'uso come docente",
}


def required_legal_documents(*, is_school_owner: bool = False, in_school_tenant: bool = False) -> list[dict]:
    """Documenti richiesti a un utente TEACHER, in ordine di accettazione."""
    docs = apply_overrides(LEGAL_DOCUMENTS)
    if in_school_tenant:
        docs.append(DEPLOYER_AGREEMENT if is_school_owner else TEACHER_USE_DECLARATION)
    return docs


# ── Override caricati dal pannello admin (sezione Licenze) ───────────────────
# Un documento caricato dall'admin sostituisce versione, titolo e sorgente del
# documento base con la stessa chiave. Cache in-process con TTL breve: il
# controllo di accettazione è sul percorso caldo di ogni richiesta docente.
_OVERRIDE_TTL_SECONDS = 15.0
_overrides: dict[str, dict] = {}
_overrides_loaded_at: float = 0.0

EDITABLE_DOCUMENT_KEYS = tuple(doc["key"] for doc in LEGAL_DOCUMENTS)


def legal_file_url(key: str, version: str) -> str:
    return f"/api/v1/legal-docs/{key}/{version}/file.pdf"


def set_overrides(rows: dict[str, dict]) -> None:
    global _overrides, _overrides_loaded_at
    import time

    _overrides = rows
    _overrides_loaded_at = time.monotonic()


async def refresh_legal_overrides(db, *, force: bool = False) -> None:
    """Ricarica gli override dal DB se la cache è scaduta."""
    import time

    if not force and time.monotonic() - _overrides_loaded_at < _OVERRIDE_TTL_SECONDS:
        return
    from sqlalchemy import select
    from app.models.legal_document import LegalDocumentFile

    rows = (
        await db.execute(select(LegalDocumentFile).order_by(LegalDocumentFile.uploaded_at.asc()))
    ).scalars().all()
    latest = {row.document_key: row for row in rows}  # l'ultimo caricato vince
    set_overrides({
        key: {"version": row.version, "title": row.title, "source_url": legal_file_url(key, row.version)}
        for key, row in latest.items()
    })


def apply_overrides(docs: list[dict]) -> list[dict]:
    return [{**doc, **_overrides[doc["key"]]} if doc["key"] in _overrides else doc for doc in docs]


def current_legal_documents() -> list[dict]:
    return apply_overrides(LEGAL_DOCUMENTS)
