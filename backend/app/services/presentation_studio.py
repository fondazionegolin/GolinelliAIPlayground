"""Presentation Studio: outline-first, template-second AI presentation workflow.

1. Outline  — the LLM writes the *content* slide by slide (layout + texts + speaker notes) and
   recommends templates. The user reviews and edits it, or asks the AI to revise the whole outline
   or a single slide. Nothing visual is decided by the LLM.
2. Style    — the user answers a few style questions and picks one of the curated themes
   (presentation_themes), previewed on their own slides.
3. Render   — deterministic: outline + theme → editor slides (presentation_layouts) → quality pass
   (presentation_quality). No LLM, so what is rendered is exactly what was approved.
"""
from __future__ import annotations

import json
import uuid
from typing import Optional

from app.services.presentation_layouts import LAYOUTS, coerce_layout, normalize_content, render_outline_slide
from app.services.presentation_quality import check_and_fix_slides
from app.services.presentation_themes import THEMES, THEMES_BY_ID, resolve_theme

DENSITY_RULES = {
    "essenziale": {"max_points": 3, "max_words": 10, "label": "poche parole chiave per slide, il resto nelle note"},
    "bilanciata": {"max_points": 4, "max_words": 16, "label": "frasi brevi e complete"},
    "dettagliata": {"max_points": 6, "max_words": 24, "label": "punti più ricchi, adatti allo studio autonomo"},
}

OUTLINE_SYSTEM_PROMPT = (
    "Sei un instructional designer esperto di presentazioni didattiche. Progetti il CONTENUTO di una "
    "presentazione slide per slide: messaggio di ogni slide, testi, layout più adatto e note per chi presenta. "
    "Non ti occupi di colori, caratteri o posizioni: quelli li sceglierà l'utente dopo. "
    "Regole: una sola idea per slide; titoli che dicono il messaggio (max 9 parole); niente testo copiato "
    "alla lettera dalle fonti ma sintetizzato; i dettagli vanno nelle note, non nella slide; usa i dati "
    "e le citazioni solo se presenti nelle fonti o certi, mai inventati. Rispondi solo con JSON valido."
)

LAYOUT_GUIDE = (
    "Layout disponibili (scegli quello che serve al contenuto, varia il ritmo e non usare lo stesso layout più di 3 volte di fila):\n"
    "- cover: copertina (solo la prima slide). Campi: title, subtitle.\n"
    "- section: divisore che apre una nuova parte. Campi: title, subtitle (es. 'Parte 2').\n"
    "- title_bullets: titolo + elenco puntato. Campi: title, subtitle (opzionale), points.\n"
    "- cards: 2-4 concetti affiancati. Campi: title, points nel formato 'Nome concetto: spiegazione breve'.\n"
    "- two_column: confronto o due aspetti. Campi: title, left_label, points, right_label, points_right.\n"
    "- timeline: sequenza, processo o cronologia di 2-5 passi. Campi: title, points (un passo ciascuno).\n"
    "- big_stat: un numero o dato chiave. Campi: stat_value (es. '70%'), stat_label, subtitle (contesto).\n"
    "- quote: citazione significativa. Campi: quote, attribution.\n"
    "- image_split: testo con un'immagine illustrativa generata automaticamente. Campi: title, points (max 4), "
    "image_prompt (descrizione concreta e visiva del soggetto, senza testo). Usalo 1-3 volte dove un'immagine aiuta davvero a capire.\n"
    "- summary: sintesi finale. Campi: title, points.\n"
)

SLIDE_SCHEMA = (
    '{"layout":"...","title":"...","subtitle":"","points":["..."],"points_right":[],"left_label":"",'
    '"right_label":"","stat_value":"","stat_label":"","quote":"","attribution":"","image_prompt":"","notes":"2-4 frasi per chi presenta"}'
)


def _theme_menu() -> str:
    return "\n".join(f"- {t['id']}: {t['name']} — {t['description']}" for t in THEMES)


def density_rules(density: Optional[str]) -> dict:
    return DENSITY_RULES.get(str(density or ""), DENSITY_RULES["bilanciata"])


