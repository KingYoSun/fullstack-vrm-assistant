from __future__ import annotations

import json
import logging
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from motion_service.config import MotionSettings
from motion_service.generator import generate_placeholder_tracks
from motion_service.models import MotionArtifact, MotionGenerateRequest

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

settings = MotionSettings()
app = FastAPI(title="SnapMoGen Motion Service", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def _prepare_dirs() -> None:
    settings.data_root.mkdir(parents=True, exist_ok=True)
    settings.output_dir.mkdir(parents=True, exist_ok=True)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


def _write_artifact(path: Path, artifact: MotionArtifact) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fp:
        json.dump(artifact.model_dump(by_alias=True), fp, ensure_ascii=False, indent=2)


def _build_artifact(payload: MotionGenerateRequest) -> MotionArtifact:
    job_id = uuid4().hex
    duration = payload.duration_sec or 5.0
    fps = payload.fps or 30
    tracks, root_positions = generate_placeholder_tracks(duration_sec=duration, fps=fps, seed=payload.seed)
    output_path = settings.resolve_output_path(job_id, extension="json")
    url = settings.build_public_url(output_path)
    artifact = MotionArtifact(
        job_id=job_id,
        format=payload.format or "vrm-json",
        output_path=str(output_path),
        url=url,
        duration_sec=duration,
        fps=fps,
        tracks=tracks,
        root_position=root_positions,
        metadata={"generator": "placeholder", "seed": payload.seed},
    )
    _write_artifact(output_path, artifact)
    return artifact


@app.post("/v1/motion/generate", response_model=MotionArtifact)
async def generate_motion(body: MotionGenerateRequest) -> MotionArtifact:
    prompt = body.prompt.strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="prompt is empty")
    artifact = _build_artifact(body)
    logger.info("motion generated: job_id=%s prompt=%s", artifact.job_id, prompt)
    return artifact


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "motion_service.main:app",
        host="0.0.0.0",
        port=settings.motion_port,
        reload=False,
    )
