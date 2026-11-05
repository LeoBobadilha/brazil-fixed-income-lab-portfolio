"""End-to-end pipeline: official sources -> validation -> DuckDB -> pricing -> web datasets.

    python -m src.pipeline              # download + rebuild + publish
    python -m src.pipeline --offline    # rebuild from the raw files already on disk

Publication is blocked when a blocking quality check fails; the previous
validated snapshot then stays online and ``reports/last_run.json`` records why.
"""

from __future__ import annotations

import argparse
import json
from datetime import date, datetime, timezone

import numpy as np
import pandas as pd

from src import calendar_br
from src.config import REPORTS_DIR, WEB_DATA_DIR, sources
from src.extract.download_data import download, load_manifest
from src.load.load_database import create_fact_cashflows, load_database
from src.pricing import reconcile as R
from src.publish.web_datasets import build_reconciliation, publish
from src.transform.transform_data import transform_data
from src.utils.http import atomic_write_bytes
from src.utils.logger import get_logger
from src.validate import quality

logger = get_logger(__name__)


def _previous_snapshot() -> dict | None:
    m = WEB_DATA_DIR / "manifest.json"
    if not m.exists():
        return None
    j = json.loads(m.read_text(encoding="utf-8"))
    return {"rows": j.get("counts", {}).get("quotes"), "max_date": j.get("data_as_of"), "snapshot_id": j.get("snapshot_id")}


def _staleness(asof: pd.Timestamp, manifest: dict, reference_dates: dict[str, str | None], today: date | None = None) -> dict:
    """Overall and per-source freshness, using the thresholds in config/sources.toml.

    A source is stale when its last fetch failed (cached data was used) or when its
    latest observation is older than its expected publication cadence.
    """
    cfg = sources()["freshness"]
    today = today or datetime.now().date()
    bdays = int(calendar_br.business_days(asof.date(), today))
    per_source = {}
    for key, entry in manifest.get("sources", {}).items():
        ref = reference_dates.get(key)
        stale_reason = None
        if entry.get("status") != "ok":
            stale_reason = f"last fetch failed ({entry.get('status')}); cached data used"
        elif ref:
            ref_d = date.fromisoformat(ref)
            freq = source_frequency(key)
            if freq == "daily" and calendar_br.business_days(ref_d, today) > (cfg["quotes_max_business_days"] if key == "tesouro_direto_prices" else cfg["daily_max_business_days"]):
                stale_reason = "latest observation older than the daily threshold"
            elif freq == "weekly" and (today - ref_d).days > cfg["weekly_max_calendar_days"]:
                stale_reason = "latest survey older than the weekly threshold"
            elif freq == "monthly" and (today - (pd.Timestamp(ref_d) + pd.offsets.MonthEnd(0)).date()).days > cfg["monthly_max_calendar_days"]:
                # monthly observations describe the whole month: age is measured from month-end
                stale_reason = "latest observation older than the monthly threshold"
        per_source[key] = {"reference_date": ref, "stale": stale_reason is not None, "stale_reason": stale_reason}
    failed = [k for k, v in manifest.get("sources", {}).items() if v.get("status") != "ok"]
    stale_sources = [k for k, v in per_source.items() if v["stale"]]
    status = "current" if bdays <= cfg["quotes_max_business_days"] and not stale_sources else "stale"
    return {"status": status, "business_days_since_data": bdays, "failed_sources": failed, "stale_sources": stale_sources,
            "source_freshness": per_source, "freshness_thresholds": dict(cfg)}


def source_frequency(key: str) -> str:
    if key == "tesouro_direto_prices":
        return "daily"
    if key == "focus_annual":
        return "weekly"
    if key.startswith("sgs."):
        return sources()["sgs"]["series"][key[4:]]["frequency"]
    return "monthly"


def reference_dates(t: dict[str, pd.DataFrame]) -> dict[str, str | None]:
    """Latest observation date of each source, from the normalised tables."""
    out: dict[str, str | None] = {"tesouro_direto_prices": str(t["quotes"]["base_date"].max().date())}
    for key, g in t["macro"].groupby("series"):
        out[f"sgs.{key}"] = str(g["date"].max().date())
    out["focus_annual"] = str(t["focus"]["survey_date"].max().date())
    out["ipca_index"] = str(t["ipca_index"]["month"].max().date())
    out["dpf_stock"] = str(t["dpf"]["month"].max().date())
    return out


def run_pipeline(offline: bool = False) -> dict:
    started = datetime.now(timezone.utc)
    logger.info("pipeline_start", extra={"offline": offline})
    raw_manifest = load_manifest() if offline else download()
    t = transform_data()
    previous = _previous_snapshot()

    checks = quality.check_quotes(t["quotes"], previous) + quality.check_macro(t["macro"], pd.Timestamp(datetime.now().date()))

    hist = R.price_history(t["quotes"], t["dim_security"])
    h, vna_daily = R.reconcile(hist, t["macro"], t["ipca_index"])
    summary = R.summarise(h, vna_daily)
    checks += quality.check_reconciliation(summary["by_product"])
    lft = R.lft_spread_precision(h)
    risk = R.risk_history(t["quotes"], t["dim_security"])

    q = t["quotes"].drop(columns=["product_name"])
    tables = {
        "dim_security": t["dim_security"],
        "fact_quotes": q,
        "fact_cashflows": create_fact_cashflows(t["dim_security"]),
        "fact_valuation": h,
        "fact_risk": risk,
        "vna_daily": vna_daily,
        "macro_series": t["macro"],
        "ipca_index": t["ipca_index"],
        "focus_expectations": t["focus"],
        "dpf_stock": t["dpf"],
        "quality_checks": pd.DataFrame(quality.as_records(checks)),
    }
    load_database(tables)

    blocking = quality.blocking_failures(checks)
    result = {"started_at": started.isoformat(timespec="seconds"), "checks": quality.as_records(checks),
              "blocking_failures": [c.name for c in blocking], "data_as_of": str(q["base_date"].max().date())}
    if blocking:
        result["published"] = False
        result["reason"] = "blocking quality checks failed; previous snapshot kept"
        logger.error("publish_blocked", extra={"failures": result["blocking_failures"]})
    else:
        recon = build_reconciliation(summary, h, vna_daily, lft)
        status = _staleness(q["base_date"].max(), raw_manifest, reference_dates(t))
        manifest = publish({**tables, "fact_quotes": t["quotes"]}, recon, quality.as_records(checks), raw_manifest, status)
        result.update({"published": True, "snapshot_id": manifest["snapshot_id"], "status": status,
                       "changed": previous is None or previous.get("snapshot_id") != manifest["snapshot_id"]})
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    atomic_write_bytes(REPORTS_DIR / "last_run.json", json.dumps(result, indent=2, default=str).encode("utf-8"))
    logger.info("pipeline_done", extra={"published": result["published"]})
    if blocking:
        raise SystemExit(2)
    return result


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--offline", action="store_true", help="use raw files already downloaded")
    args = ap.parse_args()
    run_pipeline(offline=args.offline)
