from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
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
    data_root: Path = Field(default=Path("/data"), env="DATA_ROOT")
    data_mount_path: str = Field(default="/data", env="DATA_MOUNT_PATH")
    rag_index_path: Path = Field(
        default=Path("/data/faiss/index.bin"), env="RAG_INDEX_PATH"
    )
    llm_api_key: str | None = Field(default=None, env="LLM_API_KEY")
    request_timeout_sec: float = Field(default=30.0, env="REQUEST_TIMEOUT_SEC")
    cors_allowed_origins: list[str] = Field(
        default_factory=lambda: ["*"], env="CORS_ALLOWED_ORIGINS"
    )

    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )

    @field_validator("cors_allowed_origins", mode="before")
    @classmethod
    def _parse_cors_origins(cls, value: list[str] | str | None) -> list[str]:
        if value is None:
            return ["*"]
        if isinstance(value, list):
            return value or ["*"]
        if isinstance(value, str):
            candidates = [origin.strip() for origin in value.split(",")]
            cleaned = [origin for origin in candidates if origin]
            return cleaned or ["*"]
        raise TypeError("cors_allowed_origins must be a list or comma separated string.")


@lru_cache
def get_settings() -> AppSettings:
    return AppSettings()
