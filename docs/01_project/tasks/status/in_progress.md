# 進行中タスク
- 2025年12月13日: Motion Diffusion Model をモーション生成マイクロサービスとして統合する計画策定（旧計画を置き換え）
  - motion_service スタブ + Dockerfile/compose/.env を追加し、backend の API/WS/diagnostics と frontend Diagnostics に Motion を組み込み済み（現在はプレースホルダー生成のみで MDM 推論接続と VRM 再生は未実装）
  - 公式リポジトリ `/home/kingyosun/motion-diffusion-model` の推論手順/依存/出力形式を整理し、`docs/03_implementation/motion_diffusion_model_plan.md` に導入計画（コンテナ方針・モデル/データ配置・VRM 変換フロー）を詳細化
