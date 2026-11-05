"""Export compact, public-safe JSON datasets for the static website.

All files are written to a temporary directory and swapped into
``web/public/data`` only after every file has been produced, so a partial
refresh is never published. Licence: derived from ODbL sources (Tesouro
Transparente, BCB) and IBGE public data; see DATA_LICENSE.md.
"""

from __future__ import annotations

import hashlib
import json
import math
import shutil
from datetime import date, datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from src.config import ASSUMPTIONS_DIR, WEB_DATA_DIR, sources
from src.pricing.instruments import PRODUCTS
from src.research import calendar_effects, curves
from src.utils.logger import get_logger

log = get_logger(__name__)
SCHEMA_VERSION = 1
EPOCH = pd.Timestamp("2000-01-01")


def _clean(o):
    if isinstance(o, dict):
        return {str(k): _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    if isinstance(o, (np.floating, float)):
        f = float(o)
        return None if math.isnan(f) or math.isinf(f) else f
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.bool_,)):
        return bool(o)
    if isinstance(o, (pd.Timestamp, datetime, date)):
        return str(o.date()) if isinstance(o, (pd.Timestamp, datetime)) else str(o)
    if o is pd.NaT:
        return None
    return o


def _r(x, nd):
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else round(float(x), nd)


def _write(path: Path, obj) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    data = json.dumps(_clean(obj), ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")
    path.write_bytes(data)
    return hashlib.sha256(data).hexdigest()


def _days(s: pd.Series) -> list[int]:
    return ((pd.to_datetime(s) - EPOCH).dt.days).astype(int).tolist()


def _int_or_none(a: np.ndarray, scale: float) -> list:
    return [None if (v is None or (isinstance(v, float) and math.isnan(v))) else int(round(v * scale)) for v in a]


# --------------------------------------------------------------------------- builders


PRODUCT_EN = {
    "LTN": "Tesouro Prefixado (zero-coupon)", "NTNF": "Tesouro Prefixado (semiannual coupons)", "LFT": "Tesouro Selic",
    "NTNBP": "Tesouro IPCA+ (zero-coupon)", "NTNB": "Tesouro IPCA+ (semiannual coupons)", "RENDA": "Tesouro Renda+",
    "EDUCA": "Tesouro Educa+", "NTNC": "Tesouro IGP-M+ (semiannual coupons)",
}


def english_name(code: str, year: int) -> str:
    base = PRODUCT_EN[code]
    if "(" in base:
        name, qual = base.split(" (")
        return f"{name} {year} ({qual}"
    return f"{base} {year}"


def build_securities(dim: pd.DataFrame) -> list[dict]:
    out = []
    for r in dim.itertuples(index=False):
        p = PRODUCTS[r.product_code]
        out.append({
            "id": r.security_id, "code": p.code, "name_pt": r.display_name,
            "name_en": english_name(p.code, r.commercial_year), "product_pt": p.official, "product_en": PRODUCT_EN[p.code],
            "instrument": p.instrument, "family": p.family, "indexer": p.indexer, "coupon": p.coupon,
            "modelled": bool(r.modelled), "maturity": r.maturity_date, "conversion": r.conversion_date,
            "year": int(r.commercial_year), "first": r.first_date, "last": r.last_date,
            "obs": int(r.observations), "active": bool(r.active),
        })
    return out


def _ref_date(dates: pd.DatetimeIndex, target: pd.Timestamp) -> pd.Timestamp | None:
    before = dates[dates <= target]
    return before.max() if len(before) else None


def build_latest(quotes: pd.DataFrame, risk: pd.DataFrame, vna_daily: pd.DataFrame, dim: pd.DataFrame) -> dict:
    dates = pd.DatetimeIndex(sorted(quotes["base_date"].unique()))
    d0 = dates.max()
    refs = {
        "1d": dates[-2] if len(dates) > 1 else None,
        "1w": _ref_date(dates, d0 - pd.Timedelta(days=7)),
        "1m": _ref_date(dates, d0 - pd.DateOffset(months=1)),
        "3m": _ref_date(dates, d0 - pd.DateOffset(months=3)),
        "1y": _ref_date(dates, d0 - pd.DateOffset(years=1)),
        "ytd": _ref_date(dates, pd.Timestamp(d0.year - 1, 12, 31)),
    }
    q = quotes.set_index(["security_id", "base_date"]).sort_index()
    rk = risk.set_index(["security_id", "base_date"]).sort_index()
    rows = []
    active = dim[dim["active"]]
    for s in active.itertuples(index=False):
        try:
            cur = q.loc[(s.security_id, d0)]
        except KeyError:
            continue
        hist = q.loc[s.security_id]["buy_rate"].dropna()
        ch = {}
        for k, rd in refs.items():
            if rd is not None and (s.security_id, rd) in q.index and pd.notna(q.loc[(s.security_id, rd), "buy_rate"]):
                ch[k] = _r((cur["buy_rate"] - q.loc[(s.security_id, rd), "buy_rate"]) * 100, 1)
            else:
                ch[k] = None
        pct = curves.percentile_of_last(hist)
        rec = {
            "id": s.security_id, "buy_rate": cur["buy_rate"], "sell_rate": cur["sell_rate"], "buy_price": cur["buy_price"],
            "sell_price": cur["sell_price"], "base_price": cur["base_price"],
            "spread_bp": _r((cur["sell_rate"] - cur["buy_rate"]) * 100, 1) if pd.notna(cur["sell_rate"]) and pd.notna(cur["buy_rate"]) else None,
            "change_bp": ch, "percentile": pct, "days_to_maturity": int((pd.Timestamp(s.maturity_date) - d0).days),
            "days_to_conversion": int((pd.Timestamp(s.conversion_date) - d0).days) if s.conversion_date else None,
            "hist_min": _r(hist.min(), 2), "hist_max": _r(hist.max(), 2), "hist_mean": _r(hist.mean(), 2),
            "buy_offered": bool(pd.notna(cur["buy_price"])),
        }
        if (s.security_id, d0) in rk.index:
            rr = rk.loc[(s.security_id, d0)]
            rec.update({"macaulay": _r(rr["macaulay"], 4), "modified": _r(rr["modified"], 4), "convexity": _r(rr["convexity"], 3),
                        "dv01_brl": _r(rr["dv01_brl"], 4), "years_to_last_flow": _r(rr["years_to_last_flow"], 4)})
        rows.append(rec)
    vd = vna_daily[(vna_daily["base_date"] == d0)]
    vna = {}
    for ix in ("ipca", "selic"):
        for side in ("base", "buy", "sell"):
            m = vd[(vd["indexer"] == ix) & (vd["side"] == side)]
            if len(m):
                vna.setdefault(ix, {})[side] = {"consensus": _r(m["vna_consensus"].iat[0], 6),
                                                 "independent": _r(m["vna_independent"].iat[0], 6),
                                                 "single_vna_consistent": bool(m["single_vna_consistent"].iat[0])}
    return {"date": d0, "reference_dates": refs, "rows": rows, "vna": vna}


def build_history(quotes: pd.DataFrame, risk: pd.DataFrame, out_dir: Path) -> dict[str, str]:
    m = quotes.merge(risk[["security_id", "base_date", "macaulay", "modified", "convexity", "dv01_brl"]],
                     on=["security_id", "base_date"], how="left")
    hashes = {}
    for sid, g in m.groupby("security_id"):
        g = g.sort_values("base_date")
        obj = {
            "id": sid, "epoch": "2000-01-01", "encoding": "d=days since epoch; rates in bp (1/100 %); prices in centavos; durations x1000",
            "d": _days(g["base_date"]), "br": _int_or_none(g["buy_rate"].values, 100), "sr": _int_or_none(g["sell_rate"].values, 100),
            "bp": _int_or_none(g["buy_price"].values, 100), "sp": _int_or_none(g["sell_price"].values, 100),
            "mac": _int_or_none(g["macaulay"].values, 1000), "mod": _int_or_none(g["modified"].values, 1000),
            "cvx": _int_or_none(g["convexity"].values, 10), "dv01": _int_or_none(g["dv01_brl"].values, 10000),
        }
        hashes[sid] = _write(out_dir / "history" / f"{sid}.json", obj)
    return hashes


def build_curves(quotes: pd.DataFrame, risk: pd.DataFrame) -> dict:
    m = quotes.merge(risk[["security_id", "base_date", "macaulay", "years_to_last_flow"]], on=["security_id", "base_date"], how="inner")
    dates = pd.DatetimeIndex(sorted(m["base_date"].unique()))
    month_end = pd.Series(dates).groupby(pd.Series(dates).dt.to_period("M")).max()
    last = dates.max()
    recent_daily = dates[dates >= last - pd.DateOffset(months=3)]
    weekly = pd.Series(dates[dates >= last - pd.DateOffset(years=2)])
    weekly = weekly.groupby(weekly.dt.to_period("W")).max()
    chosen = sorted(set(month_end) | set(recent_daily) | set(weekly))
    sub = m[m["base_date"].isin(chosen)].dropna(subset=["buy_rate"])
    out = {}
    for d, g in sub.groupby("base_date"):
        out[str(d.date())] = [[r.security_id, _r(r.years_to_last_flow, 3), _r(r.macaulay, 3), _r(r.buy_rate, 2)]
                              for r in g.itertuples(index=False)]
    return {"dates": list(out.keys()), "curves": out, "columns": ["id", "years_to_last_flow", "macaulay", "buy_rate"]}


def build_benchmarks(quotes: pd.DataFrame, risk: pd.DataFrame, macro: pd.DataFrame) -> tuple[dict, pd.DataFrame]:
    from src.validate.quality import isolated_spikes

    spikes = isolated_spikes(quotes)
    clean = quotes.merge(spikes[["security_id", "base_date"]].assign(_spike=True), on=["security_id", "base_date"], how="left")
    clean = clean[clean["_spike"].isna()]
    panel = clean[["security_id", "base_date", "product_code", "buy_rate"]].merge(
        risk[["security_id", "base_date", "macaulay"]], on=["security_id", "base_date"], how="inner")
    real = curves.constant_duration(panel, curves.REAL_CODES, curves.REAL_TENORS).set_index("date")
    nom = curves.constant_duration(panel, curves.NOMINAL_CODES, curves.NOMINAL_TENORS).set_index("date")
    b = real.add_prefix("real_").join(nom.add_prefix("nom_"), how="outer").sort_index()
    sel = macro[macro["series"] == "selic_target"].set_index("date")["value"].sort_index()
    b["selic_target"] = sel.reindex(b.index, method="ffill")
    for t in (2.0, 5.0):
        if f"nom_d{t:g}y" in b and f"real_d{t:g}y" in b:
            b[f"breakeven_{t:g}y"] = ((1 + b[f"nom_d{t:g}y"] / 100) / (1 + b[f"real_d{t:g}y"] / 100) - 1) * 100
    b["real_slope_20_2"] = (b["real_d20y"] - b["real_d2y"]) * 100
    b["nom_slope_5_1"] = (b["nom_d5y"] - b["nom_d1y"]) * 100
    b["real_vol_10y_bp"] = curves.rolling_vol_bp(b["real_d10y"])
    b["nom_vol_2y_bp"] = curves.rolling_vol_bp(b["nom_d2y"])
    cols = [c for c in b.columns if not c.endswith(("n_securities", "min_duration", "max_duration"))]
    obj = {"epoch": "2000-01-01", "d": _days(pd.Series(b.index)),
           "series": {c: [_r(v, 3) for v in b[c].values] for c in cols},
           "notes": {"construction": "Linear interpolation of purchase rates on Macaulay duration across same-family securities; no extrapolation.",
                     "breakeven": "Market-implied inflation compensation (Fisher relation at equal duration). Includes inflation risk and liquidity premia; not a forecast.",
                     "vol": "Annualised std. dev. of daily changes over 63 observations, in bp.",
                     "cleaning": f"{len(spikes)} isolated one-day reversals in single securities and securities with less than 3 months of duration are excluded from these statistics; official quotes are otherwise used as published.",
                     "gaps": "Gaps mean no security spanned that duration on the date (e.g. no real bond beyond 20 years before 2010)."}}
    return obj, b


def build_macro(macro: pd.DataFrame, focus: pd.DataFrame, manifest: dict) -> dict:
    cfg = sources()["sgs"]["series"]
    out = {"series": {}, "focus": {}}
    for key, spec in cfg.items():
        s = macro[macro["series"] == key].set_index("date")["value"].sort_index()
        if s.empty:
            continue
        if spec["frequency"] == "daily":
            me = s.groupby(s.index.to_period("M")).last()
            idx = [p.to_timestamp(how="end").normalize() for p in me.index]
            vals = me.values
            idx[-1] = s.index.max()
        else:
            idx, vals = list(s.index), s.values
        out["series"][key] = {"sgs_id": spec["id"], "title": spec["title"], "unit": spec["unit"], "frequency": spec["frequency"],
                              "reference_date": s.index.max(),
                              "dates": [str(pd.Timestamp(d).date()) for d in idx], "values": [_r(v, 4) for v in vals]}
    f = focus.copy()
    last_survey = f["survey_date"].max()
    latest = f[f["survey_date"] == last_survey]
    out["focus"]["survey_date"] = last_survey
    out["focus"]["latest"] = [{"indicator": r.indicator, "year": int(r.reference_year), "median": _r(r.median, 3),
                               "min": _r(r.min, 3), "max": _r(r.max, 3), "respondents": None if pd.isna(r.respondents) else int(r.respondents)}
                              for r in latest.sort_values(["indicator", "reference_year"]).itertuples(index=False)]
    # Monthly history of the 12-month-ahead calendar-year medians (next year)
    f["horizon"] = f["reference_year"].astype(int) - f["survey_date"].dt.year
    hist = {}
    for (ind, h), g in f[f["horizon"].isin([0, 1])].groupby(["indicator", "horizon"]):
        g = g.sort_values("survey_date")
        me = g.groupby(g["survey_date"].dt.to_period("M")).last()
        hist[f"{ind}_y{h}"] = {"dates": [str(d.date()) for d in me["survey_date"]], "median": [_r(v, 3) for v in me["median"]]}
    out["focus"]["history"] = hist
    out["focus"]["note"] = "Median of market forecasts for the calendar year (BCB Focus survey). Expectations, not outcomes."
    return out


def build_debt(dpf: pd.DataFrame) -> dict:
    d = dpf[dpf["portfolio"].str.strip().str.lower() == "mercado"].copy()
    comp = d.groupby(["month", "indexer"])["stock"].sum().unstack(fill_value=0) / 1e9
    total = comp.sum(axis=1)
    d["years"] = (d["maturity"] - d["month"]).dt.days / 365.25
    d = d[d["years"].notna()]
    wavg = d.groupby("month").apply(lambda g: np.average(g["years"].clip(lower=0), weights=g["stock"]), include_groups=False)
    lt12 = d.groupby("month").apply(lambda g: g.loc[g["years"] <= 1, "stock"].sum() / g["stock"].sum() * 100, include_groups=False)
    last_m = d["month"].max()
    lm = d[d["month"] == last_m]
    bins = [-0.01, 1, 2, 3, 5, 10, 200]
    labels = ["≤1y", "1–2y", "2–3y", "3–5y", "5–10y", ">10y"]
    prof = lm.groupby(pd.cut(lm["years"], bins, labels=labels), observed=False)["stock"].sum() / 1e9
    return {
        "months": [str(m.date()) for m in comp.index], "indexers": list(comp.columns),
        "stock_bn": {c: [_r(v, 2) for v in comp[c].values] for c in comp.columns},
        "total_bn": [_r(v, 2) for v in total.values],
        "avg_years_to_final_maturity": [_r(v, 3) for v in wavg.reindex(comp.index).values],
        "share_maturing_12m_pct": [_r(v, 2) for v in lt12.reindex(comp.index).values],
        "latest_month": last_m, "maturity_profile_bn": {k: _r(v, 2) for k, v in prof.items()},
        "notes": {
            "scope": "Federal public debt (DPF) held by the market ('Mercado' portfolio): domestic securities plus external debt; Banco Central portfolio excluded.",
            "maturity": "Stock-weighted time to FINAL maturity. Differs from the official average maturity (prazo medio), which weights all cash flows including coupons.",
            "indexer": "Classification by security type: LTN/NTN-F prefixado, LFT Selic, NTN-B family IPCA, NTN-C IGP-M, external debt as exchange-rate linked.",
        },
    }


def build_research(quotes: pd.DataFrame, bench: pd.DataFrame, dim: pd.DataFrame) -> dict:
    out = {"calendar": calendar_effects.run(quotes)}
    pct = {}
    for c in ["real_d2y", "real_d5y", "real_d10y", "real_d20y", "nom_d1y", "nom_d2y", "nom_d3y", "nom_d5y"]:
        if c in bench:
            pct[c] = {**curves.percentile_of_last(bench[c]), "last": _r(bench[c].dropna().iloc[-1], 3) if bench[c].notna().any() else None}
    out["percentiles"] = pct
    out["regimes"] = {"real_d10y": curves.regime_table(bench["real_d10y"], (4.0, 6.0)),
                      "nom_d2y": curves.regime_table(bench["nom_d2y"], (9.0, 13.0))}
    dd = []
    zero = dim[dim["product_code"].isin(["LTN", "NTNBP", "RENDA"])]
    q = quotes.set_index("security_id")
    for s in zero.itertuples(index=False):
        g = q.loc[[s.security_id]].set_index("base_date")["sell_price"].sort_index()
        if s.product_code == "RENDA" and s.conversion_date:
            g = g[g.index < pd.Timestamp(s.conversion_date)]
        r = curves.max_drawdown(g)
        if r:
            dd.append({"id": s.security_id, **r, "obs": int(g.notna().sum())})
    out["drawdowns"] = sorted(dd, key=lambda x: x["max_drawdown_pct"])
    # Daily change distribution by duration bucket
    chg = {}
    for c in ["real_d2y", "real_d5y", "real_d10y", "real_d20y", "nom_d1y", "nom_d3y", "nom_d5y"]:
        x = bench[c].diff().dropna() * 100
        if len(x) > 250:
            chg[c] = {"n": int(len(x)), "std_bp": _r(x.std(), 2), "p01_bp": _r(x.quantile(0.01), 1), "p99_bp": _r(x.quantile(0.99), 1),
                      "max_rise_bp": _r(x.max(), 1), "max_fall_bp": _r(x.min(), 1),
                      "hist": np.histogram(x.clip(-60, 60), bins=24, range=(-60, 60))[0].tolist()}
    out["daily_changes"] = chg
    # Steepening / flattening episodes of the real 20y-2y slope (monthly changes > 50 bp)
    sl = bench["real_slope_20_2"].dropna()
    mo = sl.groupby(sl.index.to_period("M")).last().diff()
    out["slope_episodes"] = {"threshold_bp": 50, "months": int(mo.notna().sum()),
                             "steepening": [str(p) for p in mo[mo > 50].index], "flattening": [str(p) for p in mo[mo < -50].index]}
    return out


VALIDATION_CATEGORIES = [
    {"id": "official_examples", "title": "Official worked examples",
     "what": "The engine reproduces Tesouro Nacional's and Tesouro Direto's published worked examples exactly (LTN, NTN-F, LFT, NTN-B, Renda+ and Educa+), including all 300 published business-day counts.",
     "independence": "Fully independent: expected values are transcribed from official documents and frozen in tests/fixtures."},
    {"id": "nominal_history", "title": "Fixed-rate history (independent prediction)",
     "what": "Every historical Tesouro Prefixado (LTN) and Prefixado-with-coupons (NTN-F) price is recomputed from the published rate alone.",
     "independence": "Independent: no input is taken from the price being checked; only the published rate and the calendar are used."},
    {"id": "implied_vna", "title": "IPCA-linked history (cross-sectional consistency)",
     "what": "For IPCA-linked bonds, Tesouro does not publish its daily projected VNA. On each date the VNA is inferred from that day's official prices and the test checks whether one VNA reproduces every IPCA-linked price to the cent.",
     "independence": "Not independent prediction: the VNA is fitted from the same prices. It verifies that the cash-flow and rounding engine is consistent across very different bond structures."},
    {"id": "independent_vna", "title": "Independent VNA reconstruction",
     "what": "A VNA built only from IBGE IPCA index numbers (or BCB Selic rates) is compared with the price-implied VNA.",
     "independence": "Independent inputs, but the IPCA projection for the current month uses the realised IPCA instead of the ANBIMA projection Tesouro uses, so differences of a few basis points are expected."},
    {"id": "limitations", "title": "Known discrepancies and limits",
     "what": "Tesouro Selic spreads are published with 2 decimals, which limits cent-level reconciliation after 2020; residual mismatches concentrate on a few dates and securities close to maturity; Tesouro IGPM+ has no second security for a VNA cross-check.",
     "independence": "Documented, not corrected by fitting."},
]


def build_vna_history(vna_daily: pd.DataFrame) -> dict:
    """Price-implied VNA by date (base side, settlement D+0) for scenarios on historical dates."""
    v = vna_daily[vna_daily["side"] == "base"].pivot_table(index="base_date", columns="indexer", values="vna_consensus")
    ok = vna_daily[vna_daily["side"] == "base"].pivot_table(index="base_date", columns="indexer", values="single_vna_consistent", aggfunc="max")
    v = v.sort_index()
    return {
        "epoch": "2000-01-01", "d": _days(pd.Series(v.index)),
        "ipca": [_r(x, 6) for x in v.get("ipca", pd.Series(index=v.index, dtype=float)).values],
        "selic": [_r(x, 6) for x in v.get("selic", pd.Series(index=v.index, dtype=float)).values],
        "ipca_consistent": [bool(x) if x == x else None for x in ok.reindex(v.index).get("ipca", pd.Series(index=v.index, dtype=float)).values],
        "note": "VNA inferred from each day's official prices (no future data). Used to initialise scenarios on historical dates.",
    }


def build_reconciliation(summary: dict, h: pd.DataFrame, vna_daily: pd.DataFrame, lft: pd.DataFrame) -> dict:
    bp = summary["by_product"].copy()
    lft = lft.assign(year=pd.DatetimeIndex(lft["base_date"]).year)
    lp = lft.groupby("year")["implied_minus_published_bp"].describe(percentiles=[0.01, 0.5, 0.99])
    # Deterministic order (ties broken by security, date, side) so the snapshot hash is
    # identical across platforms and unchanged data never produces a new commit.
    worst = (h.assign(_abs=h["price_error"].abs())
               .sort_values(["_abs", "security_id", "base_date", "side"], ascending=[False, True, True, True], kind="mergesort")
               .head(25))
    ind = summary["independent_vna_bp"]
    return {
        "by_product": bp.to_dict(orient="records"),
        "by_year": {k: {str(y): _r(v, 4) for y, v in row.items()} for k, row in summary["by_year"].iterrows()},
        "single_vna_consistent_by_year": {k: {str(y): _r(v, 4) for y, v in row.items()} for k, row in summary["single_vna"].iterrows()},
        "independent_vna_diff_bp": {k: {c: _r(v, 3) for c, v in row.items()} for k, row in ind.iterrows()},
        "lft_spread_precision_bp_by_year": {str(y): {c: _r(v, 3) for c, v in row.items()} for y, row in lp.iterrows()},
        "largest_errors": [{"id": r.security_id, "date": r.base_date, "side": r.side, "rate": r.rate, "official": r.official_price,
                            "model": r.model_price, "error": _r(r.price_error, 2)} for r in worst.itertuples(index=False)],
        "validation_categories": VALIDATION_CATEGORIES,
        "independent_nominal": {r["product_code"]: {"rows": r["rows"], "within_1c_pct": r["within_1c_pct"]} for r in bp.to_dict(orient="records") if r["product_code"] in ("LTN", "NTNF")},
        "conventions": {"buy_settlement": "D+1", "sell_settlement": "D+1 until 2021-09-10; D+0 from 2021-09-13",
                        "base_price_settlement": "D+0", "du_calendar": "national holidays in force on the pricing date",
                        "settlement_calendar": "national + inferred B3/Tesouro Direto non-settlement days"},
    }


# --------------------------------------------------------------------------- publish


def publish(tables: dict[str, pd.DataFrame], recon: dict, quality: list[dict], manifest_raw: dict, status: dict,
            out_dir: Path = WEB_DATA_DIR) -> dict:
    tmp = out_dir.parent / f".data-building-{datetime.now(timezone.utc):%Y%m%d%H%M%S}"
    if tmp.exists():
        shutil.rmtree(tmp)
    tmp.mkdir(parents=True)
    q, dim, risk = tables["fact_quotes"], tables["dim_security"], tables["fact_risk"]
    files = {}
    files["securities.json"] = _write(tmp / "securities.json", build_securities(dim))
    files["latest.json"] = _write(tmp / "latest.json", build_latest(q, risk, tables["vna_daily"], dim))
    files["curves.json"] = _write(tmp / "curves.json", build_curves(q, risk))
    bench_obj, bench = build_benchmarks(q, risk, tables["macro_series"])
    files["benchmarks.json"] = _write(tmp / "benchmarks.json", bench_obj)
    files["macro.json"] = _write(tmp / "macro.json", build_macro(tables["macro_series"], tables["focus_expectations"], manifest_raw))
    files["debt.json"] = _write(tmp / "debt.json", build_debt(tables["dpf_stock"]))
    files["research.json"] = _write(tmp / "research.json", build_research(q, bench, dim))
    files["reconciliation.json"] = _write(tmp / "reconciliation.json", recon)
    files["quality.json"] = _write(tmp / "quality.json", quality)
    files["assumptions.json"] = _write(tmp / "assumptions.json", json.loads((ASSUMPTIONS_DIR / "br_costs_taxes_v2026-11.json").read_text(encoding="utf-8")))
    files["vna_history.json"] = _write(tmp / "vna_history.json", build_vna_history(tables["vna_daily"]))
    hist_hashes = build_history(q, risk, tmp)
    content_id = hashlib.sha256(json.dumps([files, hist_hashes], sort_keys=True).encode()).hexdigest()[:16]
    src_meta = {}
    for k, v in manifest_raw.get("sources", {}).items():
        src_meta[k] = {key: v.get(key) for key in ("status", "last_success_at", "source_published_at", "url", "error", "failed_at") if v.get(key)}
    cfg = sources()
    licences = {k: {"publisher": v["publisher"], "licence": v["licence"], "landing": v["landing"]} for k, v in cfg["sources"].items()}
    licences["sgs"] = {"publisher": cfg["sgs"]["publisher"], "licence": cfg["sgs"]["licence"], "landing": cfg["sgs"]["landing"]}
    manifest = {
        "schema_version": SCHEMA_VERSION, "snapshot_id": content_id,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "data_as_of": q["base_date"].max(), **status, "sources": src_meta, "licences": licences,
        "counts": {"quotes": len(q), "securities": len(dim), "active_securities": int(dim["active"].sum())},
        "files": files, "history_files": len(hist_hashes),
    }
    _write(tmp / "manifest.json", manifest)
    # Atomic-ish directory swap (Windows cannot replace a non-empty directory)
    old = out_dir.parent / ".data-previous"
    if old.exists():
        shutil.rmtree(old)
    if out_dir.exists():
        out_dir.rename(old)
    tmp.rename(out_dir)
    if old.exists():
        shutil.rmtree(old)
    log.info("published", extra={"snapshot_id": content_id, "dir": str(out_dir)})
    return manifest
