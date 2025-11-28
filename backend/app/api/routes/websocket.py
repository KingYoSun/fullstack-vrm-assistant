from fastapi import APIRouter, Depends, WebSocket

from app.api.dependencies import get_provider_registry, get_rag_service
from app.providers.registry import ProviderRegistry
from app.services.rag_service import RagService
from app.services.ws_session import WebSocketSession

router = APIRouter()


@router.websocket("/ws/session/{session_id}")
async def websocket_session(
    websocket: WebSocket,
    session_id: str,
    providers: ProviderRegistry = Depends(get_provider_registry),
    rag_service: RagService = Depends(get_rag_service),
) -> None:
    session = WebSocketSession(
        session_id=session_id,
        websocket=websocket,
        providers=providers,
        rag_service=rag_service,
    )
    await session.run()
