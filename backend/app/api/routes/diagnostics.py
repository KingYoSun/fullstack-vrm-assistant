import base64
import logging
import struct
import time
from collections.abc import AsyncIterable

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import func, select, text as sa_text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies import get_db_session, get_provider_registry, get_rag_service
from app.db.models import ConversationLog
from app.providers.llm import ChatMessage
from app.providers.registry import ProviderRegistry
from app.schemas.diagnostics import (
    DbDiagResponse,
    EmbeddingDiagRequest,
    EmbeddingDiagResponse,
    LlmDiagRequest,
    LlmDiagResponse,
    RagDiagRequest,
    RagDiagResponse,
    RagDocument,
    SttDiagResponse,
    TtsDiagRequest,
    TtsDiagResponse,
)
from app.services.rag_service import RagService

router = APIRouter()
logger = logging.getLogger(__name__)


def _detect_audio_mime(audio_bytes: bytes) -> str | None:
    if not audio_bytes:
        return None
    if audio_bytes.startswith(b"OggS"):
        return "audio/ogg"
    if audio_bytes.startswith(b"RIFF") and audio_bytes[8:12] == b"WAVE":
        return "audio/wav"
    if audio_bytes.startswith(b"\x1a\x45\xdf\xa3"):
        return "audio/webm"
    return None


def _pcm_to_wav(pcm_bytes: bytes, sample_rate: int) -> bytes:
    byte_rate = sample_rate * 2
    block_align = 2
    bits_per_sample = 16
    data_size = len(pcm_bytes)
    riff_size = 36 + data_size
    header = struct.pack(
        "<4sI4s4sIHHIIHH4sI",
        b"RIFF",
        riff_size,
        b"WAVE",
        b"fmt ",
        16,
        1,
        1,
        sample_rate,
        byte_rate,
        block_align,
        bits_per_sample,
        b"data",
        data_size,
    )
    return header + pcm_bytes


def _build_llm_messages(prompt: str, context: str | None) -> list[ChatMessage]:
    system_prompt = (
        "You are a helpful VRM voice assistant. "
        "Use the provided context when it is relevant. "
        "If the context is empty, respond concisely."
    )
    messages = [ChatMessage(role="system", content=system_prompt)]
    if context:
        messages.append(ChatMessage(role="system", content=f"Context:\n{context}"))
    messages.append(ChatMessage(role="user", content=prompt))
    return messages


@router.post("/diagnostics/stt", response_model=SttDiagResponse)
async def diagnose_stt(
    audio: UploadFile = File(...),
    providers: ProviderRegistry = Depends(get_provider_registry),
) -> SttDiagResponse:
    content = await audio.read()
    if not content:
        raise HTTPException(status_code=400, detail="audio is empty.")

    fallback_before = providers.stt.fallback_count
    try:
        transcript = await providers.stt.transcribe([content])
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"stt failed: {exc}") from exc

    fallback_used = providers.stt.fallback_count > fallback_before
    return SttDiagResponse(
        text=transcript,
        byte_length=len(content),
        provider=providers.config.stt.provider,
        endpoint=providers.config.stt.endpoint,
        fallback_used=fallback_used,
    )


@router.post("/diagnostics/llm", response_model=LlmDiagResponse)
async def diagnose_llm(
    body: LlmDiagRequest,
    providers: ProviderRegistry = Depends(get_provider_registry),
) -> LlmDiagResponse:
    prompt = body.prompt.strip()
    context = body.context.strip() if body.context else None
    if not prompt:
        raise HTTPException(status_code=400, detail="prompt is empty.")

    messages = _build_llm_messages(prompt, context)
    fallback_before = providers.llm.fallback_count
    tokens: list[str] = []
    start = time.monotonic()
    async for token in providers.llm.stream_chat(messages):
        tokens.append(token)
    latency_ms = (time.monotonic() - start) * 1000
    fallback_used = providers.llm.fallback_count > fallback_before

    return LlmDiagResponse(
        assistant_text="".join(tokens).strip(),
        tokens=tokens,
        latency_ms=round(latency_ms, 1),
        provider=providers.config.llm.provider,
        endpoint=providers.config.llm.endpoint,
        fallback_used=fallback_used,
    )


async def _collect_tts_chunks(stream: AsyncIterable[bytes]) -> list[bytes]:
    chunks: list[bytes] = []
    async for chunk in stream:
        if chunk:
            chunks.append(bytes(chunk))
    return chunks


