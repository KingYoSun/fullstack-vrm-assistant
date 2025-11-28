from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class AppSettings(BaseSettings):
    app_name: str = "VRM Assistant Backend"
    app_version: str = "0.1.0"
    providers_config_path: Path = Field(
        default=Path("config/providers.yaml"), env="PROVIDERS_CONFIG_PATH"
    )
    database_url: str = Field(
        default="postgresql+asyncpg://vrm:vrm_password@localhost:5432/vrm",
        env="DATABASE_URL",
    )
    rag_index_path: Path = Field(
        default=Path("/data/faiss/index.bin"), env="RAG_INDEX_PATH"
    )
    llm_api_key: str | None = Field(default=None, env="LLM_API_KEY")
    request_timeout_sec: float = Field(default=30.0, env="REQUEST_TIMEOUT_SEC")

    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )


@lru_cache
def get_settings() -> AppSettings:
    return AppSettings()
