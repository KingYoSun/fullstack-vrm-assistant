import json
import logging
import math
from pathlib import Path
from uuid import uuid4

import httpx

from app.core.providers import MotionProviderConfig
from app.schemas.motion import (
    MotionGenerateRequest,
    MotionGenerateResponse,
    MotionKeyframe,
    RootPosition,
)

logger = logging.getLogger(__name__)


class MotionClient:
    """Motion 生成クライアント。失敗時はローカルで簡易キーフレームを生成する。"""

    def __init__(
        self,
        config: MotionProviderConfig,
        http_client: httpx.AsyncClient,
        data_root: Path | None = None,
        data_mount_path: str = "/data",
    ):
        self.config = config
        self._http_client = http_client
        self._data_root = Path(data_root) if data_root else None
        self._data_mount_path = data_mount_path.rstrip("/") or "/data"
        self.fallback_count = 0

    async def generate(self, request: MotionGenerateRequest) -> MotionGenerateResponse:
        payload = self._build_payload(request)
        try:
            response = await self._http_client.post(
                self.config.endpoint.rstrip("/"),
                json=payload,
                timeout=self.config.timeout_sec,
            )
            response.raise_for_status()
            data = response.json()
            return self._parse_response(data)
        except Exception as exc:  # noqa: BLE001
            self.fallback_count += 1
            logger.warning("Motion provider failed, fallback motion generated: %s", exc, extra={"fallback": True})
            return self._fallback_response(request)

    def _build_payload(self, request: MotionGenerateRequest) -> dict[str, object]:
        payload = {
            "prompt": request.prompt,
            "seed": request.seed,
            "steps": request.steps,
            "guidance": request.guidance,
            "format": request.format or self.config.output_format,
            "duration_sec": request.duration_sec,
            "fps": request.fps,
        }
        return {key: value for key, value in payload.items() if value is not None}

    def _parse_response(self, data: dict[str, object]) -> MotionGenerateResponse:
        url = str(data.get("url") or data.get("output_url") or data.get("output_path") or "")
        output_path = str(data.get("output_path") or "")
        resolved_url = url or self._url_from_output_path(output_path)
        fallback_used = self._normalize_bool(data.get("fallback_used") or data.get("fallback"))
        merged = {
            "job_id": data.get("job_id") or uuid4().hex,
            "format": data.get("format") or self.config.output_format,
            "url": resolved_url,
            "output_path": output_path or resolved_url,
            "duration_sec": data.get("duration_sec") or data.get("duration") or 0.0,
            "fps": data.get("fps") or data.get("frame_rate") or 30,
            "tracks": data.get("tracks") or {},
            "rootPosition": data.get("rootPosition") or data.get("root_position") or None,
            "provider": self.config.provider,
            "endpoint": self.config.endpoint,
            "fallback_used": fallback_used,
            "metadata": data.get("metadata") or None,
        }
        return MotionGenerateResponse.model_validate(merged)

    def _url_from_output_path(self, output_path: str) -> str:
        if not output_path:
            return ""
        if "/data/" in output_path:
            suffix = output_path.split("/data/", 1)[1]
            return f"{self._data_mount_path}/{suffix}"
        return output_path

    @staticmethod
    def _normalize_bool(value: object) -> bool:
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            lowered = value.lower()
            if lowered in {"1", "true", "yes", "on"}:
                return True
            if lowered in {"0", "false", "no", "off"}:
                return False
        return False

    def _fallback_response(self, request: MotionGenerateRequest) -> MotionGenerateResponse:
        job_id = uuid4().hex
        duration = request.duration_sec or 3.0
        fps = request.fps or 24
        tracks = self._fallback_tracks(duration_sec=duration, fps=fps)
        root_positions = self._fallback_root_positions(duration_sec=duration, fps=fps)
        output_path = self._write_fallback_file(
            job_id=job_id,
            duration_sec=duration,
            fps=fps,
            tracks=tracks,
            root_positions=root_positions,
        )
        url = self._url_from_output_path(str(output_path))
        return MotionGenerateResponse(
            job_id=job_id,
            format=request.format or self.config.output_format,
            url=url or str(output_path),
            output_path=str(output_path),
            duration_sec=duration,
            fps=fps,
            tracks=tracks,
            root_position=root_positions,
            provider=self.config.provider,
            endpoint=self.config.endpoint,
            fallback_used=True,
            metadata={"generator": "fallback"},
        )

    def _fallback_tracks(self, duration_sec: float, fps: int) -> dict[str, list[MotionKeyframe]]:
        bones = ["hips", "spine", "leftUpperArm", "rightUpperArm"]
        keyframes: dict[str, list[MotionKeyframe]] = {}
        frame_count = max(1, int(duration_sec * fps))
        for index, bone in enumerate(bones):
            frames: list[MotionKeyframe] = []
            phase = index * 0.6
            amplitude = 0.2 if "Arm" in bone else 0.05
            for frame in range(frame_count + 1):
                t = frame / fps
                angle = amplitude * math.sin(t + phase)
                frames.append(MotionKeyframe(t=t, x=0.0, y=0.0, z=math.sin(angle / 2), w=math.cos(angle / 2)))
            keyframes[bone] = frames
        return keyframes

    def _fallback_root_positions(self, duration_sec: float, fps: int) -> list[RootPosition]:
        frame_count = max(1, int(duration_sec * fps))
        positions: list[RootPosition] = []
        for frame in range(frame_count + 1):
            t = frame / fps
            sway = 0.01 * math.sin(t)
            positions.append(RootPosition(t=t, x=sway, y=0.0, z=0.0))
        return positions

    def _write_fallback_file(
        self,
        job_id: str,
        duration_sec: float,
        fps: int,
        tracks: dict[str, list[MotionKeyframe]],
        root_positions: list[RootPosition],
    ) -> Path:
        if self._data_root:
            output_dir = self._data_root / "animations"
        else:
            output_dir = Path("/data/animations")
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / f"{job_id}.json"
        payload = MotionGenerateResponse(
            job_id=job_id,
            format=self.config.output_format,
            url=self._url_from_output_path(str(output_path)),
            output_path=str(output_path),
            duration_sec=duration_sec,
            fps=fps,
            tracks=tracks,
            root_position=root_positions,
            provider=self.config.provider,
            endpoint=self.config.endpoint,
            fallback_used=True,
            metadata={"generator": "fallback"},
        )
        output_path.write_text(json.dumps(payload.model_dump(by_alias=True), ensure_ascii=False, indent=2), encoding="utf-8")
        return output_path
