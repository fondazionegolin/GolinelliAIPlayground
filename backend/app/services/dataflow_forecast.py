"""Time-series forecasting for the Dataflow Studio ``ml.forecast`` node (numpy/pandas/sklearn only).

The node finds the time column (dates, month names, years or plain row order), aggregates duplicate instants,
detects the seasonal period, backtests a few classic methods on the most recent observations and forecasts with the
best one.  Prediction intervals come from the backtest errors and widen with the horizon.
"""
from __future__ import annotations

import math
import re
from statistics import NormalDist
from typing import Any, Callable

import numpy as np
import pandas as pd

TIME_NAME = re.compile(r"(data|date|giorn|day|mese|month|anno|year|settiman|week|\bora\b|hour|time|timestamp|periodo|period|trimestre|quarter|datetime|istante)", re.I)
IT_MONTHS = {
    "gennaio": "january", "febbraio": "february", "marzo": "march", "aprile": "april", "maggio": "may", "giugno": "june",
    "luglio": "july", "agosto": "august", "settembre": "september", "ottobre": "october", "novembre": "november", "dicembre": "december",
    "gen": "jan", "feb": "feb", "mar": "mar", "apr": "apr", "mag": "may", "giu": "jun", "lug": "jul", "ago": "aug",
    "set": "sep", "ott": "oct", "nov": "nov", "dic": "dec",
}
METHODS = ("auto", "holt_winters", "linear_trend", "lag_regression", "seasonal_naive")
MIN_POINTS = 6


def _translate_months(text: str) -> str:
    return re.sub(r"[A-Za-zàèéìòù]+", lambda match: IT_MONTHS.get(match.group(0).lower(), match.group(0)), text)


def parse_time(series: pd.Series) -> pd.Series | None:
    """Datetimes (or numbers for year-like columns) when at least 80% of the values parse, else ``None``."""
    values = series.dropna()
    if values.empty:
        return None
    if pd.api.types.is_datetime64_any_dtype(series):
        return series
    if pd.api.types.is_numeric_dtype(series):
        return pd.to_numeric(series, errors="coerce")
    text = series.astype(str).str.strip().map(_translate_months)
    best: pd.Series | None = None
    # Italian data writes 03/04/2024 as 3 April: with slashes or dots, day-first wins ties.
    order = (True, False) if text.str.contains(r"\d[/.]\d", regex=True).mean() > .5 else (False, True)
    for dayfirst in order:
        try:
            parsed = pd.to_datetime(text, errors="coerce", dayfirst=dayfirst, format="mixed")
        except (ValueError, TypeError):
            continue
        if best is None or parsed.notna().sum() > best.notna().sum():
            best = parsed
    if best is not None and best[series.notna()].notna().mean() >= .8:
        return best
    return None


def detect_time_column(df: pd.DataFrame, requested: Any = None) -> str | None:
    name = str(requested or "").strip()
    if name and name in df.columns:
        return name
    for column in df.columns:
        if pd.api.types.is_datetime64_any_dtype(df[column]):
            return str(column)
    for column in df.columns:  # named like a time axis and parseable (numeric only when the name says so, e.g. «anno»)
        if TIME_NAME.search(str(column)) and parse_time(df[column]) is not None:
            return str(column)
    for column in df.columns:
        if not pd.api.types.is_numeric_dtype(df[column]) and parse_time(df[column]) is not None:
            return str(column)
    return None


def time_columns(df: pd.DataFrame) -> list[str]:
    """Every column that looks like a time axis (tells the assistant that a table is a time series)."""
    found = []
    for column in df.columns:
        named = bool(TIME_NAME.search(str(column)))
        plain_number = pd.api.types.is_numeric_dtype(df[column]) and not pd.api.types.is_datetime64_any_dtype(df[column])
        if plain_number and not named:
            continue
        if parse_time(df[column]) is not None:
            found.append(str(column))
    return found


