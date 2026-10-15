"""Local anonymization of text extracted from user attachments.

Runs entirely in-process (no external API): personal data never leaves the server
before being masked. Layers:
  1. regex  — email, phone, codice fiscale, IBAN, card, street address
  2. rules  — "Alunno: Mario Rossi", "Prof.ssa Verdi", name-label patterns
  3. NER    — spaCy `it_core_news_md` PER entities (if the model is installed)
  4. gazetteer of common Italian first names (+ following surname)

Person names become ``[NAME]``; other identifiers get a typed tag.
Known limitation: public/historical figures (Manzoni, Dante…) are also masked,
because NER cannot tell a private individual from a public one.
"""
from __future__ import annotations

import logging
import re
import threading
from dataclasses import dataclass, field

from app.services.moderation_service import _PII_PATTERNS

logger = logging.getLogger(__name__)

NAME_TAG = "[NAME]"
_CHUNK = 90_000
_MAX_CHARS = 400_000  # beyond this the tail is left untouched but regex-masked only

_TAGS = {
    "codice_fiscale": "[CODICE FISCALE]",
    "email": "[EMAIL]",
    "iban": "[IBAN]",
    "carta_credito": "[CARTA]",
    "telefono": "[TELEFONO]",
    "indirizzo": "[INDIRIZZO]",
}
# order matters: more specific patterns first
_REGEX_ORDER = ["email", "iban", "codice_fiscale", "carta_credito", "telefono"]

_ADDRESS_RE = re.compile(
    r"\b(?:via|viale|v\.le|piazza|p\.zza|piazzale|corso|c\.so|largo|vicolo|strada|località|loc\.)\s+"
    r"(?:[A-ZÀ-Ý][\w'’.\-]*\s+){0,4}[A-ZÀ-Ý][\w'’.\-]*(?:,?\s*(?:n\.?|n°|civ\.?)?\s*\d{1,4}[A-Za-z]?(?:/\w+)?)?",
    re.IGNORECASE,
)

_CAP = r"[A-ZÀ-ÝÈÉ][a-zà-ÿ'’\-]+"
_PARTICLE = r"(?:de|di|da|del|della|dei|degli|dal|dalla|la|lo|le|van|von|d['’])"
_FULLNAME = rf"{_CAP}(?:\s+(?:{_PARTICLE}\s+)?{_CAP}){{0,3}}"

_LABEL_RE = re.compile(
    rf"\b(?:nome|cognome|alunn[oa]|student[ei]|studentessa|genitore|padre|madre|tutore|docente|insegnante|"
    rf"firma|firmato\s+da|presenti|assenti|classe\s+di|candidat[oa]|autore|redatto\s+da|preparato\s+da)"
    rf"\s*(?:[:\-–]|\s)\s*({_FULLNAME}(?:\s*,\s*{_FULLNAME}){{0,12}})"
)
_TITLE_RE = re.compile(
    rf"\b(?:Sig\.?ra|Sig\.?na|Sigg?\.?|Signor[ea]?|Prof\.?ssa|Prof\.?|Professor[ea]?|Dott\.?ssa|Dott\.?|"
    rf"Dr\.?|Ing\.?|Avv\.?|Arch\.?|Maestr[ao]|Preside|Don|Suor)\s+({_FULLNAME})"
)

_FIRST_NAMES = set("""
Alessandro Alessio Alberto Andrea Angelo Antonio Armando Arturo Biagio Bruno Carlo Claudio Cristian Cristiano
Damiano Daniele Dario Davide Diego Domenico Edoardo Elia Emanuele Enrico Enzo Fabio Fabrizio Federico Filippo
Francesco Gabriele Gaetano Giacomo Giampaolo Gianluca Gianni Gino Giorgio Giovanni Giulio Giuseppe Guido Ivan
Jacopo Lorenzo Luca Luciano Luigi Manuel Marco Mario Martino Massimo Matteo Mattia Maurizio Michele Nicola
Nicolò Omar Paolo Pasquale Patrick Pier Piero Pietro Raffaele Renato Riccardo Roberto Rocco Rodolfo Ruggero
Salvatore Samuele Sandro Santo Sergio Simone Stefano Tommaso Umberto Valerio Valentino Vincenzo Vittorio
Adriana Alessandra Alice Anna Annalisa Antonella Arianna Barbara Beatrice Benedetta Camilla Carla Carlotta
Carmela Caterina Cecilia Chiara Claudia Cristina Daniela Debora Diana Elena Eleonora Elisa Elisabetta Emanuela
Emma Erica Eva Federica Francesca Franca Gabriella Giada Giorgia Giovanna Giulia Giuliana Giuseppina Greta
Ilaria Irene Isabella Laura Letizia Lia Licia Lidia Lisa Livia Lorena Lucia Luciana Ludovica Luisa Manuela
Margherita Maria Mariangela Marina Marta Martina Matilde Melissa Michela Miriam Monica Nadia Natalia Nicoletta
Noemi Paola Patrizia Rachele Raffaella Rebecca Roberta Rosanna Rosella Sabrina Sara Serena Silvia Simona
Sofia Sonia Stefania Susanna Tiziana Valentina Valeria Vanessa Veronica Vittoria Viviana Zoe
Ahmed Ali Amir Aya Fatima Hamza Ibrahim Karim Layla Leila Mohamed Mohammed Omar Sami Yasmine Yusuf
Chen Li Wei Mei Jin Lin Anh Ravi Priya Raj Arjun Aisha Amira
""".split())

_nlp = None
_nlp_lock = threading.Lock()
_nlp_failed = False


