import math
import random
from typing import Iterable

from motion_service.models import MotionKeyframe, RootPosition

DEFAULT_BONES: list[str] = [
    "hips",
    "spine",
    "chest",
    "leftUpperArm",
    "rightUpperArm",
    "leftLowerArm",
    "rightLowerArm",
]


def _quaternion_from_angle(angle: float, axis: str) -> MotionKeyframe:
    half = angle / 2
    w = math.cos(half)
    sin_half = math.sin(half)
    if axis == "x":
        return MotionKeyframe(t=0.0, x=sin_half, y=0.0, z=0.0, w=w)
    if axis == "y":
        return MotionKeyframe(t=0.0, x=0.0, y=sin_half, z=0.0, w=w)
    return MotionKeyframe(t=0.0, x=0.0, y=0.0, z=sin_half, w=w)


def _time_stamps(duration_sec: float, fps: int) -> Iterable[float]:
    frame_count = max(1, int(duration_sec * fps))
    for frame in range(frame_count + 1):
        yield round(frame / fps, 4)


def generate_placeholder_tracks(
    duration_sec: float, fps: int, seed: int | None = None
) -> tuple[dict[str, list[MotionKeyframe]], list[RootPosition]]:
    rng = random.Random(seed)
    tracks: dict[str, list[MotionKeyframe]] = {}
    root_positions: list[RootPosition] = []
    base_speed = rng.uniform(0.6, 1.1)
    # さらに大きく動かす（約35〜60度）ため振幅を拡大
    base_amp = rng.uniform(0.6, 1.05)

    for bone_index, bone in enumerate(DEFAULT_BONES):
        axis = "x" if "Arm" in bone else "y"
        phase = rng.uniform(0, math.pi * 2) + bone_index * 0.15
        amplitude = base_amp * (1.0 + 0.1 * rng.random())
        speed = base_speed * (1.0 + 0.05 * rng.random())
        keyframes: list[MotionKeyframe] = []
        for t in _time_stamps(duration_sec, fps):
            angle = amplitude * math.sin(speed * t + phase)
            quat = _quaternion_from_angle(angle, axis)
            quat.t = t
            keyframes.append(quat)
        tracks[bone] = keyframes

    for t in _time_stamps(duration_sec, fps):
        sway = base_amp * 0.4 * math.sin(base_speed * 0.5 * t + rng.uniform(0, math.pi))
        root_positions.append(RootPosition(t=t, x=sway, y=0.0, z=0.0))

    return tracks, root_positions
