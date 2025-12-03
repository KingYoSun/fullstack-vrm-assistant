# fullstack-vrm-assistant

DGX Spark 1台に STT → RAG → LLM → TTS → three-vrm をまとめ、音声で会話できる 3D アバター秘書を提供するリポジトリです。docker compose 一発起動を前提に、LLM/STT/TTS/Embedding の差し替えやモック検証ができます。

## できること
- ブラウザで 3D アバター（three-vrm）を表示し、マイク音声を WebSocket で送信
- whisper.cpp を用いた日本語対応 STT（partial/final 両方をストリームで返却）
- LangChain + FAISS による RAG と Qwen3-32B (NIM) ベースの LLM 応答
- Open Audio S1 (Fish Speech / OpenVoice) での TTS ストリーミングとローカル再生
- モデル/プロバイダ設定を `config/providers.yaml`（環境変数埋め込み）で切り替え
- モックプロファイル（echo-server）で GPU なしの疎通確認

## 前提環境（DGX Spark）
- ハード: DGX Spark (aarch64, SM 12.1), CUDA 13.0 相当のドライバ
- GPU: llm/stt/tts/embedding で各1枚を `deploy.resources` で予約
- OS/ランタイム: Docker と Docker Compose が利用可能であること
- 推奨ポート: backend `8000`, frontend `5173`, llm `18000`, stt `6006`, tts `7007`, embedding `9000`, postgres `5432`

## クイックスタート（本番相当のスタック）
1. 依存ファイルを用意
   ```bash
   cp .env.default .env
   # LLM で NIM を使う場合は NGC_API_KEY を .env に設定
   ```
   - Backend 依存は `backend/requirements.dev.txt` にあり、`UploadFile`/Form 用に `python-multipart` も含めています。
   - 起動時は `COMPOSE_PROFILES` に `prod` / `dev` / `mock` のいずれかを指定してください（以下は `prod` 例）。
2. モデルを配置（例は `docs/03_implementation/production_runtime.md` を参照）
   - STT: `./models/stt/ggml-base.bin` など Whisper GGUF
   - TTS: `./models/tts/` に Open Audio S1 mini、話者リファレンスは `./references/tts/`
   - Embedding: `./models/embedding/embd-model.gguf`（nomic-embed-text など）
   - LLM: `./models/llm` は NIM が起動時に取得（事前に作成しておく）
3. イメージをビルド（backend/frontend の依存も Dockerfile でまとめておく）
   ```bash
   COMPOSE_PROFILES=prod docker compose build backend frontend stt tts embedding
   ```
4. スタックを起動
   ```bash
   COMPOSE_PROFILES=prod docker compose up -d
   ```
5. 動作確認
   - LLM ヘルス: `curl http://localhost:18000/v1/health/ready`
   - Backend ready: `curl http://localhost:8000/ready`
   - フロント: `http://<DGXホスト>:5173` にアクセス。WS はアクセス元ホスト + `VITE_BACKEND_PORT`（デフォルト 8000）+ `VITE_WS_PATH`（デフォルト `/ws/session`）から自動組み立てられ、`wss`/`ws` はページのプロトコルに追随します。別ホスト/パスを使う場合は `.env` の `VITE_WS_BASE_URL`（優先）または `VITE_BACKEND_HOST`/`VITE_BACKEND_PORT`/`VITE_WS_PATH` を設定してください。

### 開発・モック
- ホットリロード付き開発（dev プロファイル）
  - backend/frontend だけを起動: `make dev`
  - プロバイダ/PostgreSQL も含めて起動: `COMPOSE_PROFILES=dev docker compose up -d`（または `make dev-all`）
- GPU なしの疎通確認（echo-server を使用）
  - プロバイダのみをモックで起動: `COMPOSE_PROFILES=mock docker compose up -d`
- 依存を更新した場合は backend/frontend も含めて再ビルドしてください:
  ```bash
  COMPOSE_PROFILES=prod docker compose build backend frontend
  ```

## ファイル構成
```
.
├ docker-compose.yml            # prod/dev/mock を profiles で切り替える compose
├ backend/                      # FastAPI + LangChain + Provider 抽象
├ frontend/                     # Vite + React + three-vrm UI
├ config/providers.yaml         # LLM/STT/TTS/Embedding/RAG の設定（環境変数で上書き）
├ docs/                         # 設計/実装/タスク/進捗ドキュメント
├ docker/                       # backend/frontend/STT/TTS/Embedding 用 Dockerfile 群
├ data/                         # RAG 用 FAISS インデックス出力先（ホストマウント）
├ models/                       # モデル配置ディレクトリ（llm/stt/tts/embedding）
├ references/                   # TTS リファレンス音声など
└ tools/                        # wheels 等の補助ファイル
```

## 設定のポイント
- `.env` にポート/モデルパス/プロバイダエンドポイントを集約（Node は pnpm、Python は 3.12 を想定）。
- フロントエンドの接続先は `.env` で `VITE_WS_BASE_URL` を指定するか、`VITE_BACKEND_HOST`/`VITE_BACKEND_PORT`/`VITE_WS_PATH` を組み合わせて設定できます（未指定時はアクセス元ホスト + port 8000 + `/ws/session` を自動利用）。
- `config/providers.yaml` は環境変数参照で、`load_providers_config` が未解決プレースホルダを検出します。
- RAG インデックス作成例:
  ```bash
  COMPOSE_PROFILES=prod docker compose run --rm backend \
    sh -c "cd /workspace/backend && python -m app.cli.ingest --source /workspace/docs --index ${RAG_INDEX_PATH:-/data/faiss/index.bin}"
  ```

## 参考ドキュメント
- 設計概要: `docs/design_doc.md`
- MVP 実装計画: `docs/03_implementation/mvp_plan.md`
- 実運用手順（モデル取得/起動/計測）: `docs/03_implementation/production_runtime.md`
- タスク/進捗: `docs/01_project/tasks/status/in_progress.md`, `docs/01_project/progressReports/`

## 今後の実装・改善予定
- 本番相当プロバイダでのレイテンシ計測（partial STT <0.5s, TTS 開始 <2s の p95 を採取）
- three-vrm の表情/イベント連携の強化と UI 改良
- RAG のインデクシング/クエリ最適化とメトリクス整備
- モデル差し替えやマルチセッション運用を見据えた設定/ログの拡充
