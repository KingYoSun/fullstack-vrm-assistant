import logging

import httpx

from app.core.providers import ProvidersConfig
from app.providers.embedding import EmbeddingClient
from app.providers.llm import LLMClient

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

    def summary(self) -> dict[str, str]:
        return {
            "llm": self.config.llm.provider,
            "embedding": self.config.embedding.provider,
            "stt": self.config.stt.provider,
            "tts": self.config.tts.provider,
        }
