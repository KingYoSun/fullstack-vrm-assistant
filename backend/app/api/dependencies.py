from fastapi import Depends, Request, WebSocket

from app.core.container import AppContainer
from app.core.settings import AppSettings
from app.db.session import get_session
from app.providers.registry import ProviderRegistry
from app.services.rag_service import RagService


def _get_container_from_app(app: object) -> AppContainer:
    container: AppContainer | None = getattr(app.state, "container", None)  # type: ignore[attr-defined]
    if container is None:
        raise RuntimeError("Application container is not initialized.")
    return container


def get_container(request: Request) -> AppContainer:
    return _get_container_from_app(request.app)


def get_container_ws(websocket: WebSocket) -> AppContainer:
    return _get_container_from_app(websocket.app)


def get_provider_registry(container: AppContainer = Depends(get_container)) -> ProviderRegistry:
    return container.providers


def get_provider_registry_ws(container: AppContainer = Depends(get_container_ws)) -> ProviderRegistry:
    return container.providers


def get_rag_service(container: AppContainer = Depends(get_container)) -> RagService:
    return container.rag_service


def get_rag_service_ws(container: AppContainer = Depends(get_container_ws)) -> RagService:
    return container.rag_service


def get_app_settings(container: AppContainer = Depends(get_container)) -> AppSettings:
    return container.settings


# Re-export DB session dependency for routers
get_db_session = get_session