def build_brief_text(brief: dict, school_grade_instruction: str = "") -> str:
    rules = density_rules(brief.get("density"))
    lines = [
        f"Argomento / richiesta: {brief.get('topic', '').strip()}",
        f"Pubblico: {brief.get('audience') or 'studenti'}",
        f"Obiettivo: {brief.get('goal') or 'spiegare l’argomento in modo chiaro'}",
        f"Tono: {brief.get('tone') or 'chiaro e coinvolgente'}",
        f"Numero di slide: circa {brief.get('slide_count') or 8} (cover inclusa)",
        f"Densità del testo: {brief.get('density') or 'bilanciata'} → al massimo {rules['max_points']} punti per slide, "
        f"ciascuno di al massimo {rules['max_words']} parole ({rules['label']}).",
    ]
    if school_grade_instruction:
        lines.append(school_grade_instruction)
    source = str(brief.get("source_text") or "").strip()
    if source:
        lines.append(f"\nMateriali di partenza forniti dall'utente (usali come fonte principale):\n<<<\n{source[:30000]}\n>>>")
    return "\n".join(lines)


def build_outline_prompt(brief: dict, language: str, school_grade_instruction: str = "") -> str:
    return (
        f"Lingua dei contenuti: {language}\n{build_brief_text(brief, school_grade_instruction)}\n\n{LAYOUT_GUIDE}\n"
        f"Template grafici esistenti (ne consiglierai 3, in ordine, adatti a pubblico e argomento):\n{_theme_menu()}\n\n"
        "Restituisci JSON con questa forma:\n"
        '{"title":"titolo della presentazione","subtitle":"sottotitolo","audience":"...","core_message":"il messaggio in una frase",'
        '"recommended_templates":[{"id":"<id template>","reason":"perché, in una frase"}],'
        f'"slides":[{SLIDE_SCHEMA}]}}\n'
        "Includi solo i campi che il layout scelto usa (gli altri vuoti)."
    )


def build_revise_prompt(brief: dict, outline: dict, instruction: str, language: str, school_grade_instruction: str = "") -> str:
    return (
        f"Lingua dei contenuti: {language}\n{build_brief_text(brief, school_grade_instruction)}\n\n{LAYOUT_GUIDE}\n"
        f"Scaletta attuale (già rivista dall'utente: conserva tutto ciò che la richiesta non tocca, compresi gli id):\n"
        f"{json.dumps(outline_for_prompt(outline), ensure_ascii=False)}\n\n"
        f"Richiesta di modifica dell'utente: {instruction}\n\n"
        "Restituisci la scaletta COMPLETA aggiornata, stessa forma JSON: "
        '{"title":"...","subtitle":"...","audience":"...","core_message":"...","recommended_templates":[...],'
        f'"slides":[{{"id":"id esistente o vuoto se nuova",{SLIDE_SCHEMA[1:]}]}}'
    )


def build_slide_prompt(brief: dict, outline: dict, slide_index: int, instruction: str, language: str,
                       school_grade_instruction: str = "") -> str:
    return (
        f"Lingua dei contenuti: {language}\n{build_brief_text(brief, school_grade_instruction)}\n\n{LAYOUT_GUIDE}\n"
        f"Scaletta completa (contesto):\n{json.dumps(outline_for_prompt(outline), ensure_ascii=False)}\n\n"
        f"Riscrivi SOLO la slide numero {slide_index + 1}. "
        f"Richiesta dell'utente: {instruction or 'migliorala: più chiara, più efficace, layout più adatto'}\n"
        f"Restituisci solo l'oggetto JSON della slide: {SLIDE_SCHEMA}"
    )


def outline_for_prompt(outline: dict) -> dict:
    """Compact outline for prompts: drop empty fields to save tokens."""
    slides = []
    for slide in outline.get("slides") or []:
        slides.append({k: v for k, v in slide.items() if v not in ("", [], None)})
    return {**{k: outline.get(k) for k in ("title", "subtitle", "audience", "core_message")}, "slides": slides}


def _limit_words(text: str, max_words: int) -> str:
    words = text.split()
    return text if len(words) <= max_words + 4 else " ".join(words[: max_words + 4]).rstrip(",;:") + "…"


