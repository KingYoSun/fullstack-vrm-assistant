from __future__ import annotations

import math
import random
from dataclasses import dataclass
from difflib import SequenceMatcher
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

PROMPT_LIBRARY: list[str] = [
    "A person is practicing martial arts in slow motion.",
    "A person is walking like they’re stuck in molasses.",
    "A person is pretending to be a bird taking flight.",
    "A person is jumping like a frog.",
    "A person is walking confidently.",
    "A person is swinging a sword.",
    "A person is tiptoeing across a creaky floor.",
    "A person is dancing to hip hop music.",
    "A person is slipping on ice.",
    "A person is dodging punches in a fight.",
    "A person is sneaking through a dark alley.",
    "A person is performing a dramatic bow.",
    "A person is startled and jumps back.",
    "A person is celebrating with a joyful dance.",
    "A person walks like a robot.",
    "A person is pretending to swim on land.",
    "A person is trying to stay balanced on a narrow beam.",
    "A person is jumping rope.",
    "A person is saluting formally.",
    "A person is tiptoeing through a field of flowers.",
    "A person is cautiously balancing on slippery ice.",
    "A person is cautiously tiptoeing across a creaky wooden floor.",
    "A person is spinning in place like a figure skater.",
    "A person is stomping angrily while shaking their fist.",
    "A person is playfully chasing after a fluttering butterfly.",
    "A person is pretending to row a boat with slow, rhythmic strokes.",
    "A person is stretching their arms upward while yawning.",
    "A person is performing a lively salsa dance step.",
    "A person is walking backward with exaggerated caution.",
    "A person walks confidently on runway like a fashion model",
    "A person is walking proudly like a runway model.",
    "A person is wading through water, lifting knees high with each step.",
    "A person is reacting with surprise, stepping back quickly and raising their hands.",
    "A person is cautiously opening a creaky door, peeking inside.",
    "A person is leaning forward, trying to catch their breath after running.",
    "A person is joyfully jumping rope with energetic swings.",
    "A person is mimicking a slow, exaggerated zombie walk.",
    "A person is reaching out to catch a falling object with quick reflexes.",
    "A person is carefully balancing on one foot on a narrow beam.",
    "A person is stretching their arms up and yawning.",
    "A person is pretending to row a boat with energetic strokes.",
    "A person is confidently walking with hands on hips.",
    "A person is nervously checking their watch repeatedly.",
    "A person is pretending to row a small boat gently.",
    "A person is playfully sneaking behind someone.",
    "A person is stretching one leg forward in a warm-up pose.",
    "A person is excitedly spinning around with arms outstretched.",
]


@dataclass(frozen=True)
class StyleProfile:
    name: str
    freq: float
    swing: float
    sway: float
    twist: float
    bounce: float
    forward_speed: float
    root_sway: float
    arm_lift: float = 0.0
    vertical_amp: float = 0.0
    spin: float = 0.0
    crouch: float = 0.0
    lean: float = 0.0
    choppy: bool = False


