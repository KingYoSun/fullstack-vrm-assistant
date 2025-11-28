from dataclasses import dataclass

import httpx

from app.core.providers import ProvidersConfig
from app.core.settings import AppSettings
from app.providers.registry import ProviderRegistry
from app.services.rag_service import RagService


@dataclass
class AppContainer:
    settings: AppSettings
    providers_config: ProvidersConfig
    http_client: httpx.AsyncClient
    providers: ProviderRegistry
    rag_service: RagService
