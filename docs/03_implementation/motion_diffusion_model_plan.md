# Motion Diffusion Model 統合計画（2025年12月13日）

## 方針とライセンス
- SnapMoGen は非商用ライセンスのため、本 OSS リポジトリでは Motion Diffusion Model (MDM) に切り替える。
- MDM を GPU モーション生成マイクロサービスとしてデプロイし、FastAPI backend から HTTP 経由で呼び出して `/data/animations` に VRM リターゲット済みのキーフレーム JSON を保存する。

## コンテナ/環境変数
- 画像名は `local/motion-mdm:cuda` をデフォルトにし、`.env*` で `MOTION_PROVIDER=mdm` / `MOTION_IMAGE` / `MOTION_MODEL_DIR` / `MOTION_DATA_DIR` などを定義。
- `docker/motion-mdm/Dockerfile`（CUDA 13.0 系）で Python 3.12 + PyTorch (cu130) をインストールし、MDM 依存を追加。モデルは `/checkpoint_dir`、生成物は `/data/animations` に永続化。
- Compose では prod/dev 両プロファイルに同一イメージを使い、`/data` をホストと共有して frontend からも参照可能にする。

## 実装タスク
1. **MDM 推論ラッパ**: `motion_service` に MDM 推論呼び出し（プロンプト/seed/steps/guidance）と出力正規化処理を実装。失敗時のプレースホルダ生成は維持しつつ、メタデータに `generator=mdm` を付与。
2. **フォーマット変換**: MDM 出力を VRM Humanoid ボーンへマップし、Quaternion キーフレーム列 + ルート平行移動を JSON 出力。将来 `.vrma` / `.bvh` 併存を想定し、拡張子をオプション化。
3. **Backend/Frontend 統合**: backend の MotionClient を MDM エンドポイントに向け、Diagnostics で生成物パスを返却。frontend の Diagnostics/アバター再生で MDM 生成結果を読み込み、プレースホルダ利用時は警告ログを表示。
4. **モデル管理**: `./models/motion` にチェックポイントを配置する導線と README 追記。モデル取得スクリプト（任意）を `tools/` に配置し、SHA/サイズを記載。

## メトリクス/検証
- Latency（生成完了まで）とファイルサイズ、ボーンカバレッジを計測し、1 本あたり 5 秒/30fps を基準に再生確認。
- 失敗時のフォールバックが UI/ログで即時分かることを手動検証（Diagnostics API/WS 両方）。
