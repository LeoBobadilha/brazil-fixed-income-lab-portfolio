"""Source-state transitions (failure -> recovery) and freshness rules."""

from datetime import date

import pandas as pd
import pytest

from src.extract import download_data as D
from src.pipeline import _staleness
from src.utils.http import FetchError, FetchResult


def _ok(content=b"a;b\n1;2\n"):
    import hashlib

    return FetchResult(url="u", content=content, status=200, fetched_at="2026-11-05T12:00:00+00:00",
                       sha256=hashlib.sha256(content).hexdigest(), last_modified=None, attempts=1)


def test_failure_then_recovery_clears_error(tmp_path, monkeypatch):
    monkeypatch.setattr(D, "RAW_DIR", tmp_path)
    m = {"sources": {}}
    path = tmp_path / "x.csv"
    # 1) first success
    monkeypatch.setattr(D, "fetch", lambda *a, **k: _ok())
    assert D._download_file(m, "x", "https://example.org/x", path)
    assert m["sources"]["x"]["status"] == "ok" and "error" not in m["sources"]["x"]
    first_success = m["sources"]["x"]["last_success_at"]
    # 2) failure: previous file kept, marked stale, error recorded, last success preserved
    def boom(*a, **k):
        raise FetchError("HTTP 400")
    monkeypatch.setattr(D, "fetch", boom)
    assert not D._download_file(m, "x", "https://example.org/x", path)
    e = m["sources"]["x"]
    assert e["status"] == "stale" and "HTTP 400" in e["error"] and e["last_success_at"] == first_success and "failed_at" in e
    assert path.exists()
    # 3) recovery: error metadata cleared
    monkeypatch.setattr(D, "fetch", lambda *a, **k: _ok(b"a;b\n1;3\n"))
    assert D._download_file(m, "x", "https://example.org/x", path)
    e = m["sources"]["x"]
    assert e["status"] == "ok" and "error" not in e and "failed_at" not in e


def test_missing_source_without_cache_is_missing(tmp_path, monkeypatch):
    monkeypatch.setattr(D, "RAW_DIR", tmp_path)
    m = {"sources": {}}
    monkeypatch.setattr(D, "fetch", lambda *a, **k: (_ for _ in ()).throw(FetchError("timeout")))
    assert not D._download_file(m, "y", "https://example.org/y", tmp_path / "y.csv")
    assert m["sources"]["y"]["status"] == "missing"


@pytest.mark.parametrize("today,expected", [(date(2026, 11, 5), "current"), (date(2026, 11, 13), "stale")])
def test_quote_staleness_threshold(today, expected):
    manifest = {"sources": {"tesouro_direto_prices": {"status": "ok"}}}
    s = _staleness(pd.Timestamp("2026-10-30"), manifest, {"tesouro_direto_prices": "2026-10-30"}, today=today)
    assert s["status"] == expected
    assert s["freshness_thresholds"]["quotes_max_business_days"] == 4


def test_failed_source_makes_snapshot_stale_but_usable():
    manifest = {"sources": {"tesouro_direto_prices": {"status": "ok"}, "focus_annual": {"status": "stale", "error": "HTTP 400"}}}
    s = _staleness(pd.Timestamp("2026-10-30"), manifest, {"tesouro_direto_prices": "2026-10-30", "focus_annual": "2026-10-30"},
                   today=date(2026, 11, 3))
    assert s["status"] == "stale" and s["stale_sources"] == ["focus_annual"]
    assert "cached data used" in s["source_freshness"]["focus_annual"]["stale_reason"]


def test_monthly_source_cadence():
    manifest = {"sources": {"sgs.ipca_monthly": {"status": "ok"}}}
    ok = _staleness(pd.Timestamp("2026-10-30"), manifest, {"sgs.ipca_monthly": "2026-09-01"}, today=date(2026, 11, 3))
    late = _staleness(pd.Timestamp("2026-10-30"), manifest, {"sgs.ipca_monthly": "2026-07-01"}, today=date(2026, 11, 3))  # July ends 31 Jul: 95 days
    assert not ok["source_freshness"]["sgs.ipca_monthly"]["stale"]
    assert late["source_freshness"]["sgs.ipca_monthly"]["stale"]
