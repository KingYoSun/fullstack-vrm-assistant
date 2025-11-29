import logging
from typing import Any

import httpx

from app.core.providers import ProvidersConfig
from app.providers.embedding import EmbeddingClient
from app.providers.llm import LLMClient
from app.providers.stt import STTClient
from app.providers.tts import TTSClient

logger = logging.getLogger(__name__)


class ProviderRegistry:
    def __init__(
        self,
        http_client: httpx.AsyncClient,
        providers_config: ProvidersConfig,
        llm_api_key: str | None = None,
    ):
        self.config = providers_config
        self.llm = LLMClient(providers_config.llm, http_client, api_key=llm_api_key)
        self.embedding = EmbeddingClient(
            providers_config.embedding,
            http_client=http_client,
        )
        self.stt = STTClient(providers_config.stt, http_client=http_client)
        self.tts = TTSClient(providers_config.tts, http_client=http_client)

    def summary(self) -> dict[str, str]:
        return {
            "llm": self.config.llm.provider,
            "embedding": self.config.embedding.provider,
            "stt": self.config.stt.provider,
            "tts": self.config.tts.provider,
        }

    def status(self) -> dict[str, dict[str, Any]]:
        return {
            "llm": self._provider_status(
                provider=self.config.llm.provider,
                endpoint=self.config.llm.endpoint,
                fallback_count=self.llm.fallback_count,
            ),
            "embedding": self._provider_status(
                provider=self.config.embedding.provider,
                endpoint=self.config.embedding.endpoint,
                fallback_count=self.embedding.fallback_count,
            ),
            "stt": self._provider_status(
                provider=self.config.stt.provider,
                endpoint=self.config.stt.endpoint,
                fallback_count=self.stt.fallback_count,
            ),
            "tts": self._provider_status(
                provider=self.config.tts.provider,
                endpoint=self.config.tts.endpoint,
                fallback_count=self.tts.fallback_count,
            ),
        }

    def _provider_status(
        self, provider: str, endpoint: str, fallback_count: int
    ) -> dict[str, Any]:
        endpoint_lower = endpoint.lower()
        provider_lower = provider.lower()
        is_mock = "mock" in provider_lower or "echo-server" in endpoint_lower
        degraded = is_mock or fallback_count > 0
        return {
            "provider": provider,
            "endpoint": endpoint,
            "is_mock": is_mock,
            "fallback_count": fallback_count,
            "degraded": degraded,
        }
