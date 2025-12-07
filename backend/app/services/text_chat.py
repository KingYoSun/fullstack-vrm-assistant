import logging
from collections.abc import AsyncIterator
import time
from uuid import uuid4

from fastapi import HTTPException, status

from app.db.models import CharacterProfile
from app.providers.llm import LLMClient
from app.repositories.conversation_logs import ConversationLogRepository
from app.services.rag_service import RagService
from app.services.prompt_builder import (
    MAX_ASSISTANT_CHARACTERS,
    build_chat_messages,
    clamp_response_length,
)

logger = logging.getLogger(__name__)


class TextChatService:
    def __init__(self, rag_service: RagService, llm_client: LLMClient):
        self._rag_service = rag_service
        self._llm_client = llm_client

    async def stream_text_chat(
        self,
        session_id: str,
        user_text: str,
        repo: ConversationLogRepository | None,
        top_k: int | None = None,
        turn_id: str | None = None,
        character: CharacterProfile | None = None,
        max_chars: int = MAX_ASSISTANT_CHARACTERS,
        system_prompt: str | None = None,
    ) -> AsyncIterator[dict]:
        if not user_text.strip():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail="user_text is empty."
            )

        rag_start = time.monotonic()
        docs = await self._rag_service.search(user_text, top_k=top_k)
        rag_latency_ms = (time.monotonic() - rag_start) * 1000
        context_text = self._rag_service.context_as_text(docs)
        turn_identifier = turn_id or uuid4().hex
        messages = build_chat_messages(user_text, context_text, character, system_prompt)

        yield {
            "event": "context",
            "data": {
                "session_id": session_id,
                "turn_id": turn_identifier,
                "document_count": len(docs),
            },
        }

        assistant_tokens: list[str] = []
        llm_start = time.monotonic()
        async for token in self._llm_client.stream_chat(messages):
            if not token:
                continue
            candidate = "".join(assistant_tokens) + token
            if len(candidate.strip()) > max_chars:
                break
            assistant_tokens.append(token)
            yield {
                "event": "token",
                "data": {
                    "session_id": session_id,
                    "turn_id": turn_identifier,
                    "token": token,
                },
            }

        assistant_text = clamp_response_length("".join(assistant_tokens))
        llm_latency_ms = (time.monotonic() - llm_start) * 1000
        if repo:
            await repo.create(
                session_id=session_id,
                turn_id=turn_identifier,
                user_text=user_text,
                assistant_text=assistant_text,
            )

        yield {
            "event": "done",
            "data": {
                "session_id": session_id,
                "turn_id": turn_identifier,
                "assistant_text": assistant_text,
                "used_context": context_text,
                "latency_ms": {
                    "rag": round(rag_latency_ms, 1),
                    "llm": round(llm_latency_ms, 1),
                },
            },
        }
        logger.info(
            "Text chat completed",
            extra={
                "session_id": session_id,
                "turn_id": turn_identifier,
                "latency_ms": {
                    "rag": round(rag_latency_ms, 1),
                    "llm": round(llm_latency_ms, 1),
                },
                "event": "text_chat_done",
            },
        )
