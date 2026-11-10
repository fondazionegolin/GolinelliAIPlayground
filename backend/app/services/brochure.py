"""Editable template text travels with the brochure instead of the platform's UI language."""
LABELS_IT = {
    "overview": "Panoramica", "features": "Caratteristiche", "featuresTitle": "Elementi distintivi",
    "benefits": "Vantaggi", "benefitsTitle": "Perché conta", "benefit": "Beneficio",
    "method": "Metodo", "methodTitle": "Come funziona", "step": "Passaggio",
    "stats": "Indicatori", "statsTitle": "Numeri e segnali", "faq": "FAQ", "faqTitle": "Domande frequenti",
    "closing": "Prossimi passi", "footer": "Generato con AI · Fondazione Golinelli",
}


def merge_brochure_patch(original: dict, patch: dict) -> dict:
    merged = {**original, **patch}
    old = original.get("labels") if isinstance(original.get("labels"), dict) else {}
    new = patch.get("labels") if isinstance(patch.get("labels"), dict) else {}
    merged["labels"] = {**old, **new}
    return merged
