import json
from typing import AsyncIterator

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import (
    get_db_session,
    get_provider_registry,
    get_rag_service,
)
from app.providers.registry import ProviderRegistry
from app.repositories.system_prompts import SystemPromptRepository
from app.repositories.characters import CharacterRepository
from app.repositories.conversation_logs import ConversationLogRepository
from app.schemas.text_chat import TextChatRequest
from app.services.rag_service import RagService
from app.services.text_chat import TextChatService

router = APIRouter()


@router.post("/text-chat", response_class=StreamingResponse)
async def post_text_chat(
    body: TextChatRequest,
    providers: ProviderRegistry = Depends(get_provider_registry),
    rag_service: RagService = Depends(get_rag_service),
    session: AsyncSession = Depends(get_db_session),
) -> StreamingResponse:
    service = TextChatService(rag_service=rag_service, llm_client=providers.llm)
    repo = ConversationLogRepository(session)
    character_repo = CharacterRepository(session)
    system_prompt_repo = SystemPromptRepository(session)
    system_prompt_record = await system_prompt_repo.get_active() or await system_prompt_repo.get_latest()
    system_prompt_text = system_prompt_record.content if system_prompt_record else None
    character = None
    if body.character_id is not None:
        character = await character_repo.get(body.character_id)
        if character is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="character not found"
            )

    async def event_stream() -> AsyncIterator[bytes]:
        async for chunk in service.stream_text_chat(
            session_id=body.session_id,
            user_text=body.user_text,
            repo=repo,
            top_k=body.top_k,
            turn_id=body.turn_id,
            character=character,
            system_prompt=system_prompt_text,
        ):
            payload = json.dumps(chunk, ensure_ascii=False)
            yield f"data: {payload}\n\n".encode("utf-8")

    headers = {"X-Provider-Config": providers.config.llm.provider}
    return StreamingResponse(event_stream(), media_type="text/event-stream", headers=headers)
