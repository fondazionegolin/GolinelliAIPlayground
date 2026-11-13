"""Smart encoding of non-numeric columns for the «Codifica in numeri» node.

For every column the encoder looks at the actual values and picks the right treatment:

* numbers written as text («1.234,5», «12 €», «45%»)               → parsed as numbers
* ranges and open intervals («18-25», «65+», «<10»)                  → midpoint / bound (keeps the real min and max)
* yes/no style pairs («sì/no», «true/false»)                          → 0 / 1
* values that belong to a known ordered scale («basso<medio<alto»,
  months, weekdays, school levels, grades, S/M/L, Likert…)           → ordinal 0..n-1 (or 0..1), in the right order
* dates                                                               → days since the earliest date
* two categories                                                      → 0 / 1
* few unlabeled categories                                            → one-hot (one 0/1 column per category)
* many categories                                                     → target mean (if a target is given) or frequency
* identifiers (almost every value different)                          → left as they are, with a warning

Every choice is reported so the student can read why a column was encoded the way it was.
"""
from __future__ import annotations

import re
import unicodedata
import warnings
from typing import Any

import numpy as np
import pandas as pd


def _fold(value: Any) -> str:
    text = "".join(ch for ch in unicodedata.normalize("NFKD", str(value)) if not unicodedata.combining(ch))
    return re.sub(r"\s+", " ", text.lower().strip())


def _levels(*levels: str) -> list[set[str]]:
    return [{_fold(word) for word in level.split("|")} for level in levels]


# Ordered scales, lowest first. A column uses a scale when ALL its values appear in it.
SCALES: list[tuple[str, list[set[str]]]] = [
    ("intensità", _levels("nessuno|nessuna|nulla|none", "molto basso|molto bassa|very low|bassissimo|bassissima|minimo|minima",
                           "basso|bassa|low|poco|lieve", "medio|media|medium|moderato|moderata|mid|normale",
                           "alto|alta|high|elevato|elevata", "molto alto|molto alta|very high|altissimo|altissima|massimo|massima")),
    ("giudizio", _levels("pessimo|pessima|terrible|awful", "scarso|scarsa|scadente|poor|bad|negativo|negativa",
                          "insufficiente|insufficient", "sufficiente|accettabile|fair|ok|sufficient", "discreto|discreta",
                          "buono|buona|good|positivo|positiva", "distinto|distinta", "ottimo|ottima|eccellente|excellent|great")),
    ("frequenza", _levels("mai|never", "raramente|rarely|di rado", "a volte|qualche volta|talvolta|sometimes|occasionalmente",
                           "spesso|often|frequentemente", "sempre|always|quotidianamente")),
    ("accordo (Likert)", _levels("fortemente in disaccordo|strongly disagree|per niente d'accordo", "in disaccordo|disagree|non d'accordo",
                                  "neutrale|neutral|indifferente|ne' d'accordo ne' in disaccordo", "d'accordo|agree",
                                  "fortemente d'accordo|strongly agree|completamente d'accordo")),
    ("quantità", _levels("per niente|niente|zero", "poco|poca|pochi|poche", "abbastanza", "molto|molta|molti|molte", "moltissimo|moltissima|estremamente")),
    ("taglia", _levels("xxs", "xs|extra small", "s|small|piccolo|piccola", "m|medium", "l|large|grande", "xl|extra large", "xxl", "xxxl")),
    ("dimensione", _levels("minuscolo|minuscola|tiny", "piccolo|piccola|small", "medio|media|medium", "grande|large|big", "enorme|huge|gigante")),
    ("voto a lettere", _levels("f", "e", "d", "c", "b", "a")),
    ("livello di studio", _levels("infanzia|nessun titolo", "primaria|elementare|elementari|scuola primaria", "secondaria di primo grado|media|medie|scuola media|licenza media",
                                   "secondaria di secondo grado|superiore|superiori|diploma|liceo|scuola superiore", "laurea|laurea triennale|universita|bachelor",
                                   "magistrale|laurea magistrale|master|specialistica", "dottorato|phd")),
    ("livello di competenza", _levels("principiante|beginner|base", "elementare|elementary", "intermedio|intermedia|intermediate", "avanzato|avanzata|advanced", "esperto|esperta|expert|madrelingua")),
    ("difficoltà", _levels("facile|easy|semplice", "medio|media|medium|normale", "difficile|hard|complesso|complessa", "molto difficile|very hard|estremo|estrema")),
    ("mese", _levels("gennaio|january|jan|gen", "febbraio|february|feb", "marzo|march|mar", "aprile|april|apr", "maggio|may|mag", "giugno|june|jun|giu",
                      "luglio|july|jul|lug", "agosto|august|aug|ago", "settembre|september|sep|sept|set", "ottobre|october|oct|ott", "novembre|november|nov", "dicembre|december|dec|dic")),
    ("giorno della settimana", _levels("lunedi|monday|mon|lun", "martedi|tuesday|tue|mar", "mercoledi|wednesday|wed|mer", "giovedi|thursday|thu|gio",
                                        "venerdi|friday|fri|ven", "sabato|saturday|sat|sab", "domenica|sunday|sun|dom")),
]