@router.post("/diagnostics/tts", response_model=TtsDiagResponse)
async def diagnose_tts(
    body: TtsDiagRequest,
    providers: ProviderRegistry = Depends(get_provider_registry),
) -> TtsDiagResponse:
    text_input = body.text.strip()
    if not text_input:
        raise HTTPException(status_code=400, detail="text is empty.")

    fallback_before = providers.tts.fallback_count
    start = time.monotonic()
    try:
        chunks = await _collect_tts_chunks(providers.tts.stream_tts(text_input, voice=body.voice))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"tts failed: {exc}") from exc
    latency_ms = (time.monotonic() - start) * 1000
    if not chunks:
        raise HTTPException(status_code=502, detail="tts returned no audio.")

    audio_bytes = b"".join(chunks)
    mime_type = _detect_audio_mime(audio_bytes)
    if mime_type is None:
        audio_bytes = _pcm_to_wav(audio_bytes, providers.tts.sample_rate)
        mime_type = "audio/wav"

    audio_base64 = base64.b64encode(audio_bytes).decode("ascii")
    fallback_used = providers.tts.fallback_count > fallback_before
    return TtsDiagResponse(
        audio_base64=audio_base64,
        mime_type=mime_type,
        byte_length=len(audio_bytes),
        chunk_count=len(chunks),
        latency_ms=round(latency_ms, 1),
        provider=providers.config.tts.provider,
        endpoint=providers.config.tts.endpoint,
        sample_rate=providers.tts.sample_rate,
        fallback_used=fallback_used,
    )


@router.post("/diagnostics/embedding", response_model=EmbeddingDiagResponse)
async def diagnose_embedding(
    body: EmbeddingDiagRequest,
    providers: ProviderRegistry = Depends(get_provider_registry),
) -> EmbeddingDiagResponse:
    text_input = body.text.strip()
    if not text_input:
        raise HTTPException(status_code=400, detail="text is empty.")

    fallback_before = providers.embedding.fallback_count
    try:
        vectors = await providers.embedding.aembed([text_input])
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"embedding failed: {exc}") from exc
    if not vectors:
        raise HTTPException(status_code=502, detail="embedding provider returned empty vector.")

    vector = [float(value) for value in vectors[0]]
    fallback_used = providers.embedding.fallback_count > fallback_before
    return EmbeddingDiagResponse(
        vector=vector,
        dimensions=len(vector),
        provider=providers.config.embedding.provider,
        endpoint=providers.config.embedding.endpoint,
        fallback_used=fallback_used,
    )


@router.post("/diagnostics/rag", response_model=RagDiagResponse)
async def diagnose_rag(
    body: RagDiagRequest,
    rag_service: RagService = Depends(get_rag_service),
) -> RagDiagResponse:
    query = body.query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="query is empty.")

    try:
        docs = await rag_service.search(query, top_k=body.top_k)
    except Exception as exc:  # noqa: BLE001
        error_text = str(exc).strip()
        error_summary = f"{exc.__class__.__name__}: {error_text}" if error_text else exc.__class__.__name__
        logger.exception(
            "Diagnostics RAG search failed: query=%r top_k=%s is_loaded=%s index_path=%s",
            query,
            body.top_k,
            rag_service.is_loaded,
            getattr(rag_service, "_index_path", None),
        )
        raise HTTPException(status_code=500, detail=f"rag search failed: {error_summary}") from exc
    documents = [
        RagDocument(
            source=str(doc.metadata.get("source") or "unknown") if doc.metadata else "unknown",
            content=doc.page_content,
        )
        for doc in docs
    ]
    context_text = rag_service.context_as_text(docs)
    config_top_k = getattr(getattr(rag_service, "_config", None), "top_k", None)
    effective_top_k = body.top_k or config_top_k or len(documents)

    return RagDiagResponse(
        query=query,
        documents=documents,
        context_text=context_text,
        rag_index_loaded=rag_service.is_loaded,
        top_k=effective_top_k,
    )


@router.get("/diagnostics/db", response_model=DbDiagResponse)
async def diagnose_db(session: AsyncSession = Depends(get_db_session)) -> DbDiagResponse:
    try:
        await session.execute(sa_text("SELECT 1"))
        count = await session.scalar(select(func.count(ConversationLog.id)))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"db error: {exc}") from exc

    return DbDiagResponse(status="ok", conversation_log_count=int(count or 0))
