from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class MotionSettings(BaseSettings):
    motion_port: int = Field(default=7100, alias="MOTION_PORT")
    data_root: Path = Field(default=Path("/data"), alias="DATA_ROOT")
    output_dir: Path = Field(default=Path("/data/animations"), alias="OUTPUT_DIR")
    data_mount_path: str = Field(default="/data", alias="DATA_MOUNT_PATH")
    checkpoint_dir: Path = Field(default=Path("/checkpoint_dir"), alias="CHECKPOINT_DIR")

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    def resolve_output_path(self, job_id: str, extension: str = "json") -> Path:
        filename = f"{job_id}.{extension.lstrip('.')}"
        return self.output_dir / filename

    def build_public_url(self, output_path: Path) -> str:
        try:
            relative = output_path.relative_to(self.data_root)
        except ValueError:
            relative = output_path.name
        mount_base = self.data_mount_path.rstrip("/") or "/data"
        return f"{mount_base}/{relative}".replace("//", "/")
