from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class MotionKeyframe(BaseModel):
    t: float
    x: float
    y: float
    z: float
    w: float


class RootPosition(BaseModel):
    t: float
    x: float
    y: float
    z: float


class MotionGenerateRequest(BaseModel):
    prompt: str = Field(min_length=1, description="短いモーション記述。例: 腕を左右に振る。")
    seed: int | None = Field(default=None, ge=0, description="乱数シード")
    steps: int | None = Field(default=None, ge=1, le=200)
    guidance: float | None = Field(default=None, ge=0)
    format: str = Field(default="vrm-json", description="出力フォーマット")
    duration_sec: float | None = Field(default=None, ge=0.1)
    fps: int | None = Field(default=None, ge=1, le=120)


class MotionArtifact(BaseModel):
    job_id: str
    format: str
    output_path: str
    url: str | None = None
    duration_sec: float
    fps: int
    tracks: dict[str, list[MotionKeyframe]]
    root_position: list[RootPosition] | None = Field(default=None, alias="rootPosition")
    metadata: dict[str, Any] = Field(default_factory=dict)

    model_config = ConfigDict(populate_by_name=True)