_POSITIVE = {_fold(w) for w in "si|yes|y|true|vero|t|1|presente|positivo|maschio|on|s".split("|")}
_NEGATIVE = {_fold(w) for w in "no|n|false|falso|f|0|assente|negativo|femmina|off".split("|")}
_STRATEGIES = {"auto", "ordinale", "one_hot", "binaria", "frequenza", "target", "etichetta", "numero"}
_RANGE = re.compile(r"^\s*(?P<a>-?\d+(?:[.,]\d+)?)\s*(?:-|–|—|a|fino a|to)\s*(?P<b>-?\d+(?:[.,]\d+)?)\s*[%a-zA-Z€$]*\s*$")
_OPEN_UP = re.compile(r"^\s*(?:>=?|oltre|over|piu di|più di)?\s*(?P<a>-?\d+(?:[.,]\d+)?)\s*(?:\+|e oltre|o piu|o più)?\s*$")
_OPEN_LOW = re.compile(r"^\s*(?:<=?|meno di|under|sotto)\s*(?P<a>-?\d+(?:[.,]\d+)?)\s*$")


def _num(text: str) -> float:
    return float(text.replace(",", "."))


def parse_numeric_text(series: pd.Series, decimal: str = "auto") -> pd.Series:
    """Numbers written as text: «1.234,5», «12 €», «45%», «3,5»."""
    cleaned = series.astype(str).str.replace(r"[^\d,\.\-]", "", regex=True)
    if decimal == "," or (decimal == "auto" and cleaned.str.contains(",").any()):
        cleaned = cleaned.str.replace(".", "", regex=False).str.replace(",", ".", regex=False)
    return pd.to_numeric(cleaned.replace("", np.nan), errors="coerce")


def _interval_value(text: str) -> float | None:
    folded = _fold(text)
    match = _RANGE.match(folded)
    if match:
        return (_num(match["a"]) + _num(match["b"])) / 2
    match = _OPEN_LOW.match(folded)
    if match:
        return _num(match["a"])
    if re.search(r"[+<>]|oltre|over|piu di|e oltre|o piu", folded):
        match = _OPEN_UP.match(folded)
        if match:
            return _num(match["a"])
    return None


def _fmt(value: float) -> str:
    return f"{value:.4g}"


def _ordinal(values: pd.Series, order: list[set[str]] | list[str], scale_name: str, scale: str) -> tuple[pd.Series, dict[str, Any]]:
    keys = values.map(lambda v: _fold(v) if pd.notna(v) else None)
    ranks: dict[str, int] = {}
    present = sorted({k for k in keys.dropna()}, key=lambda k: next((i for i, level in enumerate(order) if (k in level if isinstance(level, set) else k == _fold(level))), 0))
    levels_used: list[int] = []
    for key in present:
        for index, level in enumerate(order):
            if (key in level) if isinstance(level, set) else key == _fold(level):
                ranks[key] = index
                levels_used.append(index)
                break
    # True positions on the scale, shifted so the lowest level present is 0 (marzo/dicembre keep their real distance).
    base = min(ranks.values()) if ranks else 0
    shift = {rank: rank - base for rank in set(ranks.values())}
    mapped = keys.map(lambda k: shift[ranks[k]] if k in ranks else np.nan).astype(float)
    top = max(max(shift.values(), default=0), 1)
    if scale == "0-1":
        mapped = mapped / top
    by_label: dict[str, Any] = {}
    for original in values.dropna().unique():
        key = _fold(original)
        if key in ranks:
            by_label[str(original)] = round(float(shift[ranks[key]] / top if scale == "0-1" else shift[ranks[key]]), 4)
    low, high = (0.0, 1.0) if scale == "0-1" else (0.0, float(top if shift else 0))
    return mapped, {"strategia": "ordinale", "scala": scale_name, "mappatura": by_label, "min": low, "max": high}