STYLE_PRESETS: dict[str, StyleProfile] = {
    "freestyle": StyleProfile(
        name="freestyle",
        freq=1.4,
        swing=0.35,
        sway=0.2,
        twist=0.2,
        bounce=0.1,
        forward_speed=0.05,
        root_sway=0.02,
    ),
    "martial": StyleProfile(
        name="martial",
        freq=2.0,
        swing=0.55,
        sway=0.22,
        twist=0.35,
        bounce=0.16,
        forward_speed=0.25,
        root_sway=0.04,
        vertical_amp=0.08,
    ),
    "slow_walk": StyleProfile(
        name="slow_walk",
        freq=1.1,
        swing=0.35,
        sway=0.16,
        twist=0.18,
        bounce=0.07,
        forward_speed=0.22,
        root_sway=0.03,
    ),
    "walk_confident": StyleProfile(
        name="walk_confident",
        freq=1.6,
        swing=0.45,
        sway=0.18,
        twist=0.22,
        bounce=0.12,
        forward_speed=0.55,
        root_sway=0.05,
        vertical_amp=0.06,
    ),
    "walk_backward": StyleProfile(
        name="walk_backward",
        freq=1.3,
        swing=0.32,
        sway=0.14,
        twist=0.16,
        bounce=0.08,
        forward_speed=-0.28,
        root_sway=0.03,
    ),
    "flight": StyleProfile(
        name="flight",
        freq=1.7,
        swing=0.6,
        sway=0.2,
        twist=0.2,
        bounce=0.12,
        forward_speed=0.4,
        root_sway=0.04,
        arm_lift=0.45,
        vertical_amp=0.12,
    ),
    "hop": StyleProfile(
        name="hop",
        freq=1.5,
        swing=0.4,
        sway=0.16,
        twist=0.15,
        bounce=0.12,
        forward_speed=0.35,
        root_sway=0.04,
        vertical_amp=0.18,
    ),
    "slash": StyleProfile(
        name="slash",
        freq=1.8,
        swing=0.65,
        sway=0.2,
        twist=0.4,
        bounce=0.14,
        forward_speed=0.35,
        root_sway=0.03,
    ),
    "tiptoe": StyleProfile(
        name="tiptoe",
        freq=1.4,
        swing=0.28,
        sway=0.14,
        twist=0.17,
        bounce=0.08,
        forward_speed=0.25,
        root_sway=0.04,
        crouch=0.12,
    ),
    "dance": StyleProfile(
        name="dance",
        freq=2.3,
        swing=0.6,
        sway=0.35,
        twist=0.3,
        bounce=0.2,
        forward_speed=0.1,
        root_sway=0.08,
        vertical_amp=0.12,
    ),
    "stumble": StyleProfile(
        name="stumble",
        freq=1.6,
        swing=0.32,
        sway=0.28,
        twist=0.2,
        bounce=0.18,
        forward_speed=0.35,
        root_sway=0.07,
        vertical_amp=0.1,
    ),
    "dodge": StyleProfile(
        name="dodge",
        freq=2.1,
        swing=0.38,
        sway=0.32,
        twist=0.25,
        bounce=0.12,
        forward_speed=0.15,
        root_sway=0.09,
    ),
    "sneak": StyleProfile(
        name="sneak",
        freq=1.3,
        swing=0.25,
        sway=0.18,
        twist=0.17,
        bounce=0.05,
        forward_speed=0.25,
        root_sway=0.05,
        crouch=0.15,
    ),
    "bow": StyleProfile(
        name="bow",
        freq=1.0,
        swing=0.18,
        sway=0.1,
        twist=0.12,
        bounce=0.05,
        forward_speed=0.0,
        root_sway=0.01,
        lean=0.35,
    ),
    "recoil": StyleProfile(
        name="recoil",
        freq=1.4,
        swing=0.3,
        sway=0.24,
        twist=0.22,
        bounce=0.12,
        forward_speed=-0.05,
        root_sway=0.04,
        vertical_amp=0.08,
    ),
    "celebrate": StyleProfile(
        name="celebrate",
        freq=2.0,
        swing=0.65,
        sway=0.32,
        twist=0.28,
        bounce=0.2,
        forward_speed=0.12,
        root_sway=0.06,
        vertical_amp=0.14,
        arm_lift=0.25,
    ),
    "robot": StyleProfile(
        name="robot",
        freq=1.1,
        swing=0.25,
        sway=0.1,
        twist=0.05,
        bounce=0.04,
        forward_speed=0.2,
        root_sway=0.01,
        choppy=True,
    ),
    "swim": StyleProfile(
        name="swim",
        freq=1.7,
        swing=0.55,
        sway=0.15,
        twist=0.16,
        bounce=0.05,
        forward_speed=0.0,
        root_sway=0.02,
        arm_lift=0.3,
    ),
    "balance": StyleProfile(
        name="balance",
        freq=1.0,
        swing=0.18,
        sway=0.08,
        twist=0.08,
        bounce=0.04,
        forward_speed=0.0,
        root_sway=0.02,
        crouch=0.05,
    ),
    "jump_rope": StyleProfile(
        name="jump_rope",
        freq=2.6,
        swing=0.4,
        sway=0.2,
        twist=0.1,
        bounce=0.15,
        forward_speed=0.0,
        root_sway=0.03,
        vertical_amp=0.25,
        arm_lift=0.15,
    ),
    "salute": StyleProfile(
        name="salute",
        freq=1.2,
        swing=0.12,
        sway=0.1,
        twist=0.05,
        bounce=0.02,
        forward_speed=0.0,
        root_sway=0.01,
        arm_lift=0.45,
    ),
    "spin": StyleProfile(
        name="spin",
        freq=1.5,
        swing=0.4,
        sway=0.2,
        twist=0.15,
        bounce=0.1,
        forward_speed=0.1,
        root_sway=0.05,
        spin=0.6,
    ),
    "stomp": StyleProfile(
        name="stomp",
        freq=1.8,
        swing=0.38,
        sway=0.22,
        twist=0.2,
        bounce=0.18,
        forward_speed=0.2,
        root_sway=0.03,
        vertical_amp=0.14,
    ),
    "chase": StyleProfile(
        name="chase",
        freq=2.0,
        swing=0.5,
        sway=0.2,
        twist=0.25,
        bounce=0.14,
        forward_speed=0.7,
        root_sway=0.05,
        vertical_amp=0.1,
    ),
    "row": StyleProfile(
        name="row",
        freq=1.6,
        swing=0.55,
        sway=0.14,
        twist=0.12,
        bounce=0.06,
        forward_speed=0.0,
        root_sway=0.02,
        arm_lift=0.1,
    ),
    "stretch": StyleProfile(
        name="stretch",
        freq=1.0,
        swing=0.2,
        sway=0.08,
        twist=0.05,
        bounce=0.02,
        forward_speed=0.0,
        root_sway=0.0,
        arm_lift=0.5,
        lean=0.1,
    ),
    "wade": StyleProfile(
        name="wade",
        freq=1.2,
        swing=0.32,
        sway=0.15,
        twist=0.12,
        bounce=0.1,
        forward_speed=0.25,
        root_sway=0.03,
        vertical_amp=0.12,
    ),
    "breathe": StyleProfile(
        name="breathe",
        freq=0.9,
        swing=0.12,
        sway=0.05,
        twist=0.04,
        bounce=0.02,
        forward_speed=0.0,
        root_sway=0.0,
    ),
    "zombie": StyleProfile(
        name="zombie",
        freq=1.1,
        swing=0.18,
        sway=0.12,
        twist=0.1,
        bounce=0.06,
        forward_speed=0.25,
        root_sway=0.02,
        arm_lift=0.25,
        lean=0.1,
        choppy=True,
    ),
    "reach": StyleProfile(
        name="reach",
        freq=1.8,
        swing=0.35,
        sway=0.15,
        twist=0.2,
        bounce=0.1,
        forward_speed=0.15,
        root_sway=0.03,
        arm_lift=0.2,
        lean=0.15,
    ),
    "fidget": StyleProfile(
        name="fidget",
        freq=2.2,
        swing=0.15,
        sway=0.12,
        twist=0.1,
        bounce=0.04,
        forward_speed=0.05,
        root_sway=0.02,
    ),
}


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