def _load_nlp():
    global _nlp, _nlp_failed
    if _nlp is not None or _nlp_failed:
        return _nlp
    with _nlp_lock:
        if _nlp is None and not _nlp_failed:
            try:
                import spacy
                _nlp = spacy.load("it_core_news_md", disable=["lemmatizer", "parser", "attribute_ruler"])
                _nlp.max_length = _CHUNK + 10_000
            except Exception as exc:  # model missing: degrade to rules + gazetteer
                _nlp_failed = True
                logger.warning("spaCy it_core_news_md unavailable, name NER disabled: %s", exc)
    return _nlp


@dataclass
class AnonymizationResult:
    text: str
    counts: dict[str, int] = field(default_factory=dict)
    ner_available: bool = True

    @property
    def total(self) -> int:
        return sum(self.counts.values())

    @property
    def changed(self) -> bool:
        return self.total > 0


def _bump(counts: dict[str, int], key: str, n: int = 1) -> None:
    if n:
        counts[key] = counts.get(key, 0) + n


def _mask_regex(text: str, counts: dict[str, int]) -> str:
    for key in _REGEX_ORDER:
        pattern = _PII_PATTERNS[key]
        text, n = pattern.subn(_TAGS[key], text)
        _bump(counts, key, n)
    text, n = _ADDRESS_RE.subn(_TAGS["indirizzo"], text)
    _bump(counts, "indirizzo", n)
    return text


def _mask_name_rules(text: str, counts: dict[str, int]) -> str:
    def _sub_group(match: re.Match) -> str:
        names = match.group(1)
        parts = [p for p in re.split(r"\s*,\s*", names) if p]
        _bump(counts, "nome", len(parts))
        return match.group(0)[: match.start(1) - match.start(0)] + ", ".join([NAME_TAG] * len(parts))

    text = _LABEL_RE.sub(_sub_group, text)
    text = _TITLE_RE.sub(_sub_group, text)
    return text


_TRAIL_TOKEN_RE = re.compile(rf"^(?:{_CAP}|{_PARTICLE})$")


def _trim_name(span_text: str) -> str:
    """Keep only the leading run of capitalised words/particles (drops '… della 3B')."""
    kept: list[str] = []
    for tok in span_text.split():
        if _TRAIL_TOKEN_RE.match(tok):
            kept.append(tok)
        else:
            break
    while kept and re.fullmatch(_PARTICLE, kept[-1]):
        kept.pop()
    return " ".join(kept)


def _mask_ner(text: str, counts: dict[str, int]) -> str:
    nlp = _load_nlp()
    if nlp is None or not text.strip():
        return text
    out: list[str] = []
    for start in range(0, len(text), _CHUNK):
        chunk = text[start:start + _CHUNK]
        doc = nlp(chunk)
        pieces: list[tuple[int, int]] = []
        for ent in doc.ents:
            if ent.label_ != "PER":
                continue
            trimmed = _trim_name(ent.text)
            if not trimmed or NAME_TAG.strip("[]") in trimmed.upper() or len(trimmed) < 2:
                continue
            pieces.append((ent.start_char, ent.start_char + len(trimmed)))
        for s, e in reversed(pieces):
            chunk = chunk[:s] + NAME_TAG + chunk[e:]
        _bump(counts, "nome", len(pieces))
        out.append(chunk)
    return "".join(out)


_WORD_RE = re.compile(rf"\b({_CAP})(?:\s+(?:{_PARTICLE}\s+)?({_CAP}))?")


def _mask_first_names(text: str, counts: dict[str, int]) -> str:
    def _sub(match: re.Match) -> str:
        first, second = match.group(1), match.group(2)
        if first not in _FIRST_NAMES:
            return match.group(0)
        _bump(counts, "nome")
        if second and second not in _FIRST_NAMES and second.upper() != "NAME":
            return NAME_TAG  # "Marco Bianchi" → one name
        if second and second in _FIRST_NAMES:
            _bump(counts, "nome")
            return f"{NAME_TAG} {NAME_TAG}"
        return NAME_TAG + (match.group(0)[len(first):] if second is None else "")

    return _WORD_RE.sub(_sub, text)


def anonymize_text(text: str) -> AnonymizationResult:
    """Mask personal data in `text`. CPU-bound: call via `anonymize_text_async` from endpoints."""
    if not text:
        return AnonymizationResult(text=text or "")
    counts: dict[str, int] = {}
    head, tail = text[:_MAX_CHARS], text[_MAX_CHARS:]
    head = _mask_regex(head, counts)
    head = _mask_name_rules(head, counts)
    head = _mask_ner(head, counts)
    head = _mask_first_names(head, counts)
    if tail:
        tail = _mask_regex(tail, counts)
    # collapse "[NAME] [NAME]" produced by NER + gazetteer overlap
    merged = re.sub(r"(?:\[NAME\][ ,]*){2,}", lambda m: m.group(0) if "," in m.group(0) else NAME_TAG + " ", head + tail)
    return AnonymizationResult(text=merged, counts=counts, ner_available=_load_nlp() is not None)


async def anonymize_text_async(text: str) -> AnonymizationResult:
    import asyncio
    return await asyncio.to_thread(anonymize_text, text)


COUNT_LABELS = {
    "nome": "nomi di persona",
    "email": "indirizzi e-mail",
    "telefono": "numeri di telefono",
    "codice_fiscale": "codici fiscali",
    "iban": "IBAN",
    "carta_credito": "numeri di carta",
    "indirizzo": "indirizzi",
}