def _future_times(times: pd.Series, horizon: int) -> list[Any]:
    last = times.iloc[-1]
    if pd.api.types.is_datetime64_any_dtype(times):
        index = pd.DatetimeIndex(times)
        freq = pd.infer_freq(index) if len(index) >= 3 else None
        if freq:
            try:
                return list(pd.date_range(last, periods=horizon + 1, freq=freq)[1:])
            except ValueError:
                pass
        days = float(np.median(np.diff(index.asi8))) / 86_400e9
        if 27 <= days <= 32:
            offset = pd.DateOffset(months=1)
        elif 88 <= days <= 93:
            offset = pd.DateOffset(months=3)
        elif 360 <= days <= 370:
            offset = pd.DateOffset(years=1)
        else:
            step = pd.Timedelta(days=days)
            return [last + step * (i + 1) for i in range(horizon)]
        return [last + offset * (i + 1) for i in range(horizon)]
    values = times.to_numpy(dtype=float)
    step = float(np.median(np.diff(values))) if len(values) > 1 else 1.0
    step = step or 1.0
    return [values[-1] + step * (i + 1) for i in range(horizon)]


def _frequency(times: pd.Series) -> tuple[str, int]:
    """Human label of the sampling interval and its natural seasonal period."""
    if not pd.api.types.is_datetime64_any_dtype(times) or len(times) < 2:
        return ("periodi", 0)
    days = float(np.median(np.diff(pd.DatetimeIndex(times).asi8))) / 86_400e9
    for limit, label, season in ((1 / 24 + 1e-9, "orari", 24), (1.01, "giornalieri", 7), (7.5, "settimanali", 52),
                                 (32, "mensili", 12), (93, "trimestrali", 4), (370, "annuali", 0)):
        if days <= limit:
            return (label, season)
    return ("pluriennali", 0)


