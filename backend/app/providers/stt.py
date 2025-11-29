import json
import logging
from typing import Deque, Iterable

import httpx
import websockets

from app.core.providers import STTProviderConfig

logger = logging.getLogger(__name__)


class STTClient:
    """STT クライアント。HTTP/WS どちらでも呼び出し、失敗時はモック文字列にフォールバックする。"""

    def __init__(self, config: STTProviderConfig, http_client: httpx.AsyncClient):
        self.config = config
        self._http_client = http_client
        self.fallback_count = 0

    def build_partial(self, audio_chunks: Deque[bytes]) -> str:
        """受信中のチャンク数から簡易 partial transcript を生成する。"""
        if not audio_chunks or not self.config.enable_partial:
            return ""
        duration_ms = len(audio_chunks) * 20
        return f"[capturing ~{duration_ms}ms]"

    async def transcribe(self, audio_chunks: Iterable[bytes]) -> str:
        """チャンクをまとめて STT へ送信し、テキストを取得する。"""
        joined = b"".join(audio_chunks)
        if not joined:
            return ""

        if self.config.endpoint.startswith("ws"):
            text = await self._transcribe_ws(joined)
            if text:
                return text

        if self.config.endpoint.startswith("http"):
            text = await self._transcribe_http(joined)
            if text:
                return text

        return self._mock_transcript(len(joined))

    async def _transcribe_http(self, audio_bytes: bytes) -> str:
        try:
            params: dict[str, str] = {}
            if self.config.language:
                params["language"] = self.config.language
            if self.config.target_sample_rate:
                params["sample_rate"] = str(self.config.target_sample_rate)

            response = await self._http_client.post(
                self.config.endpoint,
                content=audio_bytes,
                params=params,
                headers={"Content-Type": "application/octet-stream"},
                timeout=self.config.timeout_sec,
            )
            response.raise_for_status()
            data = response.json()
            return str(data.get("text") or data.get("transcript") or "").strip()
        except Exception as exc:  # noqa: BLE001
            logger.warning("STT HTTP provider failed: %s", exc)
            return ""

    async def _transcribe_ws(self, audio_bytes: bytes) -> str:
        try:
            async with websockets.connect(self.config.endpoint, ping_interval=None) as ws:
                await ws.send(audio_bytes)
                async for message in ws:
                    text = self._extract_text(message)
                    if text:
                        return text
        except Exception as exc:  # noqa: BLE001
            logger.warning("STT WS provider failed: %s", exc)
            return ""
        return ""

    def _extract_text(self, message: str | bytes) -> str:
        if isinstance(message, bytes):
            try:
                message = message.decode("utf-8")
            except UnicodeDecodeError:
                return ""

        try:
            data = json.loads(message)
            text = data.get("text") or data.get("transcript")
            if text:
                return str(text).strip()
        except json.JSONDecodeError:
            pass

        return str(message).strip()

    def _mock_transcript(self, byte_length: int) -> str:
        self.fallback_count += 1
        logger.warning(
            "STT fallback transcript generated",
            extra={"fallback": True},
        )
        seconds = max(byte_length // 32000, 0)  # 16kHz * 2bytes ≈ 32kB/sec
        if seconds:
            return f"(mock) received ~{seconds}s of audio"
        return "(mock) received audio"
