import numpy as np
import pandas as pd
import pytest

from app.services.dataflow_forecast import detect_time_column, forecast_table, time_columns


def monthly_sales() -> pd.DataFrame:
    rng = np.random.default_rng(0)
    months = pd.date_range("2019-01-01", periods=60, freq="MS")
    values = 100 + np.arange(60) * 1.5 + 12 * np.sin(2 * np.pi * np.arange(60) / 12) + rng.normal(0, 2, 60)
    return pd.DataFrame({"mese": months.strftime("%Y-%m"), "vendite": values.round(2), "negozio": "Centro"})


def test_monthly_series_detects_time_season_and_continues_the_calendar():
    out = forecast_table(monthly_sales(), {"horizon": 12})
    metrics = out["metrics"]
    assert metrics["season_length"] == 12 and metrics["frequency"] == "mensili"
    assert metrics["mae"] < metrics["naive_mae"]
    future = [row for row in out["forecast"]["rows"] if row["tipo"] == "previsione"]
    assert len(future) == 12 and future[0]["mese"] == "2024-01-01" and future[-1]["mese"] == "2024-12-01"
    assert all(row["minimo"] <= row["previsione"] <= row["massimo"] for row in future)
    assert out["plot"]["kind"] == "line" and out["plot"]["xType"] == "date" and len(out["plot"]["x"]) == 72


def test_italian_day_first_dates_and_weekly_pattern():
    days = pd.date_range("2024-01-01", periods=70, freq="D")
    df = pd.DataFrame({"data": days.strftime("%d/%m/%Y"), "accessi": [70 if day.dayofweek >= 5 else 50 for day in days]})
    out = forecast_table(df, {"horizon": 7})
    future = [row for row in out["forecast"]["rows"] if row["tipo"] == "previsione"]
    assert future[0]["data"] == "2024-03-11" and out["metrics"]["season_length"] == 7
    assert [round(row["previsione"]) for row in future] == [50, 50, 50, 50, 50, 70, 70]


def test_year_column_and_row_order_fallback():
    years = pd.DataFrame({"anno": range(2010, 2024), "abitanti": [100 + 3 * i for i in range(14)]})
    rows = [row for row in forecast_table(years, {"horizon": 2})["forecast"]["rows"] if row["tipo"] == "previsione"]
    assert [row["anno"] for row in rows] == [2024, 2025] and rows[0]["previsione"] == pytest.approx(142, abs=.5)
    plain = pd.DataFrame({"valore": [float(i) for i in range(1, 11)]})
    assert forecast_table(plain, {"horizon": 1, "method": "linear_trend"})["forecast"]["rows"][-1]["periodo"] == 11


def test_month_names_duplicates_and_errors():
    df = pd.DataFrame({"Mese": ["gennaio 2023", "febbraio 2023", "marzo 2023", "marzo 2023", "aprile 2023", "maggio 2023", "giugno 2023", "luglio 2023"],
                       "temp": [3, 5, 8, 10, 13, 18, 23, 26]})
    assert detect_time_column(df) == "Mese"
    out = forecast_table(df, {"horizon": 2})
    assert out["metrics"]["observations"] == 7  # the two March rows are averaged
    with pytest.raises(ValueError, match="almeno 6"):
        forecast_table(df.head(4), {})


def test_time_columns_ignores_plain_numbers():
    assert time_columns(monthly_sales()) == ["mese"]
    assert time_columns(pd.DataFrame({"x": [1, 2], "nome": ["a", "b"]})) == []
