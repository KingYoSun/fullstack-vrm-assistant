from pydantic import BaseModel, Field


class SttDiagResponse(BaseModel):
    text: str
    byte_length: int
    provider: str
    endpoint: str
    fallback_used: bool


class LlmDiagRequest(BaseModel):
    prompt: str = Field(min_length=1)
    context: str | None = None
    character_id: int | None = Field(default=None, ge=1)


class LlmDiagResponse(BaseModel):
    assistant_text: str
    tokens: list[str]
    latency_ms: float
    provider: str
    endpoint: str
    fallback_used: bool


class TtsDiagRequest(BaseModel):
    text: str = Field(min_length=1)
    voice: str | None = None


class TtsDiagResponse(BaseModel):
    audio_base64: str
    mime_type: str
    byte_length: int
    chunk_count: int
    latency_ms: float
    provider: str
    endpoint: str
    sample_rate: int
    fallback_used: bool


class EmbeddingDiagRequest(BaseModel):
    text: str = Field(min_length=1)


class EmbeddingDiagResponse(BaseModel):
    vector: list[float]
    dimensions: int
    provider: str
    endpoint: str
    fallback_used: bool


class RagDiagRequest(BaseModel):
    query: str = Field(min_length=1)
    top_k: int | None = Field(default=None, ge=1, le=50)


class RagDocument(BaseModel):
    source: str
    content: str


class RagDiagResponse(BaseModel):
    query: str
    documents: list[RagDocument]
    context_text: str
    rag_index_loaded: bool
    top_k: int


class DbDiagResponse(BaseModel):
    status: str
    detail: str | None = None
    conversation_log_count: int | None = None
