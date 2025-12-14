from __future__ import annotations

import logging
import os
import subprocess
import sys
import shutil
import contextlib
from uuid import uuid4
from pathlib import Path
from typing import Iterable

import numpy as np
import torch
from pydantic import BaseModel

from motion_service.config import MotionSettings
from motion_service.generator import generate_placeholder_tracks
from motion_service.models import MotionArtifact, MotionGenerateRequest, MotionKeyframe, RootPosition

logger = logging.getLogger(__name__)


class MDMUnavailable(Exception):
    """MDM 実行に必要なリソースが足りない場合に送出する。"""


class LoadedArgs(BaseModel):
    arch: str | None = None
    text_encoder_type: str | None = None
    diffusion_steps: int | None = None
    guidance_param: float | None = None
    motion_length: float | None = None
    num_frames: int | None = None
    fps: int | None = None


def _euler_deg_to_quat(euler_deg: np.ndarray) -> np.ndarray:
    """Z(roll), Y(pitch), X(yaw) の順でクォータニオンを返す。shape: [..., 3] -> [..., 4]."""
    # convert degrees to radians
    roll = np.deg2rad(euler_deg[..., 0])
    pitch = np.deg2rad(euler_deg[..., 1])
    yaw = np.deg2rad(euler_deg[..., 2])

    cr = np.cos(roll * 0.5)
    sr = np.sin(roll * 0.5)
    cp = np.cos(pitch * 0.5)
    sp = np.sin(pitch * 0.5)
    cy = np.cos(yaw * 0.5)
    sy = np.sin(yaw * 0.5)

    w = cy * cp * cr + sy * sp * sr
    x = cy * cp * sr - sy * sp * cr
    y = sy * cp * sr + cy * sp * cr
    z = sy * cp * cr - cy * sp * sr
    return np.stack([x, y, z, w], axis=-1)


def _to_tracks(
    joint_map: list[str], thetas: np.ndarray, fps: int
) -> tuple[dict[str, list[MotionKeyframe]], list[RootPosition]]:
    """motions2hik が返す joint_map/thetas を VRM トラックに整形する。"""
    tracks: dict[str, list[MotionKeyframe]] = {}
    root_positions: list[RootPosition] = []
    frame_count = thetas.shape[0]
    delta_t = 1.0 / float(fps)

    for frame_idx in range(frame_count):
        timestamp = frame_idx * delta_t
        frame_rot = thetas[frame_idx]  # [joints, 3] (deg)
        for joint_idx, joint_name in enumerate(joint_map):
            quat = _euler_deg_to_quat(frame_rot[joint_idx])
            tracks.setdefault(joint_name, []).append(
                MotionKeyframe(t=timestamp, x=float(quat[0]), y=float(quat[1]), z=float(quat[2]), w=float(quat[3]))
            )
        root_positions.append(RootPosition(t=timestamp, x=0.0, y=0.0, z=0.0))
    return tracks, root_positions


_T2M_JOINT_MAP: list[str] = [
    "Hips",
    "LeftUpLeg",
    "RightUpLeg",
    "Spine",
    "LeftLeg",
    "RightLeg",
    "Spine1",
    "LeftFoot",
    "RightFoot",
    "Spine2",
    "LeftToeBase",
    "RightToeBase",
    "Neck",
    "LeftShoulder",
    "RightShoulder",
    "Head",
    "LeftArm",
    "RightArm",
    "LeftForeArm",
    "RightForeArm",
    "LeftHand",
    "RightHand",
]

_T2M_PARENT: list[int] = [
    -1,  # Hips
    0,  # LeftUpLeg
    0,  # RightUpLeg
    0,  # Spine
    1,  # LeftLeg
    2,  # RightLeg
    3,  # Spine1
    4,  # LeftFoot
    5,  # RightFoot
    6,  # Spine2
    7,  # LeftToeBase
    8,  # RightToeBase
    9,  # Neck
    9,  # LeftShoulder
    9,  # RightShoulder
    12,  # Head
    13,  # LeftArm
    14,  # RightArm
    16,  # LeftForeArm
    17,  # RightForeArm
    18,  # LeftHand
    19,  # RightHand
]

