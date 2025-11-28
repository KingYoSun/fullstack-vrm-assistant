from __future__ import annotations

import json
import logging
from contextvars import ContextVar, Token
from typing import Any
from uuid import uuid4

_request_id_ctx: ContextVar[str | None] = ContextVar("request_id", default=None)


class RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:  # pragma: no cover - logging glue
        if not hasattr(record, "request_id"):
            record.request_id = _request_id_ctx.get()
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:  # pragma: no cover - logging glue
        payload: dict[str, Any] = {
            "timestamp": self.formatTime(record, self.datefmt),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        request_id = getattr(record, "request_id", None) or _request_id_ctx.get()
        if request_id:
            payload["request_id"] = request_id

        for key in ("session_id", "turn_id", "event", "fallback"):
            value = getattr(record, key, None)
            if value is not None:
                payload[key] = value

        latency = getattr(record, "latency_ms", None)
        if latency is not None:
            payload["latency_ms"] = latency

        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)

        return json.dumps(payload, ensure_ascii=False)


def configure_logging(level: int = logging.INFO) -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JsonFormatter())
    handler.addFilter(RequestIdFilter())

    root = logging.getLogger()
    root.handlers.clear()
    root.setLevel(level)
    root.addHandler(handler)
    logging.captureWarnings(True)


def generate_request_id() -> str:
    return uuid4().hex


def set_request_id(request_id: str) -> Token[str | None]:
    return _request_id_ctx.set(request_id)


def reset_request_id(token: Token[str | None]) -> None:
    _request_id_ctx.reset(token)


def get_request_id() -> str | None:
    return _request_id_ctx.get()
