from fastapi import Depends, Request

from app.core.container import AppContainer
from app.core.settings import AppSettings
from app.db.session import get_session
from app.providers.registry import ProviderRegistry
from app.services.rag_service import RagService


def get_container(request: Request) -> AppContainer:
    container: AppContainer | None = getattr(request.app.state, "container", None)
    if container is None:
        raise RuntimeError("Application container is not initialized.")
    return container


def get_provider_registry(container: AppContainer = Depends(get_container)) -> ProviderRegistry:
    return container.providers


def get_rag_service(container: AppContainer = Depends(get_container)) -> RagService:
    return container.rag_service


def get_app_settings(container: AppContainer = Depends(get_container)) -> AppSettings:
    return container.settings


# Re-export DB session dependency for routers
get_db_session = get_session