_T2M_PRIMARY_CHILD: dict[int, int] = {
    0: 3,  # Hips -> Spine (root uses basis too)
    1: 4,  # LeftUpLeg -> LeftLeg
    2: 5,  # RightUpLeg -> RightLeg
    3: 6,  # Spine -> Spine1
    4: 7,  # LeftLeg -> LeftFoot
    5: 8,  # RightLeg -> RightFoot
    6: 9,  # Spine1 -> Spine2
    7: 10,  # LeftFoot -> LeftToeBase
    8: 11,  # RightFoot -> RightToeBase
    9: 12,  # Spine2 -> Neck
    12: 15,  # Neck -> Head
    13: 16,  # LeftShoulder -> LeftArm
    14: 17,  # RightShoulder -> RightArm
    16: 18,  # LeftArm -> LeftForeArm
    17: 19,  # RightArm -> RightForeArm
    18: 20,  # LeftForeArm -> LeftHand
    19: 21,  # RightForeArm -> RightHand
}

_T2M_RAW_OFFSETS = np.array(
    [
        [0.0, 0.0, 0.0],
        [1.0, 0.0, 0.0],
        [-1.0, 0.0, 0.0],
        [0.0, 1.0, 0.0],
        [0.0, -1.0, 0.0],
        [0.0, -1.0, 0.0],
        [0.0, 1.0, 0.0],
        [0.0, -1.0, 0.0],
        [0.0, -1.0, 0.0],
        [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
        [0.0, 0.0, 1.0],
        [0.0, 1.0, 0.0],
        [1.0, 0.0, 0.0],
        [-1.0, 0.0, 0.0],
        [0.0, 0.0, 1.0],
        [0.0, -1.0, 0.0],
        [0.0, -1.0, 0.0],
        [0.0, -1.0, 0.0],
        [0.0, -1.0, 0.0],
        [0.0, -1.0, 0.0],
        [0.0, -1.0, 0.0],
    ],
    dtype=np.float32,
)


def _normalize_vec(vec: np.ndarray, eps: float = 1e-8) -> np.ndarray:
    norm = float(np.linalg.norm(vec))
    if norm < eps:
        return vec
    return vec / norm


def _skew(vec: np.ndarray) -> np.ndarray:
    x, y, z = float(vec[0]), float(vec[1]), float(vec[2])
    return np.array(
        [
            [0.0, -z, y],
            [z, 0.0, -x],
            [-y, x, 0.0],
        ],
        dtype=np.float32,
    )


def _rotation_matrix_from_two_vectors(a: np.ndarray, b: np.ndarray, eps: float = 1e-8) -> np.ndarray:
    a_n = _normalize_vec(a, eps=eps)
    b_n = _normalize_vec(b, eps=eps)
    if float(np.linalg.norm(a_n)) < eps or float(np.linalg.norm(b_n)) < eps:
        return np.eye(3, dtype=np.float32)

    v = np.cross(a_n, b_n)
    c = float(np.dot(a_n, b_n))
    if c > 1.0 - eps:
        return np.eye(3, dtype=np.float32)
    if c < -1.0 + eps:
        axis = np.cross(a_n, np.array([1.0, 0.0, 0.0], dtype=np.float32))
        if float(np.linalg.norm(axis)) < eps:
            axis = np.cross(a_n, np.array([0.0, 1.0, 0.0], dtype=np.float32))
        axis = _normalize_vec(axis, eps=eps)
        return -np.eye(3, dtype=np.float32) + 2.0 * np.outer(axis, axis).astype(np.float32)

    v_x = _skew(v)
    s2 = float(np.dot(v, v))
    if s2 < eps:
        return np.eye(3, dtype=np.float32)
    r = np.eye(3, dtype=np.float32) + v_x + (v_x @ v_x) * ((1.0 - c) / s2)
    return r.astype(np.float32)


def _mat_to_quat(mat: np.ndarray) -> np.ndarray:
    r = mat.astype(np.float64, copy=False)
    trace = float(np.trace(r))
    if trace > 0.0:
        s = (trace + 1.0) ** 0.5 * 2.0
        w = 0.25 * s
        x = (r[2, 1] - r[1, 2]) / s
        y = (r[0, 2] - r[2, 0]) / s
        z = (r[1, 0] - r[0, 1]) / s
    else:
        if r[0, 0] > r[1, 1] and r[0, 0] > r[2, 2]:
            s = (1.0 + r[0, 0] - r[1, 1] - r[2, 2]) ** 0.5 * 2.0
            w = (r[2, 1] - r[1, 2]) / s
            x = 0.25 * s
            y = (r[0, 1] + r[1, 0]) / s
            z = (r[0, 2] + r[2, 0]) / s
        elif r[1, 1] > r[2, 2]:
            s = (1.0 + r[1, 1] - r[0, 0] - r[2, 2]) ** 0.5 * 2.0
            w = (r[0, 2] - r[2, 0]) / s
            x = (r[0, 1] + r[1, 0]) / s
            y = 0.25 * s
            z = (r[1, 2] + r[2, 1]) / s
        else:
            s = (1.0 + r[2, 2] - r[0, 0] - r[1, 1]) ** 0.5 * 2.0
            w = (r[1, 0] - r[0, 1]) / s
            x = (r[0, 2] + r[2, 0]) / s
            y = (r[1, 2] + r[2, 1]) / s
            z = 0.25 * s

    quat = np.array([x, y, z, w], dtype=np.float32)
    return _normalize_vec(quat, eps=1e-8)


def _xyz_motion_to_fast_tracks(
    motions: np.ndarray, fps: int
) -> tuple[dict[str, list[MotionKeyframe]], list[RootPosition]]:
    """results.npy の joint xyz から、SMPLify を使わずに簡易的な関節回転を推定して tracks を作る。"""
    if motions.ndim != 4 or motions.shape[1] != 22 or motions.shape[2] != 3:
        raise ValueError(f"unexpected motion shape: {motions.shape}")

    pose = motions[0].transpose(2, 0, 1).astype(np.float32, copy=False)  # [frames, joints, 3]
    frame_count = pose.shape[0]
    delta_t = 1.0 / float(fps)

    tracks: dict[str, list[MotionKeyframe]] = {name: [] for name in _T2M_JOINT_MAP}
    root_positions: list[RootPosition] = []

    prev_root_r = np.eye(3, dtype=np.float32)
    for frame_idx in range(frame_count):
        timestamp = frame_idx * delta_t
        pos = pose[frame_idx]

        hips = pos[0]
        root_positions.append(RootPosition(t=timestamp, x=float(hips[0]), y=float(hips[1]), z=float(hips[2])))

        right = pos[2] - pos[1]
        up = pos[3] - pos[0]
        if float(np.linalg.norm(right)) < 1e-6 or float(np.linalg.norm(up)) < 1e-6:
            root_r = prev_root_r
        else:
            x_axis = _normalize_vec(right)
            y_axis = _normalize_vec(up)
            z_axis = _normalize_vec(np.cross(x_axis, y_axis))
            if float(np.linalg.norm(z_axis)) < 1e-6:
                root_r = prev_root_r
            else:
                x_axis = _normalize_vec(np.cross(y_axis, z_axis))
                root_r = np.stack([x_axis, y_axis, z_axis], axis=1).astype(np.float32)
        prev_root_r = root_r

        global_r: list[np.ndarray] = [np.eye(3, dtype=np.float32) for _ in range(22)]
        local_r: list[np.ndarray] = [np.eye(3, dtype=np.float32) for _ in range(22)]
        global_r[0] = root_r
        local_r[0] = root_r

        for j in range(1, 22):
            p = _T2M_PARENT[j]
            parent_global = global_r[p]
            child = _T2M_PRIMARY_CHILD.get(j)
            if child is None:
                global_r[j] = parent_global
                continue
            v_world = pos[child] - pos[j]
            if float(np.linalg.norm(v_world)) < 1e-6:
                global_r[j] = parent_global
                continue
            target_parent = parent_global.T @ _normalize_vec(v_world)
            rest = _normalize_vec(_T2M_RAW_OFFSETS[child])
            r_local = _rotation_matrix_from_two_vectors(rest, target_parent)
            local_r[j] = r_local
            global_r[j] = parent_global @ r_local

        for j, name in enumerate(_T2M_JOINT_MAP):
            quat = _mat_to_quat(local_r[j])
            tracks[name].append(
                MotionKeyframe(t=timestamp, x=float(quat[0]), y=float(quat[1]), z=float(quat[2]), w=float(quat[3]))
            )

    return tracks, root_positions


class MDMAdapter:
    """MDM / DiP 推論を呼び出すアダプタ。現状は外部依存が揃わない場合にプレースホルダへフォールバックする。"""

    def __init__(self, settings: MotionSettings):
        self.settings = settings
        self.repo_dir = settings.mdm_repo_dir
        self.default_checkpoint = settings.mdm_default_checkpoint
        self.dip_checkpoint = settings.mdm_dip_checkpoint
        self.default_fps = settings.mdm_default_fps
        self.dip_fps = settings.mdm_dip_fps
        self._default_args = self._load_args(self.default_checkpoint)
        self._dip_args = self._load_args(self.dip_checkpoint)

    def _assert_available(self) -> None:
        if not self.repo_dir.exists():
            raise MDMUnavailable(f"MDM repo not found: {self.repo_dir}")
        if not self.default_checkpoint.exists():
            raise MDMUnavailable(f"MDM checkpoint not found: {self.default_checkpoint}")
        if not self.settings.data_root.exists():
            raise MDMUnavailable(f"data_root not found: {self.settings.data_root}")
        # HumanML3D/SMPL が存在するか軽く確認
        dataset_dir = self.settings.motion_data_dir / "dataset" / "HumanML3D"
        if not dataset_dir.exists():
            logger.warning("HumanML3D dataset not found at %s", dataset_dir)

    def _load_args(self, checkpoint: Path) -> LoadedArgs | None:
        args_path = checkpoint.parent / "args.json"
        if not args_path.exists():
            return None
        try:
            loaded = LoadedArgs.model_validate_json(args_path.read_text())
            return loaded
        except Exception:
            logger.warning("failed to parse args.json at %s", args_path)
            return None

    def _ensure_dataset_symlink(self) -> None:
        """MDM リポジトリ内の dataset/HumanML3D をホストの data/motion/dataset/HumanML3D にシンボリックリンクする。"""
        target_root = self.settings.motion_data_dir / "dataset"
        humanml_target = target_root / "HumanML3D"
        repo_dataset = self.repo_dir / "dataset"
        repo_dataset.mkdir(exist_ok=True)
        humanml_link = repo_dataset / "HumanML3D"
        if humanml_link.exists():
            return
        if not humanml_target.exists():
            logger.warning("dataset target not found for symlink: %s", humanml_target)
            return
        humanml_link.symlink_to(humanml_target, target_is_directory=True)
        logger.info("created dataset symlink: %s -> %s", humanml_link, humanml_target)

    def _ensure_smpl_symlink(self) -> None:
        """MDM リポジトリ内の body_models/smpl をホストの data/motion/body_models/smpl にシンボリックリンクする。"""
        target_root = self.settings.motion_data_dir / "body_models" / "smpl"
        repo_body = self.repo_dir / "body_models"
        repo_body.mkdir(exist_ok=True)
        smpl_link = repo_body / "smpl"
        if smpl_link.exists():
            return
        if not target_root.exists():
            logger.warning("SMPL target not found for symlink: %s", target_root)
            return
        smpl_link.symlink_to(target_root, target_is_directory=True)
        logger.info("created SMPL symlink: %s -> %s", smpl_link, target_root)

    def _validate_dataset(self) -> None:
        """HumanML3D のテキスト/モーションが揃っているか簡易チェックし、明示的にログを出す。"""
        dataset_root = self.settings.motion_data_dir / "dataset" / "HumanML3D"
        texts_dir = dataset_root / "texts"
        motion_dir = dataset_root / "new_joint_vecs"
        split_file = dataset_root / "test.txt"
        missing = []
        if not split_file.exists():
            raise MDMUnavailable(f"split file not found: {split_file}")
        if not texts_dir.exists():
            raise MDMUnavailable(f"texts dir not found: {texts_dir}")
        if not motion_dir.exists():
            raise MDMUnavailable(f"motion dir not found: {motion_dir}")

        lines = split_file.read_text().splitlines()
        sample_ids = lines[:50]  # 先頭だけ簡易チェック
        for sid in sample_ids:
            txt = texts_dir / f"{sid}.txt"
            mot = motion_dir / f"{sid}.npy"
            if not txt.exists() or not mot.exists():
                missing.append(sid)
        if missing:
            raise MDMUnavailable(
                f"dataset incomplete: missing {len(missing)}/{len(sample_ids)} samples (e.g., {missing[:5]}) "
                "check file name padding/paths under data/motion/dataset/HumanML3D"
            )

    def _ensure_humanml_mean_std(self) -> None:
        """HumanML3D の Mean/Std が KIT(251) 側になっている場合に t2m(263) を当てる。"""
        dataset_root = self.settings.motion_data_dir / "dataset" / "HumanML3D"
        mean_path = dataset_root / "Mean.npy"
        std_path = dataset_root / "Std.npy"
        if not mean_path.exists() or not std_path.exists():
            return
        try:
            mean = np.load(mean_path)
            std = np.load(std_path)
        except Exception:
            return
        if mean.shape == (263,) and std.shape == (263,):
            return

        fallback_mean = self.repo_dir / "dataset" / "t2m_mean.npy"
        fallback_std = self.repo_dir / "dataset" / "t2m_std.npy"
        if not fallback_mean.exists() or not fallback_std.exists():
            logger.warning(
                "HumanML3D Mean/Std shape mismatch (mean=%s std=%s) but fallback t2m_mean/std not found in repo dataset/",
                mean.shape,
                std.shape,
            )
            return

        shutil.copyfile(fallback_mean, mean_path)
        shutil.copyfile(fallback_std, std_path)
        logger.warning(
            "Replaced HumanML3D Mean/Std.npy with repo t2m_mean/std due to shape mismatch (mean=%s std=%s).",
            mean.shape,
            std.shape,
        )

    def _run_generate(
        self, payload: MotionGenerateRequest, provider: str, job_id: str, args_cfg: LoadedArgs | None
    ) -> tuple[dict[str, list[MotionKeyframe]], list[RootPosition], dict]:
        output_dir = self.settings.data_root / "mdm_outputs" / job_id
        output_dir.mkdir(parents=True, exist_ok=True)
        ckpt = self.default_checkpoint if provider == "mdm" else self.dip_checkpoint
        fps = payload.fps or (args_cfg.fps if args_cfg and args_cfg.fps else self.default_fps)
        motion_length = payload.duration_sec or self.settings.mdm_default_motion_length
        guidance = payload.guidance if payload.guidance is not None else (args_cfg.guidance_param if args_cfg else 2.5)
        if guidance is None:
            guidance = 2.5
        seed = payload.seed if payload.seed is not None else 10

        cmd = [
            "python3.12",
            "-m",
            "sample.generate",
            "--model_path",
            str(ckpt),
            "--output_dir",
            str(output_dir),
            "--text_prompt",
            payload.prompt,
            "--num_samples",
            "1",
            "--num_repetitions",
            "1",
            "--guidance_param",
            str(guidance),
            "--motion_length",
            str(motion_length),
            "--seed",
            str(seed),
        ]
        if provider == "dip":
            cmd.append("--autoregressive")

        env = os.environ.copy()
        base_pythonpath = env.get("PYTHONPATH", "")
        parts = [p for p in base_pythonpath.split(":") if p]
        if "/workspace" not in parts:
            parts.append("/workspace")
        env["PYTHONPATH"] = ":".join([str(self.repo_dir), *parts])

        logger.info("running MDM generate: %s", " ".join(cmd))
        self._ensure_dataset_symlink()
        self._ensure_smpl_symlink()
        self._ensure_humanml_mean_std()
        self._validate_dataset()
        subprocess.run(cmd, cwd=self.repo_dir, env=env, check=True)

        results_path = output_dir / "results.npy"
        if not results_path.exists():
            raise RuntimeError(f"MDM output not found: {results_path}")

        data = np.load(results_path, allow_pickle=True).item()
        motions = data["motion"]

        postprocess = (self.settings.mdm_postprocess or "fast").strip().lower()
        if postprocess in {"hik", "motions2hik", "smplify"}:
            @contextlib.contextmanager
            def _pushd(path: Path):
                prev = Path.cwd()
                os.chdir(path)
                try:
                    yield
                finally:
                    os.chdir(prev)

            with _pushd(self.repo_dir):
                sys.path.insert(0, str(self.repo_dir))
                try:
                    from visualize.motions2hik import motions2hik
                finally:
                    if str(self.repo_dir) in sys.path:
                        sys.path.remove(str(self.repo_dir))

                hik = motions2hik(motions, device=0, cuda=torch.cuda.is_available())
            joint_map = hik["joint_map"]
            thetas = np.array(hik["thetas"])[0]  # [frames, joints, 3]
            roots_arr = np.array(hik["root_translation"])[0]  # [frames, 3]

            tracks = {}
            frame_count = thetas.shape[0]
            delta_t = 1.0 / float(fps)
            for frame_idx in range(frame_count):
                timestamp = frame_idx * delta_t
                frame_rot = thetas[frame_idx]
                for joint_idx, joint_name in enumerate(joint_map):
                    quat = _euler_deg_to_quat(frame_rot[joint_idx])
                    tracks.setdefault(joint_name, []).append(
                        MotionKeyframe(
                            t=timestamp, x=float(quat[0]), y=float(quat[1]), z=float(quat[2]), w=float(quat[3])
                        )
                    )

            root_positions = [
                RootPosition(t=idx * delta_t, x=float(vec[0]), y=float(vec[1]), z=float(vec[2]))
                for idx, vec in enumerate(roots_arr)
            ]
        else:
            tracks, root_positions = _xyz_motion_to_fast_tracks(motions=motions, fps=fps)

        meta = {
            "generator": provider,
            "checkpoint": str(ckpt),
            "repo": str(self.repo_dir),
            "output_dir": str(output_dir),
            "args": args_cfg.model_dump() if args_cfg else None,
            "seed": seed,
            "guidance_param": guidance,
            "motion_length": motion_length,
            "fps": fps,
            "postprocess": postprocess,
        }
        return tracks, root_positions, meta

    def generate(
        self, payload: MotionGenerateRequest, provider: str = "mdm", job_id: str | None = None
    ) -> tuple[dict[str, list[MotionKeyframe]], list[RootPosition], dict]:
        if job_id is None:
            job_id = uuid4().hex
        try:
            self._assert_available()
        except MDMUnavailable as exc:
            logger.warning("MDM unavailable (%s). Falling back to placeholder generator.", exc)
            tracks, roots = generate_placeholder_tracks(
                duration_sec=payload.duration_sec or self.settings.mdm_default_motion_length,
                fps=payload.fps or self.settings.mdm_default_fps,
                seed=payload.seed,
            )
            return tracks, roots, {"generator": "placeholder", "reason": str(exc)}

        args_cfg = self._default_args if provider == "mdm" else self._dip_args
        try:
            return self._run_generate(payload=payload, provider=provider, job_id=job_id, args_cfg=args_cfg)
        except Exception as exc:
            logger.exception("MDM inference failed; falling back to placeholder")
            fps = payload.fps or (args_cfg.fps if args_cfg and args_cfg.fps else self.default_fps)
            tracks, roots = generate_placeholder_tracks(
                duration_sec=payload.duration_sec or self.settings.mdm_default_motion_length,
                fps=fps,
                seed=payload.seed,
            )
            meta = {
                "generator": "placeholder",
                "reason": str(exc),
                "checkpoint": str(self.default_checkpoint if provider == "mdm" else self.dip_checkpoint),
            }
            return tracks, roots, meta


def build_artifact(
    job_id: str,
    payload: MotionGenerateRequest,
    tracks: dict[str, list[MotionKeyframe]],
    roots: Iterable[RootPosition],
    metadata: dict,
) -> MotionArtifact:
    duration = payload.duration_sec or 5.0
    fps = payload.fps or 30
    return MotionArtifact(
        job_id=job_id,
        format=payload.format or "vrm-json",
        output_path="",
        url=None,
        duration_sec=duration,
        fps=fps,
        tracks=tracks,
        root_position=list(roots),
        metadata=metadata,
    )
