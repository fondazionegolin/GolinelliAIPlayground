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
        "title": "Privacy e DPA",
        "version": "2026-02",
        "source_url": "/docs/informativa-privacy.pdf",
        "accept_label": "Accetto Privacy e DPA",
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