def _quaternion_from_euler(rx: float, ry: float, rz: float) -> MotionKeyframe:
    cx, cy, cz = math.cos(rx / 2), math.cos(ry / 2), math.cos(rz / 2)
    sx, sy, sz = math.sin(rx / 2), math.sin(ry / 2), math.sin(rz / 2)
    return MotionKeyframe(
        t=0.0,
        x=sx * cy * cz - cx * sy * sz,
        y=cx * sy * cz + sx * cy * sz,
        z=cx * cy * sz - sx * sy * cz,
        w=cx * cy * cz + sx * sy * sz,
    )


def _score_prompt(user_prompt: str, candidate: str) -> float:
    if not user_prompt or not candidate:
        return 0.0
    user_norm = user_prompt.lower()
    cand_norm = candidate.lower()
    if cand_norm in user_norm:
        return 1.0
    return SequenceMatcher(None, user_norm, cand_norm).ratio()


def _infer_style_from_keywords(prompt: str) -> str | None:
    text = prompt.lower()
    rules: list[tuple[str, str]] = [
        ("martial", "martial"),
        ("molasses", "slow_walk"),
        ("bird", "flight"),
        ("flight", "flight"),
        ("frog", "hop"),
        ("confident", "walk_confident"),
        ("runway", "walk_confident"),
        ("model", "walk_confident"),
        ("swinging a sword", "slash"),
        ("sword", "slash"),
        ("tiptoe", "tiptoe"),
        ("dance", "dance"),
        ("hip hop", "dance"),
        ("slipping", "stumble"),
        ("ice", "stumble"),
        ("dodge", "dodge"),
        ("fight", "dodge"),
        ("sneak", "sneak"),
        ("bow", "bow"),
        ("startled", "recoil"),
        ("surprise", "recoil"),
        ("celebrat", "celebrate"),
        ("robot", "robot"),
        ("swim", "swim"),
        ("balanced", "balance"),
        ("balance", "balance"),
        ("jumping rope", "jump_rope"),
        ("jump rope", "jump_rope"),
        ("salut", "salute"),
        ("spin", "spin"),
        ("stomp", "stomp"),
        ("butterfly", "chase"),
        ("chasing", "chase"),
        ("row", "row"),
        ("stretch", "stretch"),
        ("wading", "wade"),
        ("water", "wade"),
        ("backward", "walk_backward"),
        ("door", "sneak"),
        ("breath", "breathe"),
        ("zombie", "zombie"),
        ("catch", "reach"),
        ("watch", "fidget"),
    ]
    for keyword, style in rules:
        if keyword in text:
            return style
    return None


