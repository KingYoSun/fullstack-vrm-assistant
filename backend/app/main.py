import logging
from contextlib import asynccontextmanager
from typing import Any

import httpx
from fastapi import Depends, FastAPI, Request
from sqlalchemy import text

from app.api import dependencies
from app.api.routes import text_chat, websocket
from app.core.logging import configure_logging, generate_request_id, reset_request_id, set_request_id
from app.core.container import AppContainer
from app.core.providers import load_providers_config
from app.core.settings import get_settings
from app.db import session as db_session
from app.db.session import init_db
from app.providers.registry import ProviderRegistry
from app.services.rag_service import RagService

configure_logging()
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
app.include_router(websocket.router)


@app.middleware("http")
async def add_request_id_context(request: Request, call_next):
    incoming = request.headers.get("X-Request-ID")
    request_id = incoming or generate_request_id()
    request.state.request_id = request_id
    token = set_request_id(request_id)
    try:
        response = await call_next(request)
    finally:
        reset_request_id(token)
    response.headers["X-Request-ID"] = request_id
    return response


@app.get("/health")
async def health(providers: ProviderRegistry = Depends(dependencies.get_provider_registry)):
    return {
        "app": settings.app_name,
        "version": settings.app_version,
        "providers": providers.summary(),
    }


@app.get("/ready")
async def ready(
    providers: ProviderRegistry = Depends(dependencies.get_provider_registry),
    rag_service: RagService = Depends(dependencies.get_rag_service),
) -> dict[str, Any]:
    db_status = "not_initialized"
    db_ok = False
    if db_session.engine is not None:
        try:
            async with db_session.engine.connect() as conn:
                await conn.execute(text("SELECT 1"))
            db_status = "ok"
            db_ok = True
        except Exception as exc:  # noqa: BLE001
            db_status = f"error: {exc}"

    rag_ready = rag_service.is_loaded
    status = "ok" if db_ok and rag_ready else "degraded"

    return {
        "status": status,
        "providers": providers.summary(),
        "database": db_status,
        "rag_index_loaded": rag_ready,
    }
