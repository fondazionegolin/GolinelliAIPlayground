"""Typed node catalogue and executors for the Agentic Beta dataflow studio.

Values crossing the API boundary are deliberately JSON serialisable.  A table is
represented as ``{"columns": [...], "rows": [{...}]}``; trained sklearn models
are scoped to the current process and referenced by an opaque handle.
"""
from __future__ import annotations

import json
import math
import re
import uuid
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

import numpy as np
import pandas as pd


DEFAULT_EXIT_PHRASES = "grazie, ok basta, basta così, sono soddisfatto, ho capito, fine, ciao"
# contiene = una delle parole (CSV); uguale = coincide con uno dei valori (CSV); verifica_ai = giudizio LLM sul criterio;
# vero_falso = il valore collegato è già un booleano/esito.
REPEAT_MODES = ("contiene", "uguale", "verifica_ai", "vero_falso")

NodeHandler = Callable[[dict[str, Any], dict[str, Any], dict[str, Any]], Awaitable[dict[str, Any]]]
MODEL_STORE: dict[str, Any] = {}
VARIABLE_PATTERN = re.compile(r"\$([A-Za-z_]\w*)")


def interpolate_variables(text: Any, variables: dict[str, Any]) -> str:
    """Replace ``$nome_variabile`` with the matching saved chat variable."""
    return VARIABLE_PATTERN.sub(lambda match: str(variables.get(match.group(1), match.group(0))), str(text))


def port(name: str, data_type: str, label: str | None = None, required: bool = True) -> dict[str, Any]:
    return {"name": name, "type": data_type, "label": label or name, "required": required}


def param(name: str, kind: str, label: str, default: Any = None, **extra: Any) -> dict[str, Any]:
    return {"name": name, "type": kind, "label": label, "default": default, **extra}


def spec(node_id: str, label: str, category: str, inputs: list[dict[str, Any]], outputs: list[dict[str, Any]],
         params: list[dict[str, Any]] | None = None, description: str = "", cache: str = "auto") -> dict[str, Any]:
    return {"id": node_id, "label": label, "category": category, "inputs": inputs, "outputs": outputs,
            "params": params or [], "description": description, "cachePolicy": cache}


AI_TRANSFORM_TASKS = {
    "custom": "Segui solo le istruzioni date dall'utente.",
    "image_prompt": "Trasforma l'input in UN prompt ottimizzato per un generatore di immagini: soggetto, stile, composizione, luce, dettagli. Restituisci solo il prompt, senza virgolette né spiegazioni.",
    "summarize": "Riassumi l'input in modo chiaro e fedele.",
    "translate": "Traduci l'input nella lingua richiesta mantenendo formattazione e tono.",
    "extract_table": "Estrai dall'input una tabella. Restituisci esclusivamente un array JSON di oggetti con chiavi coerenti, senza markdown.",
    "make_slides": 'Crea una presentazione dall\'input. Restituisci esclusivamente un array JSON di slide {"title": str, "bullets": [str, ...]}, senza markdown.',
    "make_quiz": 'Crea un quiz a risposta multipla dall\'input. Restituisci esclusivamente un array JSON di {"type": "mcq", "question": str, "options": [str, str, str, str], "correct_option": int}, senza markdown.',
}