def _match_scale(values: pd.Series) -> tuple[str, list[set[str]]] | None:
    keys = {_fold(v) for v in values.dropna().unique()}
    if len(keys) < 2:
        return None
    for name, levels in SCALES:
        union = set().union(*levels)
        if keys <= union:
            return name, levels
    return None


def _as_boolean(values: pd.Series) -> tuple[pd.Series, dict[str, Any]] | None:
    keys = {_fold(v) for v in values.dropna().unique()}
    if len(keys) != 2:
        return None
    positive, negative = keys & _POSITIVE, keys & _NEGATIVE
    if len(positive) == 1 and len(negative) == 1 and keys == positive | negative:
        yes = next(iter(positive))
        out = values.map(lambda v: (1.0 if _fold(v) == yes else 0.0) if pd.notna(v) else np.nan)
        labels = {str(v): float(out[values == v].iloc[0]) for v in values.dropna().unique()}
        return out, {"strategia": "binaria (sì/no)", "mappatura": labels, "min": 0.0, "max": 1.0}
    return None


def _clean_name(text: Any) -> str:
    return re.sub(r"[^0-9a-z]+", "_", _fold(text)).strip("_") or "vuoto"


def _one_hot(df: pd.DataFrame, name: str, drop_first: bool) -> tuple[pd.DataFrame, dict[str, Any]]:
    series = df[name]
    categories = sorted(series.dropna().unique(), key=lambda v: (-int((series == v).sum()), str(v)))
    if drop_first and len(categories) > 1:
        categories = categories[1:]
    created: dict[str, str] = {}
    out = df.copy()
    position = list(out.columns).index(name)
    for category in categories:
        new = f"{name}_{_clean_name(category)}"
        base, n = new, 2
        while new in out.columns or new in created:
            new, n = f"{base}_{n}", n + 1
        out.insert(position, new, (series == category).astype(float).where(series.notna(), np.nan))
        created[new] = str(category)
        position += 1
    out = out.drop(columns=[name])
    return out, {"strategia": "one-hot", "nuove_colonne": created, "min": 0.0, "max": 1.0}


def _parse_overrides(raw: Any, columns: list[str]) -> dict[str, tuple[str, list[str]]]:
    """«colonna:strategia[:a|b|c]» one per line. For ``ordinale`` the third part is the order, lowest first."""
    from app.services.dataflow_nodes import resolve_column  # local import: dataflow_nodes imports this module lazily

    result: dict[str, tuple[str, list[str]]] = {}
    for line in str(raw or "").splitlines():
        if not line.strip():
            continue
        parts = [part.strip() for part in line.split(":", 2)]
        if len(parts) < 2 or not parts[0] or not parts[1]:
            raise ValueError(f"Regola non valida «{line.strip()}»: usa colonna:strategia (es. livello:ordinale:basso|medio|alto)")
        column, strategy = resolve_column(columns, parts[0]), _fold(parts[1]).replace("-", "_").replace(" ", "_")
        if column not in columns:
            raise ValueError(f"La colonna «{parts[0]}» non esiste. Colonne: {', '.join(columns)}")
        if strategy not in _STRATEGIES:
            raise ValueError(f"Strategia «{parts[1]}» sconosciuta. Usa: {', '.join(sorted(_STRATEGIES))}")
        result[column] = (strategy, [item.strip() for item in parts[2].split("|") if item.strip()] if len(parts) == 3 else [])
    return result