def normalize_slide(raw: object, density: Optional[str] = None, *, keep_id: Optional[str] = None) -> dict:
    raw = raw if isinstance(raw, dict) else {}
    rules = density_rules(density)
    content = normalize_content(raw)
    # Density is a soft limit for the model and a hard one here; anything trimmed stays reachable
    # in the notes so no approved content is silently lost.
    overflow = content["points"][rules["max_points"] + 2:]
    content["points"] = [_limit_words(p, rules["max_words"]) for p in content["points"][: rules["max_points"] + 2]]
    content["points_right"] = [_limit_words(p, rules["max_words"]) for p in content["points_right"][: rules["max_points"] + 2]]
    notes = str(raw.get("notes") or raw.get("speaker_notes") or "").strip()[:2000]
    if overflow:
        notes = (notes + "\n" + "\n".join(f"• {p}" for p in overflow)).strip()
    layout = str(raw.get("layout") or "").strip()
    return {
        "id": str(keep_id or raw.get("id") or uuid.uuid4()),
        "layout": coerce_layout(layout, content),
        **content,
        "notes": notes,
    }


def normalize_outline(raw: object, density: Optional[str] = None, previous: Optional[dict] = None) -> dict:
    raw = raw if isinstance(raw, dict) else {}
    slides_raw = raw.get("slides") if isinstance(raw.get("slides"), list) else []
    known_ids = {s.get("id") for s in (previous or {}).get("slides") or [] if isinstance(s, dict)}
    slides = []
    for slide in slides_raw[:24]:
        if not isinstance(slide, dict):
            continue
        slide_id = slide.get("id") if slide.get("id") in known_ids else None
        slides.append(normalize_slide(slide, density, keep_id=slide_id))
    if not slides:
        raise ValueError("La scaletta generata non contiene slide")
    if slides[0]["layout"] != "cover" and not (previous and previous.get("slides")):
        slides.insert(0, normalize_slide({"layout": "cover", "title": raw.get("title"), "subtitle": raw.get("subtitle")}, density))

    recommended = []
    for item in raw.get("recommended_templates") or []:
        theme_id = item.get("id") if isinstance(item, dict) else item
        if theme_id in THEMES_BY_ID and theme_id not in [r["id"] for r in recommended]:
            recommended.append({"id": theme_id, "reason": str(item.get("reason") or "")[:200] if isinstance(item, dict) else ""})
    if not recommended and previous:
        recommended = previous.get("recommended_templates") or []

    return {
        "title": str(raw.get("title") or slides[0]["title"] or "Presentazione").strip()[:140],
        "subtitle": str(raw.get("subtitle") or "").strip()[:200],
        "audience": str(raw.get("audience") or "").strip()[:140],
        "core_message": str(raw.get("core_message") or "").strip()[:300],
        "recommended_templates": recommended[:3],
        "slides": slides,
    }


def render_outline(outline: dict, theme_id: Optional[str], options: Optional[dict], width: float, height: float,
                   slide_indexes: Optional[list[int]] = None) -> dict:
    theme = resolve_theme(theme_id, options)
    slides_src = outline.get("slides") if isinstance(outline.get("slides"), list) else []
    selected = [i for i in (slide_indexes or range(len(slides_src))) if 0 <= i < len(slides_src)]
    slides = [render_outline_slide(slides_src[i], i, width, height, theme) for i in selected]
    issues = check_and_fix_slides(slides, width, height, theme)
    return {
        "title": str(outline.get("title") or "Presentazione")[:140],
        "theme": {"id": theme["id"], "options": theme["options"]},
        "resolved_theme": theme,
        "slides": slides,
        "quality": issues,
    }


def layout_catalog() -> list[dict]:
    return [{"id": key, "label": spec["label"], "fields": spec["fields"]} for key, spec in LAYOUTS.items()]


def _recolor_block(block: dict, theme: dict) -> None:
    roles = block.get("themeRole") if isinstance(block.get("themeRole"), dict) else {}
    style = block.setdefault("style", {})
    colors = theme["colors"]
    for prop in ("fill", "stroke", "color"):
        role = roles.get(prop)
        if role in colors:
            style[prop] = colors[role]
    if roles.get("font") in theme["fonts"]:
        style["fontFamily"] = theme["fonts"][roles["font"]]


