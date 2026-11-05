"""Extract raw data from official sources.

Each source is written atomically to ``data/raw/`` and recorded in
``data/raw/manifest.json`` (URL, SHA-256, size, fetch time, HTTP
Last-Modified, attempts, status). If a source fails, the previous raw file is
kept and the manifest marks the source as ``stale`` - downstream validation
decides whether the snapshot may still be published.

Legacy entry point ``download()`` is preserved (now downloads all sources).
"""

from __future__ import annotations

import hashlib
import json
from urllib.parse import quote
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pandas as pd

from src.config import RAW_DIR, RAW_FILE_PATH, sources
from src.utils.http import FetchError, atomic_write_bytes, fetch
from src.utils.logger import get_logger

log = get_logger(__name__)

MANIFEST = RAW_DIR / "manifest.json"
SGS_URL = "https://api.bcb.gov.br/dados/serie/bcdata.sgs.{id}/dados"
SGS_START = date(2000, 1, 1)
SGS_WINDOW_YEARS = 9  # API limits daily series to 10-year windows


def _http_kwargs() -> dict:
    d = sources()["defaults"]
    return dict(
        timeout=d["timeout_seconds"],
        max_attempts=d["max_attempts"],
        backoff_base=d["backoff_base_seconds"],
        backoff_max=d["backoff_max_seconds"],
        user_agent=d["user_agent"],
    )


def load_manifest() -> dict:
    if MANIFEST.exists():
        return json.loads(MANIFEST.read_text(encoding="utf-8"))
    return {"sources": {}}


