from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field


class LLMProviderConfig(BaseModel):
    provider: str
    endpoint: str
    model: str
    temperature: float = 0.6
    max_tokens: int = 1024
    timeout_sec: int = 30
    stream: bool = True


class STTProviderConfig(BaseModel):
    provider: str
    endpoint: str
    language: str | None = None
    target_sample_rate: int | None = None
    enable_partial: bool = True
    vad: str | None = None


class TTSProviderConfig(BaseModel):
    provider: str
    endpoint: str
    default_voice: str | None = None
    language: str | None = None
    output_format: str | None = None
    sample_rate: int | None = None
    stream: bool = True


class RagConfig(BaseModel):
    provider: str
    index_path: str
    top_k: int = 5
    embedding_provider: str | None = None


class EmbeddingConfig(BaseModel):
    provider: str
    endpoint: str
    model: str
    batch_size: int = 16
    timeout_sec: int = Field(default=30, ge=1)


class ProvidersConfig(BaseModel):
    llm: LLMProviderConfig
    stt: STTProviderConfig
    tts: TTSProviderConfig
    rag: RagConfig
    embedding: EmbeddingConfig

    model_config = {"extra": "ignore"}


def load_providers_config(path: Path) -> ProvidersConfig:
    content = path.read_text(encoding="utf-8")
    data: dict[str, Any] = yaml.safe_load(content)
    return ProvidersConfig.model_validate(data)