NODE_SPECS = [
    spec("ai.generate_dataset", "Genera dataset con AI", "Sorgenti", [], [port("table", "TABLE"), port("metadata", "METRICS")], [
        param("prompt", "CODE", "Descrizione dataset", "Dataset realistico sui consumi energetici mensili di edifici scolastici"),
        param("columns", "STRING", "Colonne richieste", "mese,studenti,kwh,costo_euro"),
        param("rows", "INTEGER", "Numero righe", 30, min=5, max=300),
        param("provider", "STRING", "Provider (opzionale)", ""),
        param("model", "STRING", "Modello (opzionale)", ""),
    ], "Genera una tabella coerente tramite un modello LLM configurato in GOLIAI; viene salvata automaticamente nella libreria dataset.", "never"),
    spec("data.saved_dataset", "Dataset salvato", "Sorgenti", [], [port("table", "TABLE")],
         [param("dataset_id", "DATASET", "Dataset", "")], "Riusa un dataset già generato o caricato in precedenza, senza rigenerarlo.", "never"),
    spec("data.custom_input", "Tabella manuale", "Sorgenti", [], [port("table", "TABLE")],
         [param("data", "CODE", "Dati JSON/CSV (o carica un file)", "[{\"x\": 1, \"y\": 2}]")], "Crea una tabella da dati inseriti manualmente o da un file CSV/JSON caricato."),
    spec("csv.synthetic", "Dataset sintetico", "Sorgenti", [], [port("table", "TABLE")], [
        param("kind", "SELECT", "Tipo", "regression", options=["regression", "classification", "blobs", "moons", "circles"]),
        param("samples", "INTEGER", "Righe", 100, min=10, max=5000), param("features", "INTEGER", "Feature", 3, min=2, max=20),
        param("seed", "INTEGER", "Seed", 42)], "Genera dati riproducibili per esperimenti ML."),
    spec("math.numeric_input", "Valore numerico", "Sorgenti", [], [port("value", "ANY")],
         [param("value", "NUMBER", "Valore", 0)], "Immette un numero nel flusso."),
    spec("data.new_table", "Nuova tabella da input", "Sorgenti", [port("table", "TABLE", "Dati in ingresso")], [port("table", "TABLE")], [
        param("columns", "COLUMNS", "Colonne da copiare (vuoto = tutte, nell'ordine scelto)", ""),
        param("rename", "STRING", "Rinomina (vecchio:nuovo, separati da virgola)", "", required=False),
        param("title", "STRING", "Nome della nuova tabella", "Nuova tabella"),
        param("save_to_library", "BOOLEAN", "Salva nella libreria dataset", False)],
        "Materializza in una nuova tabella i dati arrivati da un altro nodo (es. dopo Seleziona colonne); può riordinare, rinominare e salvare in libreria.", "never"),
    spec("data.select", "Seleziona colonne", "Trasformazioni", [port("table", "TABLE")], [port("table", "TABLE")], [
        param("mode", "SELECT", "Modalità", "include", options=["include", "exclude"]), param("columns", "COLUMNS", "Colonne", "")], "Include o esclude colonne."),
    spec("data.filter", "Filtra righe", "Trasformazioni", [port("table", "TABLE")], [port("table", "TABLE")],
         [param("expression", "CODE", "Espressione pandas (vuota = nessun filtro)", "")], "Filtra una tabella con una query, es. eta > 18 and citta == 'Bologna'."),
    spec("data.rename_columns", "Rinomina colonne", "Trasformazioni", [port("table", "TABLE")], [port("table", "TABLE")],
         [param("rename", "STRING", "Rinomina (vecchio:nuovo, separati da virgola)", "")], "Cambia il nome di una o più colonne."),
    spec("data.sort", "Ordina righe", "Trasformazioni", [port("table", "TABLE")], [port("table", "TABLE")], [
        param("column", "COLUMN", "Colonna", ""), param("order", "SELECT", "Ordine", "ascending", options=["ascending", "descending"]),
        param("limit", "INTEGER", "Tieni prime N righe (0 = tutte)", 0, min=0)], "Ordina la tabella per una colonna, opzionalmente tenendo le prime N righe."),
    spec("data.group_by", "Raggruppa e aggrega", "Trasformazioni", [port("table", "TABLE")], [port("table", "TABLE")], [
        param("group_column", "COLUMN", "Raggruppa per", ""), param("value_columns", "COLUMNS", "Colonne da aggregare (vuoto = numeriche)", ""),
        param("aggregation", "SELECT", "Aggregazione", "mean", options=["mean", "sum", "count", "min", "max", "median"])], "Crea una tabella riassuntiva per gruppo (media, somma, conteggio…)."),
    spec("data.compute_column", "Colonna calcolata", "Trasformazioni", [port("table", "TABLE")], [port("table", "TABLE")], [
        param("name", "STRING", "Nome nuova colonna", "nuova_colonna"), param("expression", "CODE", "Formula (es. costo_euro / kwh)", "")],
        "Aggiunge una colonna calcolata a partire dalle altre."),
    spec("data.dropna", "Rimuovi mancanti", "Trasformazioni", [port("table", "TABLE")], [port("table", "TABLE")],
         [param("how", "SELECT", "Regola", "any", options=["any", "all"])], "Rimuove righe con valori mancanti."),
    spec("data.transform", "Trasforma dati", "Trasformazioni", [port("table", "TABLE")], [port("table", "TABLE")], [
        param("operation", "SELECT", "Operazione", "standardize", options=["standardize", "minmax", "robust", "log", "sqrt", "fillna"]),
        param("columns", "COLUMNS", "Colonne", ""), param("fill_value", "NUMBER", "Valore sostitutivo", 0)], "Scala, trasforma o completa colonne."),
    spec("data.split", "Train / test split", "Trasformazioni", [port("table", "TABLE")], [port("train", "TABLE"), port("test", "TABLE")], [
        param("test_size", "SLIDER", "Quota test", .2, min=.05, max=.5, step=.05), param("stratify_column", "COLUMN", "Stratifica", "", required=False), param("seed", "INTEGER", "Seed", 42)], "Divide il dataset in modo riproducibile."),
    spec("data.slice", "Affetta righe", "Trasformazioni", [port("table", "TABLE")], [port("table", "TABLE")], [
        param("start", "INTEGER", "Inizio", 0), param("end", "INTEGER", "Fine", 100), param("step", "INTEGER", "Passo", 1)], "Seleziona un intervallo di righe."),
    spec("data.merge_columns", "Combina tabelle", "Trasformazioni", [port("table_1", "TABLE"), port("table_2", "TABLE", required=False)], [port("table", "TABLE")],
         [param("merge_mode", "SELECT", "Modalità", "horizontal", options=["horizontal", "vertical"])], "Unisce tabelle per righe o colonne."),
    spec("data.convert_to_number", "Converti in numero", "Trasformazioni", [port("table", "TABLE")], [port("table", "TABLE")],
         [param("columns", "COLUMNS", "Colonne", ""), param("decimal_separator", "SELECT", "Decimali", "auto", options=["auto", ",", "."])], "Converte stringhe numeriche europee o internazionali."),
    spec("nlp.clean_text", "Pulisci testo", "Testo", [port("table", "TABLE")], [port("table", "TABLE")], [
        param("column", "COLUMN", "Colonna", "text"), param("lowercase", "BOOLEAN", "Minuscolo", True), param("remove_numbers", "BOOLEAN", "Rimuovi numeri", False)], "Normalizza una colonna testuale."),
    spec("nlp.sentiment", "Analisi del sentiment", "Testo", [port("table", "TABLE")], [port("table", "TABLE"), port("metrics", "METRICS")], [
        param("column", "COLUMN", "Colonna", "text"), param("neutral_threshold", "SLIDER", "Soglia neutra", .1, min=0, max=.5, step=.05)], "Calcola polarità e classe positive/negative/neutral."),
    spec("ai.transform", "Elabora con AI", "Testo", [port("input", "ANY", "Input (testo, tabella, risposta…)", required=False), port("extra", "ANY", "Contesto aggiuntivo", required=False)],
         [port("text", "ANY", "Testo"), port("table", "TABLE", "Tabella"), port("slides", "ANY", "Slide / quiz (JSON)")], [
        param("task", "SELECT", "Compito", "custom", options=list(AI_TRANSFORM_TASKS)),
        param("instruction", "CODE", "Istruzioni (obbligatorie per «custom», opzionali per gli altri)", ""),
        param("language", "STRING", "Lingua di output", "italiano"),
        param("provider", "STRING", "Provider (opzionale)", ""), param("model", "STRING", "Modello (opzionale)", ""),
        param("max_tokens", "INTEGER", "Token massimi", 2048)],
         "Elaborazione AI one-shot: ottimizza un prompt per immagini, riassumi, traduci, estrai una tabella da un testo, crea slide o un quiz live. Collega l'uscita giusta (testo, tabella, slide) al nodo successivo.", "never"),
    spec("text.from_table", "Tabella → testo", "Testo", [port("table", "TABLE")], [port("text", "ANY")], [
        param("format", "SELECT", "Formato", "markdown", options=["markdown", "csv", "json"]), param("max_rows", "INTEGER", "Righe massime", 50, min=1, max=1000)],
         "Converte una tabella in testo (Markdown, CSV o JSON) per darla a un chatbot, a un prompt o a un documento."),
    spec("text.template", "Componi testo", "Testo", [port("a", "ANY", required=False), port("b", "ANY", required=False), port("c", "ANY", required=False)], [port("text", "ANY")], [
        param("template", "CODE", "Modello ({a}, {b}, {c})", "Disegna in modo dettagliato: {a}")],
         "Costruisce un testo unendo più valori collegati (anche tabelle o risposte AI) in un modello, ad esempio per comporre un prompt."),
    spec("math.operation", "Operazione", "Matematica", [port("a", "ANY"), port("b", "ANY", required=False)], [port("result", "ANY")], [
        param("operation", "SELECT", "Operazione", "add", options=["add", "subtract", "multiply", "divide", "power", "modulo", "sqrt", "log", "sin", "cos", "round"])], "Calcolo scalare o vettoriale."),
    spec("math.result", "Risultato numerico", "Matematica", [port("value", "ANY")], [port("result", "ANY"), port("metrics", "METRICS")],
         [param("aggregation", "SELECT", "Aggregazione", "mean", options=["first", "last", "mean", "sum", "min", "max", "median", "std", "all"])], "Riduce o riassume un risultato."),
    spec("math.aggregate", "Aggrega valori", "Matematica", [port("a", "ANY"), port("b", "ANY", required=False), port("c", "ANY", required=False)], [port("result", "ANY")],
         [param("aggregation", "SELECT", "Aggregazione", "mean", options=["mean", "sum", "min", "max", "std"])], "Combina fino a tre input numerici."),
    spec("math.equation", "Equazione", "Matematica", [], [port("equation", "ANY"), port("latex", "ANY")],
         [param("expression", "CODE", "Espressione", "x**2 + 2*x + 1")], "Interpreta una formula simbolica e produce LaTeX."),
    spec("math.evaluate", "Valuta equazione", "Matematica", [port("equation", "ANY")], [port("table", "TABLE")],
         [param("x_values", "STRING", "Valori X", "-2,-1,0,1,2")], "Valuta f(x) su una lista di punti."),
    spec("math.function_analysis", "Analizza funzione", "Matematica", [port("equation", "ANY")], [port("analysis", "METRICS")], [], "Calcola derivata, integrale, zeri e punti critici."),
    spec("ml.regression", "Regressione", "Machine Learning", [port("train", "TABLE")], [port("model", "MODEL"), port("metrics", "METRICS"), port("predictions", "TABLE")], [
        param("target_column", "COLUMN", "Target", "target"), param("feature_columns", "COLUMNS", "Feature", ""), param("algorithm", "SELECT", "Algoritmo", "linear", options=["linear", "ridge", "lasso", "random_forest", "gradient_boosting", "svr", "knn"]), param("cv_folds", "INTEGER", "Cross validation", 5, min=2, max=10)], "Addestra un regressore e calcola MAE, RMSE e R²."),
    spec("ml.classification", "Classificazione", "Machine Learning", [port("train", "TABLE")], [port("model", "MODEL"), port("metrics", "METRICS"), port("predictions", "TABLE")], [
        param("target_column", "COLUMN", "Target", "target"), param("feature_columns", "COLUMNS", "Feature", ""), param("algorithm", "SELECT", "Algoritmo", "logistic", options=["logistic", "random_forest", "gradient_boosting", "svc", "knn", "naive_bayes"]), param("cv_folds", "INTEGER", "Cross validation", 5, min=2, max=10)], "Addestra un classificatore e calcola accuracy, precision, recall e F1."),
    spec("ml.predict", "Applica modello", "Machine Learning", [port("model", "MODEL"), port("data", "TABLE")], [port("predictions", "TABLE")], [], "Applica un modello addestrato a nuovi dati."),
    spec("ml.kmeans_clustering", "Clustering K-Means", "Machine Learning", [port("table", "TABLE")], [port("table", "TABLE"), port("metrics", "METRICS"), port("plot", "ANY")], [
        param("columns", "COLUMNS", "Feature", ""), param("clusters", "INTEGER", "Cluster", 3, min=2, max=12), param("normalize", "BOOLEAN", "Normalizza", True)], "Segmenta i dati e misura silhouette e Davies-Bouldin."),
    spec("plot.2d", "Grafico", "Visualizzazioni", [port("table", "TABLE")], [port("plot", "ANY")], [param("x", "COLUMN", "Asse X", "x"), param("y", "COLUMN", "Asse Y", "y"), param("z", "COLUMN", "Asse Z (opzionale, per 3D)", "", required=False), param("color", "COLUMN", "Colore", "", required=False)], "Scatter 2D; imposta anche l'asse Z per una vista 3D orientabile."),
    spec("plot.histogram", "Istogramma", "Visualizzazioni", [port("table", "TABLE")], [port("plot", "ANY")], [param("column", "COLUMN", "Colonna", "x"), param("bins", "INTEGER", "Intervalli", 20)], "Mostra la distribuzione di una colonna."),
    spec("chatbot.start", "Inizio conversazione", "Chatbot", [], [port("next", "ANY", "Avvio")],
         [param("welcome_message", "STRING", "Messaggio di benvenuto (opzionale)", "")], "Punto di ingresso del flusso: ogni chatbot deve iniziare da qui.", "never"),
    spec("chatbot.say", "Messaggio", "Chatbot", [port("trigger", "ANY", "In", required=False)], [port("next", "ANY", "Continua")], [param("message", "STRING", "Messaggio", "Ciao!")], "Invia un messaggio; richiama una variabile salvata con $nome.", "never"),
    spec("chatbot.ask", "Domanda", "Chatbot", [port("trigger", "ANY", "In", required=False)], [port("response", "ANY", "Risposta")], [param("question", "STRING", "Domanda", "Come posso aiutarti?"), param("test_response", "STRING", "Risposta test (solo anteprima)", "")], "Pone una domanda e sospende il flusso in attesa della risposta reale. Può essere il primo nodo di un dialogo.", "never"),
    spec("chatbot.if_contains", "Contiene parole", "Chatbot", [port("text", "ANY", "Testo")], [port("yes", "ANY", "Sì"), port("no", "ANY", "No")], [param("keywords", "STRING", "Parole (CSV)", "urgente"), param("case_sensitive", "BOOLEAN", "Maiuscole", False)], "Dirama il dialogo in base alle parole trovate.", "never"),
    spec("chatbot.yes_no", "Sì / No", "Chatbot", [port("text", "ANY", "Testo")], [port("yes", "ANY", "Sì"), port("no", "ANY", "No")], [], "Interpreta una risposta binaria.", "never"),
    spec("chatbot.multi_choice", "Scelta multipla", "Chatbot", [port("trigger", "ANY", "In", required=False)], [port("choice_1", "ANY"), port("choice_2", "ANY"), port("choice_3", "ANY"), port("choice_4", "ANY")], [param("question", "STRING", "Domanda", "Scegli"), *[param(f"option_{i}", "STRING", f"Opzione {i}", f"Opzione {i}") for i in range(1, 5)], param("test_choice", "INTEGER", "Scelta test (0 = nessuna, attende risposta reale)", 0, min=0, max=4)], "Sospende il flusso finché lo studente non sceglie un'opzione reale; attiva un solo ramo.", "never"),
    spec("chatbot.save_variable", "Salva variabile", "Chatbot", [port("value", "ANY")], [port("next", "ANY")], [param("variable_name", "STRING", "Nome", "risposta")], "Memorizza un valore per la sessione.", "never"),
    spec("chatbot.show_variables", "Mostra variabili", "Chatbot", [port("trigger", "ANY", "In", required=False)], [port("variables", "PARAMS")], [], "Espone lo stato della conversazione.", "never"),
    spec("llm_chatbot", "Chatbot LLM", "Chatbot", [
        port("message", "ANY", "Domanda / messaggio", required=False),
        port("context_1", "ANY", "Contesto 1", required=False),
        port("context_2", "ANY", "Contesto 2", required=False),
        port("context_3", "ANY", "Contesto 3", required=False),
    ], [port("response", "ANY", "Risposta"), port("next", "ANY", "Continua")], [
        param("system_prompt", "CODE", "Condizionamento di sistema", "Sei un assistente utile. Usa il contesto collegato (tabelle, grafici, testo di altri nodi) per rispondere in modo pertinente."),
        param("continuous", "BOOLEAN", "Iterazione continua", False),
        param("exit_phrases", "STRING", "Frasi di chiusura (esempi per il modello)", DEFAULT_EXIT_PHRASES),
        param("max_turns", "INTEGER", "Turni massimi in iterazione continua", 20, min=1, max=100),
        param("max_tokens", "INTEGER", "Token massimi", 1024)],
        "Risponde con un modello cloud; può leggere fino a 3 nodi di contesto. Con l'iterazione continua dialoga a più turni finché lo studente non chiude (es. \"grazie\", \"ok basta\").", "never"),
    spec("control.if_else", "IF / ELSE", "Controllo", [port("condition", "ANY")], [port("yes", "ANY"), port("no", "ANY")], [], "Attiva un ramo booleano.", "never"),
    spec("control.repeat_until", "Ripeti finché", "Controllo", [port("value", "ANY", "Valore da verificare")],
         [port("ok", "ANY", "Condizione ok"), port("repeat", "ANY", "Ripeti ↺"), port("exhausted", "ANY", "Tentativi finiti")], [
        param("mode", "SELECT", "Condizione", "contiene", options=list(REPEAT_MODES)),
        param("expected", "STRING", "Valore atteso / criterio", "56"),
        param("max_attempts", "INTEGER", "Tentativi massimi", 3, min=1, max=20)],
        "Verifica un valore (es. la risposta a una Domanda): se la condizione è soddisfatta prosegue da «Condizione ok», altrimenti «Ripeti» può tornare a un nodo precedente; dopo i tentativi massimi esce da «Tentativi finiti».", "never"),
    spec("control.compare_numbers", "Confronta numeri", "Controllo", [port("a", "ANY"), port("b", "ANY")], [port("yes", "ANY"), port("no", "ANY")], [param("operator", "SELECT", "Operatore", ">", options=[">", ">=", "<", "<=", "==", "!="])], "Confronta due valori per il branching.", "never"),
    spec("control.counter", "Contatore", "Controllo", [port("trigger", "ANY", required=False)], [port("value", "ANY")], [param("start", "INTEGER", "Inizio", 0), param("step", "INTEGER", "Passo", 1)], "Incrementa un contatore di sessione.", "never"),
    spec("chatbot.end", "Fine conversazione", "Chatbot", [port("trigger", "ANY", "In", required=False)], [port("result", "ANY", "Esito")], [param("message", "STRING", "Messaggio finale", "Conversazione conclusa.")], "Chiude il ramo conversazionale: ogni percorso del flusso deve terminare qui.", "never"),
]

