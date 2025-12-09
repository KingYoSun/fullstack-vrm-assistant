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
    prompt: str = Field(min_length=1)
    seed: int | None = Field(default=None, ge=0)
    steps: int | None = Field(default=None, ge=1, le=200)
    guidance: float | None = Field(default=None, ge=0)
    format: str | None = Field(default=None)
    duration_sec: float | None = Field(default=None, ge=0.1)
    fps: int | None = Field(default=None, ge=1, le=120)


class MotionGenerateResponse(BaseModel):
    job_id: str
    format: str
    url: str
    output_path: str
    duration_sec: float
    fps: int
    tracks: dict[str, list[MotionKeyframe]]
    root_position: list[RootPosition] | None = Field(default=None, alias="rootPosition")
    provider: str
    endpoint: str
    fallback_used: bool = False

    model_config = ConfigDict(populate_by_name=True)
