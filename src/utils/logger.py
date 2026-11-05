"""Structured (JSON lines) logging to logs/pipeline.jsonl plus readable console output."""

from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone

from src.config import LOG_DIR, LOG_FILE_PATH

_STD = set(vars(logging.LogRecord("", 0, "", 0, "", (), None)).keys()) | {"message", "asctime"}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": datetime.fromtimestamp(record.created, timezone.utc).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "event": record.getMessage(),
        }
        payload.update({k: v for k, v in vars(record).items() if k not in _STD})
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str, ensure_ascii=False)


class ConsoleFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        extras = {k: v for k, v in vars(record).items() if k not in _STD}
        tail = " ".join(f"{k}={v}" for k, v in extras.items())
        return f"{record.levelname:<7} {record.name}: {record.getMessage()} {tail}".rstrip()


def get_logger(name: str) -> logging.Logger:
    logger = logging.getLogger(name)
    if logger.handlers:
        return logger
    logger.setLevel(logging.INFO)
    logger.propagate = False
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    fh = logging.FileHandler(LOG_FILE_PATH, encoding="utf-8")
    fh.setFormatter(JsonFormatter())
    sh = logging.StreamHandler(sys.stderr)
    sh.setFormatter(ConsoleFormatter())
    logger.addHandler(fh)
    logger.addHandler(sh)
    return logger