def encode_table(df: pd.DataFrame, config: dict[str, Any], requested: list[str]) -> tuple[pd.DataFrame, dict[str, Any]]:
    from app.services.dataflow_nodes import resolve_column

    scale = "0-1" if str(config.get("scale") or "indici") == "0-1" else "indici"
    max_onehot = max(2, int(config.get("max_onehot") or 10))
    drop_first = bool(config.get("drop_first", False))
    decimal = str(config.get("decimal_separator") or "auto")
    default_strategy = str(config.get("strategy") or "auto")
    if default_strategy not in _STRATEGIES:
        default_strategy = "auto"
    target_name = resolve_column(df.columns, str(config.get("target_column") or "").strip()) if config.get("target_column") else ""
    overrides = _parse_overrides(config.get("overrides"), [str(c) for c in df.columns])

    names = requested or [str(c) for c in df.columns if not pd.api.types.is_numeric_dtype(df[c]) or str(c) in overrides]
    target_series: pd.Series | None = None
    if target_name and target_name in df.columns:
        target_series = pd.to_numeric(df[target_name], errors="coerce")
        if target_series.notna().sum() == 0:  # categorical target: use its codes for target encoding
            target_series = pd.Series(pd.factorize(df[target_name])[0], index=df.index).where(df[target_name].notna())
    report: dict[str, Any] = {}
    warnings_: list[str] = []
    out = df.copy()

    for name in names:
        if name not in out.columns or name == target_name:
            continue
        strategy, order = overrides.get(name, (default_strategy, []))
        series = out[name]
        non_null = series.dropna()
        if non_null.empty:
            report[name] = {"strategia": "invariata", "nota": "colonna vuota"}
            continue
        if pd.api.types.is_bool_dtype(series):
            out[name] = series.astype(float)
            report[name] = {"strategia": "binaria (booleano)", "mappatura": {"False": 0.0, "True": 1.0}, "min": 0.0, "max": 1.0}
            continue
        if pd.api.types.is_numeric_dtype(series) and strategy in {"auto", "numero"}:
            continue
        unique = non_null.astype(str).nunique()
        try:
            if strategy == "ordinale" and order:
                folded = {_fold(o) for o in order}
                unknown = sorted({str(v) for v in non_null.unique() if _fold(v) not in folded})
                if unknown:
                    raise ValueError(f"L'ordine della colonna «{name}» non contiene: {', '.join(unknown)}")
                out[name], info = _ordinal(series, order, "ordine indicato", scale)
            elif strategy == "ordinale":
                found = _match_scale(series)
                if found:
                    out[name], info = _ordinal(series, found[1], found[0], scale)
                else:  # unknown scale: numeric text first, else alphabetical order (declared as such)
                    numeric = parse_numeric_text(series, decimal)
                    if numeric.notna().sum() >= 0.9 * len(non_null):
                        out[name], info = numeric, {"strategia": "numero", "min": float(numeric.min()), "max": float(numeric.max())}
                    else:
                        order_alpha = sorted({str(v) for v in non_null.unique()}, key=_fold)
                        out[name], info = _ordinal(series, order_alpha, "ordine alfabetico (scala sconosciuta: indica l'ordine in «Regole per colonna»)", scale)
                        warnings_.append(f"«{name}»: non riconosco una scala, uso l'ordine alfabetico")
            elif strategy == "numero":
                numeric = parse_numeric_text(series, decimal)
                out[name], info = numeric, {"strategia": "numero", "min": float(numeric.min()), "max": float(numeric.max())}
            elif strategy == "etichetta":
                codes, uniques = pd.factorize(series.map(lambda v: str(v) if pd.notna(v) else v), sort=True)
                out[name] = pd.Series(codes, index=series.index).replace(-1, np.nan).astype(float)
                info = {"strategia": "etichetta (alfabetica)", "mappatura": {str(u): i for i, u in enumerate(uniques)}, "min": 0.0, "max": float(len(uniques) - 1)}
            elif strategy == "binaria":
                keys = sorted({str(v) for v in non_null.unique()}, key=_fold)
                if len(keys) != 2:
                    raise ValueError(f"La codifica binaria richiede 2 valori, «{name}» ne ha {len(keys)}")
                out[name] = series.map(lambda v: float(str(v) == keys[1]) if pd.notna(v) else np.nan)
                info = {"strategia": "binaria", "mappatura": {keys[0]: 0.0, keys[1]: 1.0}, "min": 0.0, "max": 1.0}
            elif strategy == "one_hot":
                out, info = _one_hot(out, name, drop_first)
            elif strategy == "frequenza":
                freq = series.map(series.value_counts(normalize=True))
                out[name], info = freq.astype(float), {"strategia": "frequenza relativa", "min": float(freq.min()), "max": float(freq.max())}
            elif strategy == "target":
                if target_series is None:
                    raise ValueError("La codifica «target» richiede la colonna target")
                means = target_series.groupby(series).mean()
                out[name] = series.map(means).astype(float)
                info = {"strategia": "media del target", "mappatura": {str(k): round(float(v), 4) for k, v in means.items()}}
            else:  # auto
                numeric = parse_numeric_text(series, decimal)
                intervals = series.map(lambda v: _interval_value(str(v)) if pd.notna(v) else np.nan)
                digits_only = non_null.astype(str).str.fullmatch(r"\s*-?[\d.,]+\s*(?:%|€|\$|eur|euro|usd|kg|g|cm|mm|km|m|l|°c|°)?\s*", flags=re.I)
                # «3A»/«3B» must not collapse into the same number: every distinct text needs its own value
                if digits_only.mean() >= 0.9 and numeric.notna().sum() >= 0.9 * len(non_null) and numeric.nunique() >= unique * 0.98:
                    out[name], info = numeric, {"strategia": "numero (da testo)", "min": float(numeric.min()), "max": float(numeric.max())}
                elif intervals.notna().sum() >= 0.9 * len(non_null):
                    out[name] = intervals.astype(float)
                    ordered = sorted({str(v) for v in non_null.unique()}, key=lambda t: _interval_value(t) if _interval_value(t) is not None else 0)
                    info = {"strategia": "intervalli → valore centrale", "mappatura": {t: round(float(_interval_value(t)), 4) for t in ordered if _interval_value(t) is not None},
                            "min": float(intervals.min()), "max": float(intervals.max())}
                elif (boolean := _as_boolean(series)) is not None:
                    out[name], info = boolean
                elif (found := _match_scale(series)) is not None:
                    out[name], info = _ordinal(series, found[1], found[0], scale)
                else:
                    with warnings.catch_warnings():
                        warnings.simplefilter("ignore")
                        if pd.api.types.is_datetime64_any_dtype(series):
                            dates = series
                        else:
                            iso = series.dropna().astype(str).str.match(r"^\s*\d{4}-\d{1,2}-\d{1,2}").mean() >= 0.9
                            dates = pd.to_datetime(series, errors="coerce", dayfirst=not iso)
                    if dates.notna().sum() >= 0.9 * len(non_null) and unique > 2:
                        days = (dates - dates.min()).dt.days.astype(float)
                        out[name] = days
                        info = {"strategia": "data → giorni dalla prima", "min": 0.0, "max": float(days.max()), "origine": str(dates.min().date())}
                    elif unique <= 1:
                        out[name] = series.map(lambda v: 0.0 if pd.notna(v) else np.nan)
                        info = {"strategia": "costante", "nota": "un solo valore: la colonna non porta informazione", "min": 0.0, "max": 0.0}
                    elif unique == 2:
                        keys = sorted({str(v) for v in non_null.unique()}, key=_fold)
                        out[name] = series.map(lambda v: float(str(v) == keys[1]) if pd.notna(v) else np.nan)
                        info = {"strategia": "binaria", "mappatura": {keys[0]: 0.0, keys[1]: 1.0}, "min": 0.0, "max": 1.0}
                    elif unique > 0.9 * len(non_null) and len(non_null) > 20 and series.dtype == object:
                        info = {"strategia": "invariata", "nota": "sembra un identificativo (quasi ogni valore è diverso): escludila dalle feature"}
                        warnings_.append(f"«{name}» sembra un identificativo e non è stata codificata")
                    elif unique <= max_onehot:
                        out, info = _one_hot(out, name, drop_first)
                    elif target_series is not None:
                        means = target_series.groupby(series).mean()
                        out[name] = series.map(means).astype(float)
                        info = {"strategia": f"media del target ({unique} categorie)", "min": float(means.min()), "max": float(means.max())}
                    else:
                        freq = series.map(series.value_counts(normalize=True))
                        out[name] = freq.astype(float)
                        info = {"strategia": f"frequenza relativa ({unique} categorie, troppe per one-hot)", "min": float(freq.min()), "max": float(freq.max())}
        except ValueError:
            raise
        report[name] = info

    summary = {name: _describe(info) for name, info in report.items()}
    if warnings_:
        summary["_avvisi"] = " · ".join(warnings_)
    return out, {"colonne": summary, "dettagli": report}


def _describe(info: dict[str, Any]) -> str:
    text = str(info.get("strategia", ""))
    if info.get("scala"):
        text += f" «{info['scala']}»"
    mapping = info.get("mappatura")
    if mapping:
        shown = ", ".join(f"{k}→{_fmt(v) if isinstance(v, (int, float)) else v}" for k, v in list(mapping.items())[:12])
        text += f": {shown}{' …' if len(mapping) > 12 else ''}"
    if info.get("nuove_colonne"):
        text += f": {', '.join(info['nuove_colonne'])}"
    if "min" in info and "max" in info and info.get("strategia") != "invariata":
        text += f" [min {_fmt(info['min'])}, max {_fmt(info['max'])}]"
    if info.get("nota"):
        text += f" ({info['nota']})"
    return text