def _save_manifest(m: dict) -> None:
    m["updated_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    atomic_write_bytes(MANIFEST, json.dumps(m, indent=2, ensure_ascii=False).encode("utf-8"))


def _record(m: dict, key: str, path: Path, status: str, **meta) -> None:
    """Update one source's state.

    A successful fetch clears any error left by an earlier failed attempt; a
    failed fetch keeps ``last_success_at`` so the age of the cached file stays
    visible.
    """
    entry = m["sources"].get(key, {})
    entry.update({"path": path.relative_to(RAW_DIR).as_posix(), "status": status, **meta})
    if status == "ok":
        entry["last_success_at"] = meta.get("fetched_at")
        entry.pop("error", None)
        entry.pop("failed_at", None)
    else:
        entry["failed_at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    m["sources"][key] = entry


def _download_file(m: dict, key: str, url: str, path: Path, params: dict | None = None) -> bool:
    try:
        res = fetch(url, params=params, **_http_kwargs())
    except FetchError as exc:
        log.error("source_failed", extra={"source": key, "error": str(exc)[:300], "kept_previous": path.exists()})
        _record(m, key, path, "stale" if path.exists() else "missing", error=str(exc)[:300])
        return False
    unchanged = m["sources"].get(key, {}).get("sha256") == res.sha256 and path.exists()
    if not unchanged:
        atomic_write_bytes(path, res.content)
    _record(
        m, key, path, "ok", url=url, sha256=res.sha256, bytes=len(res.content), fetched_at=res.fetched_at,
        http_last_modified=res.last_modified, attempts=res.attempts, changed=not unchanged,
    )
    log.info("source_ok", extra={"source": key, "bytes": len(res.content), "changed": not unchanged, "attempts": res.attempts})
    return True


def ckan_resource_modified(package: str) -> str | None:
    """Publication timestamp of the CSV resource reported by CKAN."""
    try:
        res = fetch("https://www.tesourotransparente.gov.br/ckan/api/3/action/package_show", params={"id": package}, **_http_kwargs())
        pkg = json.loads(res.content)["result"]
        for r in pkg["resources"]:
            if str(r.get("format", "")).upper() == "CSV":
                return r.get("last_modified") or r.get("created")
    except Exception as exc:  # metadata is informative only
        log.warning("ckan_metadata_failed", extra={"package": package, "error": str(exc)[:200]})
    return None


def extract_tesouro(m: dict) -> bool:
    cfg = sources()["sources"]["tesouro_direto_prices"]
    ok = _download_file(m, "tesouro_direto_prices", cfg["url"], RAW_FILE_PATH)
    m["sources"]["tesouro_direto_prices"]["source_published_at"] = ckan_resource_modified(cfg["ckan_package"])
    return ok


def extract_dpf(m: dict) -> bool:
    cfg = sources()["sources"]["dpf_stock"]
    ok = _download_file(m, "dpf_stock", cfg["url"], RAW_DIR / "dpf_stock.csv")
    m["sources"]["dpf_stock"]["source_published_at"] = ckan_resource_modified(cfg["ckan_package"])
    return ok


def extract_ipca_index(m: dict) -> bool:
    cfg = sources()["sources"]["ipca_index"]
    return _download_file(m, "ipca_index", cfg["url"], RAW_DIR / "ipca_index.json")


def _sgs_window(series_id: int, start: date, end: date) -> pd.DataFrame:
    res = fetch(
        SGS_URL.format(id=series_id),
        params={"formato": "json", "dataInicial": start.strftime("%d/%m/%Y"), "dataFinal": end.strftime("%d/%m/%Y")},
        **_http_kwargs(),
    )
    rows = json.loads(res.content) if res.content.strip() else []
    if isinstance(rows, dict):  # API error payload
        raise FetchError(f"SGS {series_id}: {rows}")
    df = pd.DataFrame(rows, columns=["data", "valor"])
    return df


def extract_sgs_series(m: dict, key: str, series_id: int, today: date | None = None) -> bool:
    """Incremental SGS download: re-fetch the last 60 days and merge."""
    today = today or date.today()
    path = RAW_DIR / "sgs" / f"{key}.csv"
    existing = pd.read_csv(path, dtype=str) if path.exists() else pd.DataFrame(columns=["data", "valor"])
    if len(existing):
        last = pd.to_datetime(existing["data"], format="%d/%m/%Y").max().date()
        start = max(SGS_START, last - timedelta(days=60))
    else:
        start = SGS_START
    frames = []
    try:
        cur = start
        while cur <= today:
            end = min(today, date(cur.year + SGS_WINDOW_YEARS, 12, 31))
            frames.append(_sgs_window(series_id, cur, end))
            cur = end + timedelta(days=1)
    except FetchError as exc:
        log.error("source_failed", extra={"source": f"sgs.{key}", "error": str(exc)[:300], "kept_previous": path.exists()})
        _record(m, f"sgs.{key}", path, "stale" if path.exists() else "missing", error=str(exc)[:300], sgs_id=series_id)
        return False
    new = pd.concat([existing, *frames], ignore_index=True).dropna()
    new = new.drop_duplicates(subset=["data"], keep="last")
    new = new.assign(_d=pd.to_datetime(new["data"], format="%d/%m/%Y")).sort_values("_d").drop(columns="_d")
    data = new.to_csv(index=False).encode("utf-8")
    atomic_write_bytes(path, data)


    _record(
        m, f"sgs.{key}", path, "ok", url=SGS_URL.format(id=series_id), sgs_id=series_id, rows=len(new),
        sha256=hashlib.sha256(data).hexdigest(), fetched_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
    )
    log.info("source_ok", extra={"source": f"sgs.{key}", "rows": len(new), "from": str(start)})
    return True


def extract_focus(m: dict) -> bool:
    """Focus annual expectations for IPCA and Selic since 2010 (incremental)."""
    cfg = sources()["sources"]["focus_annual"]
    path = RAW_DIR / "focus_annual.csv"
    existing = pd.read_csv(path, dtype=str) if path.exists() else None
    since = "2010-01-01"
    if existing is not None and len(existing):
        since = (pd.to_datetime(existing["Data"]).max() - pd.Timedelta(days=21)).strftime("%Y-%m-%d")
    # Olinda's OData parser rejects '+' for spaces, so the query string is
    # percent-encoded manually instead of via ``params``.
    flt = quote(f"(Indicador eq 'IPCA' or Indicador eq 'Selic') and Data ge '{since}' and baseCalculo eq 0")
    sel = "Indicador,Data,DataReferencia,Media,Mediana,DesvioPadrao,Minimo,Maximo,numeroRespondentes"
    pages, skip, page_size = [], 0, 20000
    try:
        while True:
            res = fetch(f"{cfg['url']}?$filter={flt}&$select={sel}&$format=json&$top={page_size}&$skip={skip}", **_http_kwargs())
            rows = json.loads(res.content)["value"]
            pages.extend(rows)
            if len(rows) < page_size:
                break
            skip += page_size
    except (FetchError, KeyError, ValueError) as exc:
        log.error("source_failed", extra={"source": "focus_annual", "error": str(exc)[:300]})
        _record(m, "focus_annual", path, "stale" if path.exists() else "missing", error=str(exc)[:300])
        return False
    new = pd.DataFrame(pages, columns=sel.split(",")).astype(str)
    allf = pd.concat([existing, new], ignore_index=True) if existing is not None else new
    allf = allf.drop_duplicates(subset=["Indicador", "Data", "DataReferencia"], keep="last").sort_values(["Data", "Indicador", "DataReferencia"])
    data = allf.to_csv(index=False).encode("utf-8")
    atomic_write_bytes(path, data)


    _record(m, "focus_annual", path, "ok", url=cfg["url"], rows=len(allf), sha256=hashlib.sha256(data).hexdigest(),
            fetched_at=res.fetched_at)
    log.info("source_ok", extra={"source": "focus_annual", "rows": len(allf), "since": since})
    return True


def download(only: list[str] | None = None) -> dict:
    """Download every configured source. Returns the updated manifest."""
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    m = load_manifest()
    want = set(only or ["tesouro", "sgs", "ipca", "focus", "dpf"])
    if "tesouro" in want:
        extract_tesouro(m)
        _save_manifest(m)
    if "sgs" in want:
        for key, spec in sources()["sgs"]["series"].items():
            extract_sgs_series(m, key, spec["id"])
            _save_manifest(m)
    if "ipca" in want:
        extract_ipca_index(m)
    if "focus" in want:
        extract_focus(m)
    if "dpf" in want:
        extract_dpf(m)
    _save_manifest(m)
    return m


if __name__ == "__main__":
    import sys

    download(sys.argv[1:] or None)
