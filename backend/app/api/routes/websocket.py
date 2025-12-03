from fastapi import APIRouter, Depends, WebSocket

from app.api.dependencies import get_provider_registry_ws, get_rag_service_ws
from app.core.logging import generate_request_id, reset_request_id, set_request_id
from app.providers.registry import ProviderRegistry
from app.services.rag_service import RagService
from app.services.ws_session import WebSocketSession

router = APIRouter()


@router.websocket("/ws/session/{session_id}")
async def websocket_session(
    websocket: WebSocket,
    session_id: str,
    providers: ProviderRegistry = Depends(get_provider_registry_ws),
    rag_service: RagService = Depends(get_rag_service_ws),
) -> None:
    request_id = websocket.headers.get("x-request-id") or generate_request_id()
    token = set_request_id(request_id)
    try:
        session = WebSocketSession(
            session_id=session_id,
            websocket=websocket,
            providers=providers,
            rag_service=rag_service,
            request_id=request_id,
        )
        await session.run()
    finally:
        reset_request_id(token)