def _acf_season(y: np.ndarray) -> int:
    series = np.diff(y) if len(y) > 8 else y - y.mean()
    series = series - series.mean()
    denominator = float(np.dot(series, series))
    if denominator <= 0:
        return 0
    best, best_value = 0, .3
    for lag in range(2, len(series) // 2 + 1):
        value = float(np.dot(series[:-lag], series[lag:])) / denominator
        if value > best_value:
            best, best_value = lag, value
    return best


# --- forecasting methods: (history, horizon, season) -> (forecast[horizon], in-sample one-step fit) ---------------------

def _seasonal_naive(y: np.ndarray, h: int, m: int) -> np.ndarray:
    if m >= 2 and len(y) >= m:
        return np.array([y[len(y) - m + (i % m)] for i in range(h)], dtype=float)
    return np.full(h, y[-1], dtype=float)


def _linear_trend(y: np.ndarray, h: int, m: int) -> np.ndarray:
    t = np.arange(len(y), dtype=float)
    slope, intercept = np.polyfit(t, y, 1)
    future_t = np.arange(len(y), len(y) + h, dtype=float)
    forecast = intercept + slope * future_t
    if m >= 2 and len(y) >= 2 * m:
        residual = y - (intercept + slope * t)
        phase = np.array([residual[i::m].mean() for i in range(m)])
        forecast = forecast + np.array([phase[(len(y) + i) % m] for i in range(h)])
    return forecast


def _holt_winters(y: np.ndarray, h: int, m: int) -> np.ndarray:
    seasonal = m >= 2 and len(y) >= 2 * m
    best: tuple[float, np.ndarray] | None = None
    for alpha in (.1, .2, .4, .6, .8):
        for beta in (0., .05, .1, .2):
            for gamma in ((.05, .1, .3) if seasonal else (0.,)):
                for phi in (1., .9):
                    sse, forecast = _hw_run(y, h, m if seasonal else 0, alpha, beta, gamma, phi)
                    if best is None or sse < best[0]:
                        best = (sse, forecast)
    assert best is not None
    return best[1]


def _hw_run(y: np.ndarray, h: int, m: int, alpha: float, beta: float, gamma: float, phi: float) -> tuple[float, np.ndarray]:
    if m:
        level = y[:m].mean()
        trend = (y[m:2 * m].mean() - y[:m].mean()) / m
        season = list(y[:m] - level)
        start = m
    else:
        level, trend, season, start = y[0], y[1] - y[0], [], 1
    sse = 0.
    for i in range(start, len(y)):
        s = season[i - m] if m else 0.
        prediction = level + phi * trend + s
        sse += (y[i] - prediction) ** 2
        previous_level = level
        level = alpha * (y[i] - s) + (1 - alpha) * (level + phi * trend)
        trend = beta * (level - previous_level) + (1 - beta) * phi * trend
        if m:
            season.append(gamma * (y[i] - level) + (1 - gamma) * s)
    forecast, damp = [], 0.
    for k in range(1, h + 1):
        damp += phi ** k
        s = season[len(y) - m + ((k - 1) % m)] if m else 0.
        forecast.append(level + damp * trend + s)
    return sse, np.array(forecast, dtype=float)


def _lag_regression(y: np.ndarray, h: int, m: int) -> np.ndarray:
    from sklearn.linear_model import Ridge

    lags = sorted({1, 2, 3, *([m] if m >= 2 else [])})
    lags = [lag for lag in lags if lag < len(y) - 3] or [1]
    top = max(lags)
    rows = [[*(y[i - lag] for lag in lags), i] for i in range(top, len(y))]
    model = Ridge(alpha=1.0).fit(np.array(rows, dtype=float), y[top:])
    history = list(y)
    forecast = []
    for k in range(h):
        i = len(history)
        value = float(model.predict(np.array([[*(history[i - lag] for lag in lags), i]], dtype=float))[0])
        forecast.append(value)
        history.append(value)
    return np.array(forecast, dtype=float)


FORECASTERS: dict[str, Callable[[np.ndarray, int, int], np.ndarray]] = {
    "holt_winters": _holt_winters, "linear_trend": _linear_trend,
    "lag_regression": _lag_regression, "seasonal_naive": _seasonal_naive,
}


def _errors(actual: np.ndarray, predicted: np.ndarray) -> dict[str, float | None]:
    error = actual - predicted
    nonzero = np.abs(actual) > 1e-9
    return {
        "mae": float(np.mean(np.abs(error))), "rmse": float(math.sqrt(np.mean(error ** 2))),
        "mape": float(np.mean(np.abs(error[nonzero] / actual[nonzero])) * 100) if nonzero.all() else None,
    }


def _label(value: Any, kind: str, intraday: bool) -> Any:
    if kind == "date":
        stamp = pd.Timestamp(value)
        return stamp.strftime("%Y-%m-%d %H:%M") if intraday else stamp.strftime("%Y-%m-%d")
    if kind == "number":
        number = float(value)
        return int(number) if number.is_integer() else round(number, 6)
    return int(value)


def forecast_table(df: pd.DataFrame, config: dict[str, Any]) -> dict[str, Any]:
    from app.services.dataflow_nodes import json_value, preferred_column

    horizon = max(1, min(500, int(config.get("horizon") or 12)))
    method = str(config.get("method") or "auto")
    if method not in METHODS:
        method = "auto"
    confidence = min(.99, max(.5, float(config.get("confidence") or .9)))

    time_name = detect_time_column(df, config.get("time_column"))
    value_name = preferred_column(df, config.get("value_column"), numeric=True,
                                  exclude={time_name} if time_name else None, label="colonna da prevedere")
    values = pd.to_numeric(df[value_name], errors="coerce")
    if time_name:
        parsed = parse_time(df[time_name])
        if parsed is None:
            raise ValueError(f"La colonna «{time_name}» non contiene date o numeri leggibili come tempo")
        kind = "date" if pd.api.types.is_datetime64_any_dtype(parsed) else "number"
    else:
        parsed, kind = pd.Series(np.arange(1, len(df) + 1), index=df.index), "index"
    frame = pd.DataFrame({"t": parsed, "y": values}).dropna(subset=["t"])
    frame = frame.groupby("t", sort=True)["y"].mean().reset_index()  # duplicate instants → mean
    frame["y"] = frame["y"].interpolate(limit_direction="both")
    frame = frame.dropna(subset=["y"])
    if len(frame) < MIN_POINTS:
        raise ValueError(f"Servono almeno {MIN_POINTS} osservazioni per una previsione (trovate {len(frame)})")
    y = frame["y"].to_numpy(dtype=float)
    times = frame["t"]

    frequency, natural_season = _frequency(times) if kind == "date" else ("periodi", 0)
    requested_season = int(config.get("season_length") or 0)
    if requested_season == 1:
        season = 0
    elif requested_season >= 2:
        season = requested_season
    else:
        season = natural_season if natural_season and len(y) >= 2 * natural_season else _acf_season(y)
    if season and len(y) < 2 * season:
        season = 0

    holdout = min(horizon, max(2, len(y) // 5))
    if len(y) - holdout < max(4, 2 * season if season else 4):
        holdout = max(1, len(y) - max(4, 2 * season if season else 4))
    train, test = y[:-holdout], y[-holdout:]
    candidates = list(FORECASTERS) if method == "auto" else [method]
    scores: dict[str, dict[str, float | None]] = {}
    for name in candidates:
        try:
            scores[name] = _errors(test, FORECASTERS[name](train, holdout, season if len(train) >= 2 * season else 0))
        except (ValueError, np.linalg.LinAlgError, IndexError):
            continue
    if not scores:
        raise ValueError("Nessun metodo di previsione è applicabile a questa serie")
    chosen = min(scores, key=lambda name: scores[name]["mae"]) if method == "auto" else method
    forecast = FORECASTERS[chosen](y, horizon, season)
    naive = _errors(test, _seasonal_naive(train, holdout, 0))

    sigma = scores[chosen]["rmse"] or float(np.std(np.diff(y))) or 0.
    z = NormalDist().inv_cdf(.5 + confidence / 2)
    widths = np.array([z * sigma * math.sqrt(1 + i / max(1, holdout)) for i in range(horizon)])

    future = _future_times(times, horizon) if kind != "index" else list(range(len(y) + 1, len(y) + horizon + 1))
    intraday = kind == "date" and any(pd.Timestamp(item).time() != pd.Timestamp(0).time() for item in list(times) + future)
    time_col = time_name or "periodo"
    history_labels = [_label(item, kind, intraday) for item in times]
    future_labels = [_label(item, kind, intraday) for item in future]
    rows = [{time_col: label, value_name: float(value), "previsione": None, "minimo": None, "massimo": None, "tipo": "storico"}
            for label, value in zip(history_labels, y)]
    rows += [{time_col: label, value_name: None, "previsione": float(value), "minimo": float(value - width),
              "massimo": float(value + width), "tipo": "previsione"} for label, value, width in zip(future_labels, forecast, widths)]
    table = pd.DataFrame(rows, columns=[time_col, value_name, "previsione", "minimo", "massimo", "tipo"])

    metrics = {
        "method": chosen, "season_length": season, "frequency": frequency, "observations": len(y), "horizon": horizon,
        "backtest_points": holdout, **scores[chosen], "naive_mae": naive["mae"], "confidence": confidence,
        **({"candidates_mae": {name: score["mae"] for name, score in scores.items()}} if len(scores) > 1 else {}),
    }
    plot = {
        "kind": "line", "xType": kind, "x": history_labels + future_labels,
        "y": [float(value) for value in y] + [float(value) for value in forecast],
        "color": ["Storico"] * len(y) + ["Previsione"] * horizon,
        "lower": [None] * len(y) + [float(v - w) for v, w in zip(forecast, widths)],
        "upper": [None] * len(y) + [float(v + w) for v, w in zip(forecast, widths)],
        "labels": {"x": time_col, "y": value_name},
        "title": f"Previsione di {value_name} ({horizon} {frequency})",
    }
    return {"forecast": json_value(table), "metrics": json_value(metrics), "plot": json_value(plot)}