def _match_prompt(user_prompt: str) -> tuple[str, str, float]:
    """Find the closest prompt from the internal prompt bank."""
    best_prompt = ""
    best_score = -1.0
    for candidate in PROMPT_LIBRARY:
        score = _score_prompt(user_prompt, candidate)
        if score > best_score:
            best_score = score
            best_prompt = candidate
    style_from_prompt = _infer_style_from_keywords(best_prompt) or "freestyle"
    return style_from_prompt, best_prompt, best_score


def _quantize(value: float, step: float = 0.1) -> float:
    if step <= 0:
        return value
    return round(value / step) * step


def _build_style(prompt: str, seed: int | None) -> tuple[StyleProfile, str, float]:
    explicit_style = _infer_style_from_keywords(prompt)
    style_name, matched_prompt, score = _match_prompt(prompt)
    style_key = explicit_style or style_name
    style = STYLE_PRESETS.get(style_key, STYLE_PRESETS["freestyle"])
    rng = random.Random(seed)
    jitter = 1.0 + rng.uniform(-0.08, 0.08)
    tuned_style = StyleProfile(
        name=style.name,
        freq=style.freq * jitter,
        swing=style.swing * jitter,
        sway=style.sway * jitter,
        twist=style.twist * jitter,
        bounce=style.bounce * jitter,
        forward_speed=style.forward_speed * jitter,
        root_sway=style.root_sway * (0.8 + rng.uniform(0, 0.4)),
        arm_lift=style.arm_lift,
        vertical_amp=style.vertical_amp * (0.9 + rng.uniform(0, 0.2)),
        spin=style.spin,
        crouch=style.crouch,
        lean=style.lean,
        choppy=style.choppy,
    )
    return tuned_style, matched_prompt, score


