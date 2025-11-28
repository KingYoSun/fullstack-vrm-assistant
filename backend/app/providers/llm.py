import asyncio
import json
import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

import httpx

from app.core.providers import LLMProviderConfig

logger = logging.getLogger(__name__)


@dataclass
class ChatMessage:
    role: str
    content: str


class LLMClient:
    def __init__(
        self,
        config: LLMProviderConfig,
        http_client: httpx.AsyncClient,
        api_key: str | None = None,
    ):
        self.config = config
        self._http_client = http_client
        self._api_key = api_key

    async def stream_chat(self, messages: list[ChatMessage]) -> AsyncIterator[str]:
        if not messages:
            return

        try:
            if self.config.stream:
                async for token in self._stream_response(messages):
                    yield token
            else:
                text = await self._complete_once(messages)
                if text:
                    yield text
        except Exception as exc:
            logger.exception("LLM streaming failed: %s", exc)
            async for fallback in self._fallback_response(messages):
                yield fallback

    async def _stream_response(
        self, messages: list[ChatMessage]
    ) -> AsyncIterator[str]:
        url = self._build_url("chat/completions")
        payload = {
            "model": self.config.model,
            "messages": [msg.__dict__ for msg in messages],
            "temperature": self.config.temperature,
            "max_tokens": self.config.max_tokens,
            "stream": True,
        }
        headers = self._build_headers()

        async with self._http_client.stream(
            "POST", url, json=payload, headers=headers, timeout=self.config.timeout_sec
        ) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line:
                    continue
                chunk = line
                if chunk.startswith("data:"):
                    chunk = chunk[len("data:") :].strip()
                if chunk in ("[DONE]", ""):
                    break
                token = self._extract_content(chunk)
                if token:
                    yield token

    async def _complete_once(self, messages: list[ChatMessage]) -> str:
        url = self._build_url("chat/completions")
        payload = {
            "model": self.config.model,
            "messages": [msg.__dict__ for msg in messages],
            "temperature": self.config.temperature,
            "max_tokens": self.config.max_tokens,
            "stream": False,
        }
        headers = self._build_headers()
        response = await self._http_client.post(
            url, json=payload, headers=headers, timeout=self.config.timeout_sec
        )
        response.raise_for_status()
        data = response.json()
        return (
            data.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
            .strip()
        )

    def _build_headers(self) -> dict[str, str]:
        headers: dict[str, str] = {}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        return headers

    def _build_url(self, path: str) -> str:
        base = self.config.endpoint.rstrip("/")
        return f"{base}/{path.lstrip('/')}"

    def _extract_content(self, chunk: str) -> str:
        try:
            data = json.loads(chunk)
        except json.JSONDecodeError:
            logger.debug("LLM chunk is not JSON: %s", chunk)
            return chunk

        choices = data.get("choices") or []
        if not choices:
            return ""

        delta = choices[0].get("delta") or {}
        if "content" in delta:
            return str(delta["content"])

        message = choices[0].get("message") or {}
        return str(message.get("content") or "")

    async def _fallback_response(
        self, messages: list[ChatMessage]
    ) -> AsyncIterator[str]:
        user_text = next(
            (msg.content for msg in reversed(messages) if msg.role == "user"), ""
        )
        note = "LLM provider is unreachable. Returning a mock response."
        yield note
        await asyncio.sleep(0)
        if user_text:
            yield f"User said: {user_text}"
