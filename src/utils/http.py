"""HTTP fetching with timeouts, exponential backoff and atomic file writes."""

from __future__ import annotations

import hashlib
import os
import random
import tempfile
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import requests

from src.utils.logger import get_logger

log = get_logger(__name__)

_TRUST_INJECTED = False


def _maybe_use_os_trust_store() -> None:
    """Use the OS certificate store when available (TLS-inspecting networks).

    On CI runners the default certifi bundle works, so truststore is optional.
    """
    global _TRUST_INJECTED
    if _TRUST_INJECTED or os.environ.get("BFIL_DISABLE_TRUSTSTORE"):
        return
    try:
        import truststore

        truststore.inject_into_ssl()
    except ImportError:
        pass
    _TRUST_INJECTED = True


@dataclass
class FetchResult:
    url: str
    content: bytes
    status: int
    fetched_at: str
    sha256: str
    last_modified: str | None
    attempts: int


class FetchError(RuntimeError):
    pass


def fetch(
    url: str,
    params: dict | None = None,
    timeout: float = 90,
    max_attempts: int = 5,
    backoff_base: float = 2.0,
    backoff_max: float = 60.0,
    user_agent: str = "brazil-fixed-income-lab",
) -> FetchResult:
    """GET with retry on network errors, 429 and 5xx (full-jitter backoff)."""
    _maybe_use_os_trust_store()
    last_exc: Exception | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            r = requests.get(url, params=params, timeout=timeout, headers={"User-Agent": user_agent})
            if r.status_code in (429, 500, 502, 503, 504):
                raise FetchError(f"HTTP {r.status_code}")
            r.raise_for_status()
            content = r.content
            return FetchResult(
                url=r.url,
                content=content,
                status=r.status_code,
                fetched_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
                sha256=hashlib.sha256(content).hexdigest(),
                last_modified=r.headers.get("Last-Modified"),
                attempts=attempt,
            )
        except (requests.RequestException, FetchError) as exc:
            last_exc = exc
            if isinstance(exc, requests.HTTPError) and exc.response is not None and exc.response.status_code < 500:
                break  # 4xx other than 429: do not retry
            if attempt < max_attempts:
                delay = random.uniform(0, min(backoff_max, backoff_base * 2 ** (attempt - 1)))
                log.warning("fetch_retry", extra={"url": url, "attempt": attempt, "delay_s": round(delay, 1), "error": str(exc)[:200]})
                time.sleep(delay)
    raise FetchError(f"Failed to fetch {url} after {max_attempts} attempts: {last_exc}")


def atomic_write_bytes(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()
