LEGAL_DOCUMENTS = [
    {
        "key": "license_terms",
        "title": "Termini e licenza piattaforma",
        "version": "2026-05",
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
    "version": "2026-10",
    "source_url": "/legal/deployer-agreement",
    "accept_label": "Accetto in qualità di Dirigente/legale rappresentante",
}

TEACHER_USE_DECLARATION = {
    "key": "teacher_use_declaration",
    "title": "Dichiarazione d'uso del docente",
    "version": "2026-10",
    "source_url": "/legal/teacher-declaration",
    "accept_label": "Dichiaro di aver letto e accetto le condizioni d'uso come docente",
}


def required_legal_documents(*, is_school_owner: bool = False, in_school_tenant: bool = False) -> list[dict]:
    """Documenti richiesti a un utente TEACHER, in ordine di accettazione."""
    docs = list(LEGAL_DOCUMENTS)
    if in_school_tenant:
        docs.append(DEPLOYER_AGREEMENT if is_school_owner else TEACHER_USE_DECLARATION)
    return docs
