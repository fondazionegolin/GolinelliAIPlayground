"""Vibe Lab art directions: the visual styles offered during the project interview.

One source of truth. The interview endpoint returns these as `style_options` (the editor renders each as a small
visual preview from the tokens) and the chosen direction travels as a concrete, readable answer — fonts, hex
palette, shape, layout character — so the spec and every generation call apply it literally instead of guessing.
"""
from __future__ import annotations

STYLE_DIRECTIONS: list[dict] = [
    {
        "id": "editoriale", "name": "Editoriale", "tagline": "Come una bella rivista: carta, titoli serif, colonne.",
        "palette": {"bg": "#f6f1e7", "surface": "#fffdf8", "ink": "#1c1a17", "muted": "#6b6459", "primary": "#b4421f", "accent": "#1f4d3a"},
        "font_heading": "Fraunces", "font_body": "Source Sans 3", "radius": 2,
        "character": "titoli serif molto grandi con contrasto di peso, filetti sottili al posto delle ombre, impaginazione a colonne asimmetriche, numeri e iniziali in evidenza, angoli quasi netti",
    },
    {
        "id": "swiss", "name": "Pulito e preciso", "tagline": "Griglia svizzera, molto bianco, un colore forte.",
        "palette": {"bg": "#ffffff", "surface": "#f4f5f7", "ink": "#0b0d12", "muted": "#5a6270", "primary": "#1d4ed8", "accent": "#0b0d12"},
        "font_heading": "Space Grotesk", "font_body": "Inter", "radius": 6,
        "character": "griglia rigorosa, molto spazio bianco, numeri grandi come elemento grafico, un solo colore d'accento, linee sottili, niente ombre pesanti",
    },
    {
        "id": "scuro-pro", "name": "Scuro da professionisti", "tagline": "Pannelli densi, testo mono, accento acceso.",
        "palette": {"bg": "#0e1116", "surface": "#171c24", "ink": "#e8edf5", "muted": "#8b96a8", "primary": "#c6f432", "accent": "#38bdf8"},
        "font_heading": "Space Grotesk", "font_body": "JetBrains Mono", "radius": 8,
        "character": "interfaccia da strumento professionale: pannelli scuri con bordo sottile, dati in carattere mono, indicatori e barre luminose, accento lime/ciano, densita' ordinata",
    },
    {
        "id": "caldo", "name": "Caldo e artigianale", "tagline": "Terracotta, crema, forme morbide e umane.",
        "palette": {"bg": "#fbf4ea", "surface": "#fffaf2", "ink": "#2b211a", "muted": "#7a6a5c", "primary": "#c0583a", "accent": "#5f7a4a"},
        "font_heading": "DM Serif Display", "font_body": "Nunito Sans", "radius": 14,
        "character": "toni terra e crema, forme morbide, titoli serif accoglienti, illustrazioni a forme piene, tono amichevole e personale",
    },
    {
        "id": "pop", "name": "Vivace e giocoso", "tagline": "Colori pieni, bordi spessi, ombre a sticker.",
        "palette": {"bg": "#fff7d6", "surface": "#ffffff", "ink": "#171717", "muted": "#555555", "primary": "#ff4d6d", "accent": "#2563eb"},
        "font_heading": "Rubik", "font_body": "Rubik", "radius": 16,
        "character": "colori saturi e piatti, bordi neri spessi, ombre dure offset come adesivi, titoli pesanti, forme grandi e arrotondate, animazioni vivaci e brevi",
    },
    {
        "id": "natura", "name": "Naturale e sereno", "tagline": "Verdi, sabbia, forme organiche e respiro.",
        "palette": {"bg": "#f3f1e8", "surface": "#fbfaf4", "ink": "#1f2a1f", "muted": "#66705f", "primary": "#2f6b4f", "accent": "#d98f3a"},
        "font_heading": "Lora", "font_body": "Nunito", "radius": 20,
        "character": "verdi profondi e sabbia, angoli molto morbidi, forme organiche, molta aria, immagini grandi con maschere arrotondate, ritmo lento e rilassato",
    },
    {
        "id": "brutalista", "name": "Brutalista", "tagline": "Grezzo, contrasti duri, tipografia enorme.",
        "palette": {"bg": "#ececec", "surface": "#ffffff", "ink": "#000000", "muted": "#444444", "primary": "#ff3b00", "accent": "#0000ee"},
        "font_heading": "Archivo Black", "font_body": "IBM Plex Mono", "radius": 0,
        "character": "bordi neri di 2-3px, nessun arrotondamento, ombre dure, titoli enormi in maiuscolo, colori piatti e contrasto estremo, layout volutamente asimmetrico",
    },
    {
        "id": "elegante", "name": "Elegante e sobrio", "tagline": "Blu notte, oro tenue, molto spazio.",
        "palette": {"bg": "#0f1a2b", "surface": "#16243a", "ink": "#f1ede4", "muted": "#a9b2c3", "primary": "#c9a45c", "accent": "#e8d9b0"},
        "font_heading": "Cormorant Garamond", "font_body": "Jost", "radius": 2,
        "character": "fondo blu notte, dettagli oro tenue, titoli serif eleganti con spaziatura ampia, molto spazio vuoto, immagini a tutto campo, movimenti lenti e raffinati",
    },
]


def style_options() -> list[dict]:
    """Options sent to the editor: tokens for the visual preview plus the answer text to send back when picked."""
    return [{**{k: v for k, v in style.items() if k != "character"}, "answer": answer_text(style)} for style in STYLE_DIRECTIONS]


def answer_text(style: dict) -> str:
    palette = style["palette"]
    return (
        f"Stile «{style['name']}»: {style['character']}. Font titoli {style['font_heading']}, testo {style['font_body']} (Google Fonts). "
        f"Palette: sfondo {palette['bg']}, superfici {palette['surface']}, testo {palette['ink']}, testo secondario {palette['muted']}, "
        f"primario {palette['primary']}, accento {palette['accent']}. Raggio angoli {style['radius']}px."
    )