def _append_keyframe(
    tracks: dict[str, list[MotionKeyframe]],
    bone: str,
    t: float,
    rx: float,
    ry: float,
    rz: float,
    choppy: bool,
) -> None:
    if choppy:
        rx, ry, rz = _quantize(rx, 0.12), _quantize(ry, 0.12), _quantize(rz, 0.12)
    quat = _quaternion_from_euler(rx, ry, rz)
    quat.t = t
    tracks[bone].append(quat)


def generate_prompt_motion(
    prompt: str, duration_sec: float, fps: int, seed: int | None = None
) -> tuple[dict[str, list[MotionKeyframe]], list[RootPosition], dict[str, object]]:
    style, matched_prompt, score = _build_style(prompt, seed)
    rng = random.Random(seed)
    tracks: dict[str, list[MotionKeyframe]] = {bone: [] for bone in DEFAULT_BONES}
    root_positions: list[RootPosition] = []

    phase = rng.uniform(0, math.pi * 2)
    root_phase = rng.uniform(0, math.pi * 2)
    lean_bias = style.lean
    crouch_bias = style.crouch

    for t in _time_stamps(duration_sec, fps):
        freq = style.freq
        sway = style.sway * math.sin(freq * 0.5 * t + 0.3)
        twist = style.twist * math.sin(freq * 0.5 * t + 0.6)
        bounce = style.bounce * math.sin(freq * t + 0.1)
        spin = style.spin * t

        hip_pitch = bounce - crouch_bias
        hip_yaw = twist + spin
        hip_roll = style.root_sway * 0.5 * math.sin(freq * 0.5 * t + 1.2)
        _append_keyframe(tracks, "hips", t, hip_pitch, hip_yaw, hip_roll, style.choppy)

        spine_pitch = lean_bias * 0.4 + 0.4 * sway
        spine_yaw = twist * 0.5
        _append_keyframe(tracks, "spine", t, spine_pitch, spine_yaw, sway * 0.4, style.choppy)

        chest_pitch = lean_bias * 0.7 + 0.6 * sway
        chest_yaw = twist * 0.8 + spin * 0.2
        _append_keyframe(tracks, "chest", t, chest_pitch, chest_yaw, sway * 0.5, style.choppy)

        arm_swing = style.swing * math.sin(freq * t + phase)
        arm_twist = 0.35 * style.swing * math.sin(freq * 0.5 * t + phase * 0.5)
        lift = style.arm_lift

        _append_keyframe(
            tracks,
            "leftUpperArm",
            t,
            arm_swing + lift,
            arm_twist - 0.1 * lean_bias,
            0.25 * sway,
            style.choppy,
        )
        _append_keyframe(
            tracks,
            "rightUpperArm",
            t,
            -arm_swing + lift,
            -arm_twist - 0.1 * lean_bias,
            -0.25 * sway,
            style.choppy,
        )

        _append_keyframe(
            tracks,
            "leftLowerArm",
            t,
            0.65 * arm_swing + lift * 0.5,
            0.5 * arm_twist,
            0.2 * sway,
            style.choppy,
        )
        _append_keyframe(
            tracks,
            "rightLowerArm",
            t,
            -0.65 * arm_swing + lift * 0.5,
            -0.5 * arm_twist,
            -0.2 * sway,
            style.choppy,
        )

        forward = style.forward_speed * t + style.root_sway * math.sin(freq * 0.5 * t + root_phase)
        lateral = style.root_sway * 0.4 * math.sin(freq * 0.5 * t + root_phase + math.pi / 2)
        vertical = max(0.0, style.vertical_amp * abs(math.sin(freq * 0.5 * t))) + max(0.0, bounce * 0.25)
        root_positions.append(RootPosition(t=t, x=forward, y=vertical, z=lateral))

    metadata: dict[str, object] = {
        "generator": "prompt-library",
        "style": style.name,
        "matched_prompt": matched_prompt,
        "match_score": round(score, 3),
        "seed": seed,
    }
    return tracks, root_positions, metadata


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