def _num(value, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def infer_theme_roles(slide: dict, width: float, height: float) -> None:
    """Give theme roles to blocks that have none (decks imported, drawn by hand or rewritten freely by
    the assistant), so a theme switch recolours them too instead of doing nothing. Heuristics on
    geometry and paint order: full-slide shape = background, big panels = surface, small shapes =
    accent; text is heading/body and readable on whatever role is painted beneath it."""
    blocks = [b for b in slide.get("blocks") or [] if isinstance(b, dict)]
    blocks.sort(key=lambda b: _num(b.get("zIndex")))
    area = max(1.0, width * height)
    for index, block in enumerate(blocks):
        if isinstance(block.get("themeRole"), dict) and block["themeRole"]:
            continue
        kind = block.get("type")
        w, h = _num(block.get("width")), _num(block.get("height"))
        if kind in {"rectangle", "ellipse"}:
            share = (w * h) / area
            if w >= width * 0.95 and h >= height * 0.95:
                block["themeRole"] = {"fill": "background"}
                block["locked"] = True
            elif share >= 0.06:
                block["themeRole"] = {"fill": "surface", "stroke": "border"}
            elif min(w, h) <= 12 or share < 0.01:
                block["themeRole"] = {"fill": "accent", "stroke": "accent"}
            else:
                block["themeRole"] = {"fill": "primary", "stroke": "primary"}
        elif kind == "line":
            block["themeRole"] = {"stroke": "border"}
        elif kind == "text":
            style = block.get("style") or {}
            size = _num(style.get("fontSize"), 18)
            bold = str(style.get("fontWeight") or "").lower() in {"bold", "600", "700", "800", "900"}
            heading = size >= 26 or (bold and size >= 20)
            cx, cy = _num(block.get("x")) + w / 2, _num(block.get("y")) + h / 2
            under = "background"
            for below in blocks[:index]:
                role = (below.get("themeRole") or {}).get("fill")
                bx, by = _num(below.get("x")), _num(below.get("y"))
                if role and bx <= cx <= bx + _num(below.get("width")) and by <= cy <= by + _num(below.get("height")):
                    under = role
            color = {"primary": "on_primary", "accent": "on_accent"}.get(under, "text")
            if color == "text" and not heading and size <= 14:
                color = "muted"
            block["themeRole"] = {"color": color, "font": "heading" if heading else "body"}


def apply_theme(slides: list[dict], theme: dict, width: float, height: float) -> tuple[list[dict], list[dict]]:
    """Switch a deck to another theme without asking the LLM anything.

    Slides still matching their Studio layout are re-rendered from their content (exact result);
    slides the user customised by hand keep their geometry and edits and are only recoloured
    through each block's ``themeRole``. Then the quality pass catches anything left unreadable
    (e.g. a colour the user typed by hand that no longer reads on the new background).
    """
    result = []
    for index, slide in enumerate(slides):
        if not isinstance(slide, dict):
            continue
        if slide.get("layout") in LAYOUTS and isinstance(slide.get("content"), dict) and not slide.get("customized"):
            rendered = render_outline_slide({**slide["content"], "layout": slide["layout"], "id": slide.get("id"),
                                             "notes": slide.get("speakerNotes")}, index, width, height, theme)
            rendered["title"] = slide.get("title") or rendered["title"]
            # Keep pictures already generated/chosen for the slide's image slots.
            old_images = [b for b in slide.get("blocks") or [] if isinstance(b, dict) and b.get("type") == "image"]
            new_images = [b for b in rendered["blocks"] if b.get("type") == "image"]
            for new, old in zip(new_images, old_images):
                if "placehold.co" not in str(old.get("content") or ""):
                    new["content"] = old["content"]
            result.append(rendered)
            continue
        copy = json.loads(json.dumps(slide))
        infer_theme_roles(copy, width, height)
        for block in copy.get("blocks") or []:
            if isinstance(block, dict):
                _recolor_block(block, theme)
        result.append(copy)
    issues = check_and_fix_slides(result, width, height, theme)
    return result, issues
