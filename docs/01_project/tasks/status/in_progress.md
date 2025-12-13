# 進行中タスク
- 2025年12月13日: Motion Diffusion Model をモーション生成マイクロサービスとして統合する計画策定（旧計画を置き換え）
  - motion_service の推論呼び出しを `python -m sample.generate` 相当（subprocess）で実装し、通常/DiP の2 API を追加（`/v1/motion/generate` と `/v1/motion/generate/dip`）
  - MDM 公式リポジトリはコンテナ内で clone する方針に変更（バインド不要）
  - HumanML3D / SMPL のパス問題は、MDM repo 内へ symlink を自動作成することで吸収（`dataset/HumanML3D` / `body_models/smpl`）
  - 依存不足（clip/joblib/transformers 等）と Python 3.12 互換（chumpy の `inspect.getargspec`）を Dockerfile 側で解消中
  - 次: 生成結果の VRM 用 JSON（QuaternionKeyframeTrack）変換の安定化と、DiP 生成の品質/速度チューニング
