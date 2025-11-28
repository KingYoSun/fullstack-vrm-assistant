import logging
from contextlib import asynccontextmanager

import httpx
from fastapi import Depends, FastAPI

from app.api import dependencies
from app.api.routes import text_chat
from app.core.container import AppContainer
from app.core.providers import load_providers_config
from app.core.settings import get_settings
from app.db.session import init_db
from app.providers.registry import ProviderRegistry
from app.services.rag_service import RagService

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s | %(levelname)s | %(name)s | %(message)s"
)
logger = logging.getLogger(__name__)

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    providers_config = load_providers_config(settings.providers_config_path)
    http_client = httpx.AsyncClient(timeout=settings.request_timeout_sec)
    providers = ProviderRegistry(
        http_client=http_client,
        providers_config=providers_config,
        llm_api_key=settings.llm_api_key,
    )
    rag_service = RagService(
        rag_config=providers_config.rag,
        embedding_client=providers.embedding,
    )

    await init_db(settings.database_url)
    await rag_service.load()
    app.state.container = AppContainer(
        settings=settings,
        providers_config=providers_config,
        http_client=http_client,
        providers=providers,
        rag_service=rag_service,
    )

    try:
        yield
    finally:
        await http_client.aclose()


app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    lifespan=lifespan,
)
app.include_router(text_chat.router, prefix="/api/v1")


@app.get("/health")
async def health(providers: ProviderRegistry = Depends(dependencies.get_provider_registry)):
    return {
        "app": settings.app_name,
        "version": settings.app_version,
        "providers": providers.summary(),
    }
