"""The scenario CSV exported by the website loads cleanly with pandas (fixture produced by web/src/pages/csv.test.ts)."""

from pathlib import Path

import pandas as pd

FIXTURE = Path(__file__).resolve().parents[1] / "web" / "src" / "engine" / "__fixtures__" / "scenario_export.csv"


def test_csv_loads_with_pandas():
    df = pd.read_csv(FIXTURE, dtype=str, keep_default_na=False)
    assert list(df.columns) == ["field", "value", "unit"]
    v = dict(zip(df["field"], df["value"]))
    assert v["security_id"] == "NTNBP-20350515"
    assert v["security_name"] == 'IPCA+ 2035, "zero-coupon"'  # quotes and comma survive the round trip
    assert v["reference_date"] == "2026-10-30" and pd.Timestamp(v["horizon_date"]).year == 2029
    assert float(v["net_value"]) > 0 and float(v["amount"]) == 10000
    units = dict(zip(df["field"], df["unit"]))
    assert units["buy_rate"] == "% p.a." and units["net_value"] == "BRL"