# Start/end nodes are no longer offered: a dialogue starts at its first node and ends where the path ends.
# Saved workflows that still contain them keep running, so they stay registered but hidden from the palette.
for _legacy in ("chatbot.start", "chatbot.end"):
    next(item for item in NODE_SPECS if item["id"] == _legacy)["hidden"] = True

NODE_REGISTRY = {item["id"]: item for item in NODE_SPECS}


def table_frame(value: Any) -> pd.DataFrame:
    if isinstance(value, dict) and isinstance(value.get("rows"), list):
        return pd.DataFrame(value["rows"], columns=value.get("columns"))
    if isinstance(value, list):
        return pd.DataFrame(value)
    raise ValueError("È richiesta una tabella")


def json_value(value: Any) -> Any:
    if isinstance(value, pd.DataFrame):
        clean = value.replace({np.nan: None, np.inf: None, -np.inf: None})
        return {"columns": list(clean.columns), "rows": clean.to_dict(orient="records"), "rowCount": len(clean)}
    if isinstance(value, (np.integer, np.floating, np.bool_)):
        value = value.item()
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, dict):
        return {str(k): json_value(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_value(v) for v in value]
    if isinstance(value, float) and (math.isnan(value) or math.isinf(value)):
        return None
    return value


def columns(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value]
    return [item.strip() for item in str(value or "").split(",") if item.strip()]


def available_columns(df: pd.DataFrame) -> list[str]:
    return [str(name) for name in df.columns]


def require_columns(df: pd.DataFrame, requested: Any, *, fallback: list[str] | None = None,
                    label: str = "colonne") -> list[str]:
    """Resolve configured columns and return actionable errors instead of pandas traces."""
    names = columns(requested) or list(fallback or [])
    missing = [name for name in names if name not in df.columns]
    if missing:
        raise ValueError(
            f"{label.capitalize()} non presenti: {', '.join(missing)}. "
            f"Disponibili: {', '.join(available_columns(df)) or 'nessuna'}"
        )
    return names


def rename_mapping(df: pd.DataFrame, raw: Any) -> dict[str, str]:
    """Parse ``vecchio:nuovo, altro:nome`` into a pandas rename map, validating the source names."""
    mapping: dict[str, str] = {}
    for chunk in str(raw or "").split(","):
        if not chunk.strip():
            continue
        if ":" not in chunk:
            raise ValueError(f"Rinomina non valida: '{chunk.strip()}'. Usa il formato vecchio:nuovo")
        old, new = (part.strip() for part in chunk.split(":", 1))
        if old and new:
            mapping[old] = new
    require_columns(df, list(mapping), label="colonne da rinominare")
    return mapping


def numeric_values(value: Any) -> np.ndarray:
    """Coerce scalars, lists and tables (first numeric column) into a float array."""
    if isinstance(value, dict) and isinstance(value.get("rows"), list):
        df = table_frame(value).select_dtypes(include="number")
        if df.empty:
            raise ValueError("La tabella collegata non contiene colonne numeriche")
        return df.iloc[:, 0].dropna().to_numpy(dtype=float)
    if isinstance(value, dict) and "result" in value:
        value = value["result"]
    return np.asarray(value if isinstance(value, list) else [value], dtype=float)


def preferred_column(df: pd.DataFrame, requested: Any, *, numeric: bool = False,
                     exclude: set[str] | None = None, label: str = "colonna") -> str:
    excluded = exclude or set()
    candidates = [str(name) for name in (df.select_dtypes(include="number").columns if numeric else df.columns)
                  if str(name) not in excluded]
    name = str(requested or "").strip()
    if name and name in df.columns and (not numeric or pd.api.types.is_numeric_dtype(df[name])) and name not in excluded:
        return name
    if candidates:
        return candidates[0]
    kind = " numeriche" if numeric else ""
    raise ValueError(f"Nessuna {label}{kind} disponibile. Colonne: {', '.join(available_columns(df)) or 'nessuna'}")


def table_to_markdown(table: dict[str, Any], max_rows: int = 50) -> str:
    rows = table.get("rows") or []
    columns = table.get("columns") or (list(rows[0].keys()) if rows else [])
    lines = ["| " + " | ".join(str(c) for c in columns) + " |", "| " + " | ".join("---" for _ in columns) + " |"]
    lines += ["| " + " | ".join(str(row.get(c, "")).replace("\n", " ") for c in columns) + " |" for row in rows[:max_rows]]
    if len(rows) > max_rows:
        lines.append(f"… e altre {len(rows) - max_rows} righe")
    return "\n".join(lines)


def value_to_text(value: Any, max_rows: int = 50) -> str:
    """Universal port coercion: any node output (LLM payload, table, plot, number, JSON) as plain text for a text input."""
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        if isinstance(value.get("rows"), list):
            return table_to_markdown(value, max_rows)
        if value.get("message") is not None and (value.get("provider") or value.get("model")):
            return str(value["message"])
        for key in ("text", "message", "content", "result"):
            if isinstance(value.get(key), str):
                return value[key]
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    if isinstance(value, (dict, list)):
        return json.dumps(json_value(value), ensure_ascii=False, indent=2)[:20000]
    return str(value)


async def execute_data_node(node_type: str, inputs: dict[str, Any], config: dict[str, Any], state: dict[str, Any]) -> dict[str, Any]:
    from sklearn.cluster import KMeans
    from sklearn.datasets import make_blobs, make_circles, make_classification, make_moons, make_regression
    from sklearn.ensemble import GradientBoostingClassifier, GradientBoostingRegressor, RandomForestClassifier, RandomForestRegressor
    from sklearn.linear_model import Lasso, LinearRegression, LogisticRegression, Ridge
    from sklearn.metrics import accuracy_score, davies_bouldin_score, f1_score, mean_absolute_error, mean_squared_error, precision_score, r2_score, recall_score, silhouette_score
    from sklearn.model_selection import cross_val_score, train_test_split
    from sklearn.naive_bayes import GaussianNB
    from sklearn.neighbors import KNeighborsClassifier, KNeighborsRegressor
    from sklearn.preprocessing import MinMaxScaler, RobustScaler, StandardScaler
    from sklearn.svm import SVC, SVR

    if node_type == "text.from_table":
        table = inputs.get("table") or {"columns": [], "rows": []}
        frame = table_frame(table)
        limit = max(1, int(config.get("max_rows", 50)))
        fmt = str(config.get("format") or "markdown")
        if fmt == "csv":
            return {"text": frame.head(limit).to_csv(index=False)}
        if fmt == "json":
            return {"text": json.dumps(json_value(frame.head(limit)).get("rows", []), ensure_ascii=False, indent=2)}
        return {"text": table_to_markdown(json_value(frame), limit)}
    if node_type == "text.template":
        values = {key: value_to_text(inputs.get(key)) for key in ("a", "b", "c")}
        template = str(config.get("template") or "{a}")
        return {"text": re.sub(r"\{([abc])\}", lambda m: values[m.group(1)], template)}
    if node_type == "math.numeric_input":
        return {"value": float(config.get("value", 0))}
    if node_type == "data.custom_input":
        import json
        raw = config.get("data", "[]")
        if isinstance(raw, str):
            try: data = json.loads(raw)
            except ValueError:
                from io import StringIO
                data = pd.read_csv(StringIO(raw))
        else: data = raw
        return {"table": json_value(data if isinstance(data, pd.DataFrame) else pd.DataFrame(data))}
    if node_type == "csv.synthetic":
        kind, n, features, seed = config.get("kind", "regression"), int(config.get("samples", 100)), int(config.get("features", 3)), int(config.get("seed", 42))
        if kind == "regression": x, y = make_regression(n_samples=n, n_features=features, noise=8, random_state=seed)
        elif kind == "classification": x, y = make_classification(n_samples=n, n_features=features, n_informative=max(2, features - 1), n_redundant=0, random_state=seed)
        elif kind == "blobs": x, y = make_blobs(n_samples=n, n_features=features, random_state=seed)
        elif kind == "moons": x, y = make_moons(n_samples=n, noise=.12, random_state=seed)
        else: x, y = make_circles(n_samples=n, noise=.08, factor=.5, random_state=seed)
        df = pd.DataFrame(x, columns=[f"feature_{i+1}" for i in range(x.shape[1])]); df["target"] = y
        return {"table": json_value(df)}
    if node_type.startswith("data.") or node_type.startswith("nlp."):
        source = inputs.get("table") or inputs.get("table_1")
        df = table_frame(source)
        if node_type == "data.new_table":
            names = require_columns(df, config.get("columns"), fallback=list(df.columns), label="colonne da copiare")
            df = df[names].copy().rename(columns=rename_mapping(df, config.get("rename")))
            return {"table": json_value(df.reset_index(drop=True))}
        if node_type == "data.select":
            requested = columns(config.get("columns"))
            selected = require_columns(df, requested, fallback=[] if config.get("mode") == "exclude" else list(df.columns), label="colonne selezionate")
            df = df.drop(columns=selected) if config.get("mode") == "exclude" else df[selected]
        elif node_type == "data.filter":
            expression = str(config.get("expression") or "").strip()
            if expression:
                try:
                    df = df.query(expression)
                except Exception as exc:
                    raise ValueError(f"Espressione di filtro non valida ({exc}). Colonne disponibili: {', '.join(available_columns(df))}") from exc
        elif node_type == "data.rename_columns": df = df.rename(columns=rename_mapping(df, config.get("rename")))
        elif node_type == "data.sort":
            name = preferred_column(df, config.get("column"), label="colonna di ordinamento")
            df = df.sort_values(name, ascending=config.get("order", "ascending") != "descending", kind="stable")
            limit = int(config.get("limit") or 0)
            if limit > 0: df = df.head(limit)
        elif node_type == "data.group_by":
            group = preferred_column(df, config.get("group_column"), label="colonna di raggruppamento")
            agg = str(config.get("aggregation", "mean"))
            values = require_columns(df, config.get("value_columns"), fallback=[str(c) for c in df.select_dtypes(include="number").columns if str(c) != group], label="colonne da aggregare")
            values = [name for name in values if name != group]
            if agg == "count" or not values:
                df = df.groupby(group, dropna=False).size().reset_index(name="conteggio")
            else:
                non_numeric = [name for name in values if not pd.api.types.is_numeric_dtype(df[name])]
                if non_numeric: raise ValueError(f"Aggregazione '{agg}' richiede colonne numeriche: {', '.join(non_numeric)}")
                df = df.groupby(group, dropna=False)[values].agg(agg).reset_index()
        elif node_type == "data.compute_column":
            name = str(config.get("name") or "").strip() or "nuova_colonna"
            expression = str(config.get("expression") or "").strip()
            if not expression: raise ValueError("Scrivi una formula, ad esempio costo_euro / kwh")
            try:
                df[name] = df.eval(expression)
            except Exception as exc:
                raise ValueError(f"Formula non valida ({exc}). Colonne disponibili: {', '.join(available_columns(df))}") from exc
        elif node_type == "data.dropna": df = df.dropna(how=str(config.get("how", "any")))
        elif node_type == "data.slice": df = df.iloc[int(config.get("start", 0)):int(config.get("end", len(df))):max(1, int(config.get("step", 1)))]
        elif node_type == "data.merge_columns":
            frames = [df] + ([table_frame(inputs["table_2"])] if inputs.get("table_2") is not None else [])
            if config.get("merge_mode") != "vertical" and len(frames) == 2:
                # Side-by-side merge: suffix clashing names instead of producing duplicate keys that JSON would collapse.
                clash = set(map(str, frames[0].columns)) & set(map(str, frames[1].columns))
                frames[1] = frames[1].rename(columns={name: f"{name}_2" for name in clash})
            df = pd.concat(frames, axis=0 if config.get("merge_mode") == "vertical" else 1, ignore_index=config.get("merge_mode") == "vertical")
        elif node_type == "data.convert_to_number":
            for name in require_columns(df, config.get("columns"), fallback=list(df.columns), label="colonne da convertire"):
                series = df[name].astype(str).str.replace(r"[^\d,\.\-]", "", regex=True)
                if config.get("decimal_separator", "auto") == "," or (config.get("decimal_separator", "auto") == "auto" and series.str.contains(",").any()):
                    series = series.str.replace(".", "", regex=False).str.replace(",", ".", regex=False)
                df[name] = pd.to_numeric(series, errors="coerce")
        elif node_type == "data.transform":
            op = config.get("operation", "standardize")
            fallback = list(df.columns) if op == "fillna" else list(df.select_dtypes(include="number").columns)
            names = require_columns(df, config.get("columns"), fallback=fallback, label="colonne da trasformare")
            if not names: raise ValueError("Non ci sono colonne compatibili da trasformare")
            if op != "fillna" and any(not pd.api.types.is_numeric_dtype(df[name]) for name in names):
                raise ValueError("Standardizzazione, normalizzazione, log e radice richiedono colonne numeriche")
            if op in {"standardize", "minmax", "robust"}: df[names] = {"standardize": StandardScaler, "minmax": MinMaxScaler, "robust": RobustScaler}[op]().fit_transform(df[names])
            elif op == "log": df[names] = np.log1p(df[names].clip(lower=0))
            elif op == "sqrt": df[names] = np.sqrt(df[names].clip(lower=0))
            else: df[names] = df[names].fillna(config.get("fill_value", 0))
        elif node_type == "data.split":
            strat = str(config.get("stratify_column") or ""); train, test = train_test_split(df, test_size=float(config.get("test_size", .2)), random_state=int(config.get("seed", 42)), stratify=df[strat] if strat in df else None)
            return {"train": json_value(train.reset_index(drop=True)), "test": json_value(test.reset_index(drop=True))}
        elif node_type == "nlp.clean_text":
            name = preferred_column(df, config.get("column"), label="colonna testuale"); series = df[name].fillna("").astype(str)
            if config.get("lowercase", True): series = series.str.lower()
            series = series.str.replace(r"[^\w\s]", " ", regex=True)
            if config.get("remove_numbers", False): series = series.str.replace(r"\d+", "", regex=True)
            df[name] = series.str.replace(r"\s+", " ", regex=True).str.strip()
        elif node_type == "nlp.sentiment":
            from textblob import TextBlob
            name = preferred_column(df, config.get("column"), label="colonna testuale"); threshold = float(config.get("neutral_threshold", .1))
            df["polarity"] = df[name].fillna("").astype(str).map(lambda text: float(TextBlob(text).sentiment.polarity))
            df["sentiment"] = df["polarity"].map(lambda value: "positive" if value > threshold else "negative" if value < -threshold else "neutral")
            distribution = {str(key): int(value) for key, value in df["sentiment"].value_counts().items()}
            return {"table": json_value(df), "metrics": {"distribution": distribution, "mean_polarity": float(df["polarity"].mean())}}
        return {"table": json_value(df.reset_index(drop=True))}
    if node_type == "math.operation":
        a, b, op = inputs.get("a", 0), inputs.get("b"), config.get("operation", "add")
        # Lists/tables become numpy arrays so "vector" maths is element-wise instead of list concatenation.
        if isinstance(a, (list, dict)): a = numeric_values(a)
        if isinstance(b, (list, dict)): b = numeric_values(b)
        if isinstance(a, np.ndarray) and op in {"sqrt", "log", "sin", "cos", "round"}:
            return {"result": json_value({"sqrt": np.sqrt, "log": np.log, "sin": np.sin, "cos": np.cos, "round": np.round}[op](a))}
        if b is None and op in {"add", "subtract"}: b = 0
        if b is None and op in {"multiply", "divide", "power", "modulo"}: b = 1
        fn = {"add": lambda: a+b, "subtract": lambda: a-b, "multiply": lambda: a*b, "divide": lambda: a/b, "power": lambda: a**b, "modulo": lambda: a%b, "sqrt": lambda: math.sqrt(a), "log": lambda: math.log(a), "sin": lambda: math.sin(a), "cos": lambda: math.cos(a), "round": lambda: round(a)}[op]
        return {"result": json_value(fn())}
    if node_type == "math.result":
        values = numeric_values(inputs.get("value")); agg = config.get("aggregation", "mean")
        if not values.size: raise ValueError("Nessun valore numerico da riassumere")
        funcs = {"first": lambda: values[0], "last": lambda: values[-1], "mean": values.mean, "sum": values.sum, "min": values.min, "max": values.max, "median": lambda: np.median(values), "std": values.std, "all": lambda: values}
        return {"result": json_value(funcs[agg]()), "metrics": {"count": int(values.size), "mean": float(values.mean()), "std": float(values.std())}}
    if node_type == "math.aggregate":
        values = np.concatenate([numeric_values(inputs[key]) for key in ("a", "b", "c") if inputs.get(key) is not None] or [np.asarray([], dtype=float)])
        if not values.size: raise ValueError("Collega almeno un valore numerico")
        agg = str(config.get("aggregation", "mean")); fn = {"mean": values.mean, "sum": values.sum, "min": values.min, "max": values.max, "std": values.std}[agg]
        return {"result": json_value(fn())}
    if node_type in {"math.equation", "math.evaluate", "math.function_analysis"}:
        import sympy as sp
        x = sp.symbols("x")
        raw = config.get("expression") if node_type == "math.equation" else inputs.get("equation")
        expression_text = raw.get("expression") if isinstance(raw, dict) else str(raw)
        expression = sp.sympify(expression_text)
        if node_type == "math.equation": return {"equation": {"expression": str(expression)}, "latex": sp.latex(expression)}
        if node_type == "math.evaluate":
            fn = sp.lambdify(x, expression, "numpy"); xs = [float(item.strip()) for item in str(config.get("x_values", "0")).split(",") if item.strip()]; return {"table": json_value(pd.DataFrame({"x": xs, "y": [float(fn(value)) for value in xs]}))}
        derivative = sp.diff(expression, x); integral = sp.integrate(expression, x)
        return {"analysis": {"expression": str(expression), "derivative": str(derivative), "integral": str(integral), "zeros": [str(item) for item in sp.solve(expression, x)], "critical_points": [str(item) for item in sp.solve(derivative, x)], "latex": sp.latex(expression)}}
    if node_type in {"ml.regression", "ml.classification"}:
        df = table_frame(inputs["train"]).dropna()
        requested_target = str(config.get("target_column") or "").strip()
        target = requested_target if requested_target in df.columns else ("target" if "target" in df.columns else str(df.columns[-1]))
        feats = require_columns(df, config.get("feature_columns"), fallback=[str(c) for c in df.select_dtypes(include="number").columns if str(c) != target], label="feature")
        if target not in df.columns: raise ValueError(f"Target '{target}' non presente")
        if not feats: raise ValueError("Seleziona almeno una feature numerica")
        non_numeric = [name for name in feats if not pd.api.types.is_numeric_dtype(df[name])]
        if non_numeric: raise ValueError(f"Le feature devono essere numeriche: {', '.join(non_numeric)}")
        x, y = df[feats], df[target]; classification = node_type.endswith("classification"); algo = config.get("algorithm") or ("logistic" if classification else "linear")
        models = ({"logistic": LogisticRegression(max_iter=1000), "random_forest": RandomForestClassifier(random_state=42), "gradient_boosting": GradientBoostingClassifier(random_state=42), "svc": SVC(probability=True), "knn": KNeighborsClassifier(), "naive_bayes": GaussianNB()} if classification else {"linear": LinearRegression(), "ridge": Ridge(), "lasso": Lasso(), "random_forest": RandomForestRegressor(random_state=42), "gradient_boosting": GradientBoostingRegressor(random_state=42), "svr": SVR(), "knn": KNeighborsRegressor()})
        model = models[str(algo)]; model.fit(x, y); pred = model.predict(x); handle = f"model:{uuid.uuid4()}"; MODEL_STORE[handle] = {"model": model, "features": feats}
        if classification:
            metrics = {"accuracy": accuracy_score(y, pred), "precision": precision_score(y, pred, average="weighted", zero_division=0), "recall": recall_score(y, pred, average="weighted", zero_division=0), "f1": f1_score(y, pred, average="weighted", zero_division=0)}; scoring = "accuracy"
        else:
            metrics = {"mae": mean_absolute_error(y, pred), "rmse": math.sqrt(mean_squared_error(y, pred)), "r2": r2_score(y, pred)}; scoring = "r2"
        folds = min(int(config.get("cv_folds", 5)), len(df))
        if classification:
            folds = min(folds, int(y.value_counts().min()))
        try:
            metrics["cv_mean"] = float(cross_val_score(model, x, y, cv=folds, scoring=scoring).mean()) if folds >= 2 else None
        except ValueError:
            metrics["cv_mean"] = None
        out = df.copy(); out["prediction"] = pred
        return {"model": {"handle": handle, "algorithm": algo, "features": feats, "target": target}, "metrics": json_value(metrics), "predictions": json_value(out)}
    if node_type == "ml.predict":
        descriptor = inputs["model"]; stored = MODEL_STORE.get(descriptor.get("handle") if isinstance(descriptor, dict) else descriptor)
        if not stored: raise ValueError("Il modello non è più disponibile: riesegui il nodo di training")
        df = table_frame(inputs["data"]); features = require_columns(df, stored["features"], label="feature richieste dal modello")
        df["prediction"] = stored["model"].predict(df[features]); return {"predictions": json_value(df)}
    if node_type == "ml.kmeans_clustering":
        df = table_frame(inputs["table"]); names = require_columns(df, config.get("columns"), fallback=[str(c) for c in df.select_dtypes(include="number").columns], label="feature")
        if not names: raise ValueError("Il clustering richiede almeno una colonna numerica")
        if any(not pd.api.types.is_numeric_dtype(df[name]) for name in names): raise ValueError("Il clustering richiede feature numeriche")
        x = df[names].dropna(); cluster_count = int(config.get("clusters", 3))
        if len(x) <= cluster_count: raise ValueError(f"Servono più di {cluster_count} righe complete per creare {cluster_count} cluster")
        values = StandardScaler().fit_transform(x) if config.get("normalize", True) else x.to_numpy(); model = KMeans(n_clusters=cluster_count, random_state=42, n_init=10).fit(values); df.loc[x.index, "cluster"] = model.labels_
        metrics = {"clusters": cluster_count, "rows": len(x), "inertia": model.inertia_, "silhouette": silhouette_score(values, model.labels_) if len(set(model.labels_)) > 1 else None, "davies_bouldin": davies_bouldin_score(values, model.labels_) if len(set(model.labels_)) > 1 else None}
        plot = None
        if len(names) >= 2:
            plot = {"kind": "scatter", "x": x[names[0]].tolist(), "y": x[names[1]].tolist(), "color": [f"Cluster {int(label)}" for label in model.labels_], "labels": {"x": names[0], "y": names[1]}, "title": f"K-Means Clustering 2D (K={cluster_count})"}
        return {"table": json_value(df), "metrics": json_value(metrics), "plot": plot}
    if node_type.startswith("plot."):
        df = table_frame(inputs["table"])
        if node_type == "plot.2d":
            x = preferred_column(df, config.get("x"), numeric=True, label="asse X")
            y = preferred_column(df, config.get("y"), numeric=True, exclude={x}, label="asse Y")
            color = str(config.get("color") or ""); color = color if color in df.columns else ""
            z_name = str(config.get("z") or "").strip()
            if z_name and z_name in df.columns and pd.api.types.is_numeric_dtype(df[z_name]):
                return {"plot": {"kind": "scatter3d", "x": df[x].tolist(), "y": df[y].tolist(), "z": df[z_name].tolist(),
                                  "color": df[color].tolist() if color in df else None,
                                  "labels": {"x": x, "y": y, "z": z_name}, "title": str(config.get("title") or "Grafico 3D")}}
            return {"plot": {"kind": "scatter", "x": df[x].tolist(), "y": df[y].tolist(), "color": df[color].tolist() if color in df else None, "labels": {"x": x, "y": y}, "title": str(config.get("title") or "Grafico")}}
        name = preferred_column(df, config.get("column"), numeric=True, label="colonna dell'istogramma"); counts, bins = np.histogram(df[name].dropna(), bins=int(config.get("bins", 20)))
        return {"plot": {"kind": "histogram", "x": bins[:-1].tolist(), "xEnd": bins[1:].tolist(), "y": counts.tolist(), "labels": {"x": name, "y": "conteggio"}, "title": str(config.get("title") or f"Distribuzione di {name}")}}
    if node_type in {"control.if_else", "control.compare_numbers"}:
        if node_type == "control.if_else": result = bool(inputs.get("condition"))
        else:
            a, b, op = inputs.get("a"), inputs.get("b"), config.get("operator", ">")
            result = {">": a>b, ">=": a>=b, "<": a<b, "<=": a<=b, "==": a==b, "!=": a!=b}[op]
        return {"yes": result or None, "no": (not result) or None}
    if node_type.startswith("chatbot."):
        variables = state.setdefault("variables", {})
        interpolate = lambda text: interpolate_variables(text, variables)
        if node_type == "chatbot.start": return {"next": True, "message": interpolate(config.get("welcome_message", ""))}
        if node_type == "chatbot.say": return {"next": interpolate(config.get("message", "")), "message": interpolate(config.get("message", ""))}
        if node_type == "chatbot.ask": return {"response": config.get("test_response") or state.get("user_response") or "", "question": interpolate(config.get("question", ""))}
        if node_type == "chatbot.if_contains":
            text = str(inputs.get("text", "")); keys = columns(config.get("keywords")); text_cmp = text if config.get("case_sensitive") else text.lower(); found = any((k if config.get("case_sensitive") else k.lower()) in text_cmp for k in keys); return {"yes": text if found else None, "no": text if not found else None}
        if node_type == "chatbot.yes_no":
            text = str(inputs.get("text", "")).strip().lower(); yes = text in {"sì", "si", "yes", "y", "ok", "certo"}; return {"yes": text if yes else None, "no": text if not yes else None}
        if node_type == "chatbot.multi_choice":
            choice = int(config.get("test_choice") or 1); return {f"choice_{i}": config.get(f"option_{i}") if i == choice else None for i in range(1, 5)}
        if node_type == "chatbot.save_variable": variables[str(config.get("variable_name", "value"))] = inputs.get("value"); return {"next": inputs.get("value")}
        if node_type == "chatbot.show_variables": return {"variables": variables}
        if node_type == "chatbot.end": return {"result": interpolate(config.get("message", "Conversazione conclusa."))}
    if node_type == "control.counter":
        counters = state.setdefault("counters", {}); key = str(config.get("counter_id", "default")); counters[key] = counters.get(key, int(config.get("start", 0))) + int(config.get("step", 1)); return {"value": counters[key]}
    raise ValueError(f"Esecutore non disponibile per {node_type}")
