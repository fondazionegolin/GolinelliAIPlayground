import pandas as pd
import pytest

from app.services.dataflow_nodes import execute_data_node

pytestmark = pytest.mark.asyncio


def table(data):
    df = pd.DataFrame(data)
    return {"columns": list(df.columns), "rows": df.to_dict(orient="records"), "rowCount": len(df)}


async def encode(data, **config):
    out = await execute_data_node("data.convert_to_number", {"table": table(data)}, config, {})
    return pd.DataFrame(out["table"]["rows"], columns=out["table"]["columns"]), out["report"]


async def test_auto_picks_right_encoding_per_column():
    n = 30
    data = {
        "livello": (["basso", "medio", "alto"] * 10),
        "fumatore": (["sì", "no"] * 15),
        "citta": (["Roma", "Milano", "Torino"] * 10),
        "eta": (["18-25", "26-35", "65+"] * 10),
        "prezzo": (["1.234,50 €", "99,9 €", "10 €"] * 10),
        "classe": (["3A", "3B", "4A"] * 10),
        "voto": list(range(n)),
    }
    df, report = await encode(data)
    assert list(df["livello"][:3]) == [0, 1, 2]                      # ordinal in the right order, not alphabetical
    assert list(df["fumatore"][:2]) == [1, 0]
    assert {"citta_roma", "citta_milano", "citta_torino"} <= set(df.columns) and "citta" not in df.columns
    assert list(df["eta"][:3]) == [21.5, 30.5, 65]
    assert list(df["prezzo"][:3]) == [1234.5, 99.9, 10]
    assert {"classe_3a", "classe_3b", "classe_4a"} <= set(df.columns)  # «3A»/«3B» are NOT collapsed into 3
    assert list(df["voto"]) == list(range(n))                          # numeric column untouched
    assert "min 0" in report["colonne"]["livello"] and "max 2" in report["colonne"]["livello"]


async def test_months_weekdays_and_scale_0_1():
    df, _ = await encode({"m": ["marzo", "gennaio", "dicembre", "gennaio"]})
    assert list(df["m"]) == [2, 0, 11, 0]
    df, _ = await encode({"q": ["scarso", "ottimo", "buono", "scarso"]}, scale="0-1")
    assert df["q"].min() == 0 and df["q"].max() == 1 and df["q"].iloc[1] == 1


async def test_override_order_and_strategies():
    df, rep = await encode({"t": ["piccola", "grande", "media"] * 4, "c": ["a", "b", "c", "d"] * 3},
                           overrides="t:ordinale:piccola|media|grande\nc:frequenza", columns="t,c")
    assert list(df["t"][:3]) == [0, 2, 1]
    assert df["c"].nunique() == 1 and abs(df["c"].iloc[0] - 0.25) < 1e-9
    with pytest.raises(ValueError, match="non contiene"):
        await encode({"t": ["x", "y"]}, overrides="t:ordinale:x")


async def test_high_cardinality_uses_target_mean_and_ids_are_kept():
    n = 40
    data = {"paese": [f"p{i % 15}" for i in range(n)], "y": [float(i % 15) for i in range(n)], "id": [f"u{i}" for i in range(n)]}
    df, rep = await encode(data, target_column="y")
    assert pd.api.types.is_numeric_dtype(df["paese"]) and df.loc[df["y"] == 3, "paese"].iloc[0] == 3
    assert df["id"].iloc[0] == "u0" and "identificativo" in rep["colonne"]["_avvisi"]


async def test_dates_and_binary():
    df, _ = await encode({"d": ["2024-01-01", "2024-01-11", "2024-01-31"], "g": ["F", "M", "F"]})
    assert list(df["d"]) == [0, 10, 30]
    assert set(df["g"]) == {0, 1}
