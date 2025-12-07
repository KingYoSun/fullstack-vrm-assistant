from fastapi import APIRouter, Depends, WebSocket
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_db_session, get_provider_registry_ws, get_rag_service_ws
from app.core.logging import generate_request_id, reset_request_id, set_request_id
from app.providers.registry import ProviderRegistry
from app.repositories.characters import CharacterRepository
from app.repositories.system_prompts import SystemPromptRepository
from app.services.rag_service import RagService
from app.services.ws_session import WebSocketSession

router = APIRouter()


@router.websocket("/ws/session/{session_id}")
async def websocket_session(
    websocket: WebSocket,
    session_id: str,
    providers: ProviderRegistry = Depends(get_provider_registry_ws),
    rag_service: RagService = Depends(get_rag_service_ws),
    db_session: AsyncSession = Depends(get_db_session),
) -> None:
    request_id = websocket.headers.get("x-request-id") or generate_request_id()
    token = set_request_id(request_id)
    try:
        character = None
        raw_character_id = websocket.query_params.get("character_id")
        if raw_character_id:
            try:
                character_id = int(raw_character_id)
            except ValueError:
                await websocket.close(code=4400, reason="invalid character_id")
                return
            repo = CharacterRepository(db_session)
            character = await repo.get(character_id)
            if character is None:
                await websocket.close(code=4404, reason="character not found")
                return
        prompt_repo = SystemPromptRepository(db_session)
        system_prompt_record = await prompt_repo.get_active() or await prompt_repo.get_latest()
        system_prompt_text = system_prompt_record.content if system_prompt_record else None
        session = WebSocketSession(
            session_id=session_id,
            websocket=websocket,
            providers=providers,
            rag_service=rag_service,
            request_id=request_id,
            character=character,
            system_prompt=system_prompt_text,
        )
        await session.run()
    finally:
        reset_request_id(token)
