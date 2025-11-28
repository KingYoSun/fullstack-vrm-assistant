import asyncio
import logging
from typing import AsyncIterator

import httpx

from app.core.providers import TTSProviderConfig

logger = logging.getLogger(__name__)


class TTSClient:
    """TTS クライアント。HTTP ストリーミングを優先し、失敗時はサイレントチャンクを返す。"""

    def __init__(self, config: TTSProviderConfig, http_client: httpx.AsyncClient):
        self.config = config
        self._http_client = http_client

    @property
    def sample_rate(self) -> int:
        return self.config.sample_rate or 16000

    def metadata(self) -> dict[str, int]:
        return {
            "sample_rate": self.sample_rate,
            "channels": 1,
            "chunk_ms": self.config.chunk_ms,
        }

    async def stream_tts(
        self, text: str, voice: str | None = None
    ) -> AsyncIterator[bytes]:
        """テキストを音声に変換し、チャンク単位で返す。"""
        if not text.strip():
            return

        url = self.config.endpoint.rstrip("/")
        payload = {
            "text": text,
            "voice": voice or self.config.default_voice,
            "language": self.config.language,
            "output_format": self.config.output_format,
            "sample_rate": self.sample_rate,
            "stream": self.config.stream,
        }

        try:
            async with self._http_client.stream(
                "POST",
                url,
                json=payload,
                timeout=self.config.timeout_sec,
            ) as response:
                response.raise_for_status()
                async for chunk in response.aiter_bytes():
                    if chunk:
                        yield chunk
                return
        except Exception as exc:  # noqa: BLE001
            logger.warning("TTS provider failed, fallback to silent audio: %s", exc)

        async for chunk in self._fallback_stream(text):
            yield chunk

    async def _fallback_stream(self, text: str) -> AsyncIterator[bytes]:
        """実プロバイダ不在時の簡易サイレント音声を返す。"""
        frame_bytes = max(640, int(self.sample_rate * 2 * self.config.chunk_ms / 1000))
        chunk = b"\x00" * frame_bytes
        # 音声長はテキスト長に応じて伸ばすが、上限をかける。
        chunk_count = min(50, max(1, len(text) // 40))
        for _ in range(chunk_count):
            await asyncio.sleep(self.config.chunk_ms / 1000)
            yield chunk
