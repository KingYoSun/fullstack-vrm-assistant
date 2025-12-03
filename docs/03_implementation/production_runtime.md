# 実運用ランタイム手順（LLM/STT/TTS/Embedding）

## 全体方針
- DGX Spark (aarch64, CUDA 13.0, SM 12.1) 向けに、LLM=NIM Qwen3-32B、STT=whisper.cpp、TTS=Fish Speech/OpenVoice (Open Audio S1 mini)、Embedding=llama.cpp を前提とした構成に更新済み。
- `.env.default` にプロバイダのエンドポイント/ポート/モデルパスを集約。`cp .env.default .env` の上で `NGC_API_KEY` や各モデルパス、BACKEND (cuda/cpu) を実環境に合わせて上書きする。
- GPU を使うコンテナは `llm/stt/tts/embedding` のみ。モデルは `./models/{llm,stt,tts,embedding}` をそれぞれにバインドし、モックは `--profile mock` で echo-server に切り替えられる。
- STT/TTS/Embedding は付属の Dockerfile から CUDA 13.0 対応でビルド。LLM は NIM イメージを `platform=linux/aarch64` で pull する。

## 主要環境変数 (.env)
- **LLM**: `LLM_IMAGE` (デフォルト: `nvcr.io/nim/qwen/qwen3-32b-dgx-spark:latest`), `LLM_PLATFORM=linux/aarch64`, `LLM_LOCAL_PORT`/`LLM_PORT`, `LLM_MODEL_DIR=/opt/nim/workspace`, `LLM_MODEL=qwen3-32b-instruct`, `LLM_ENDPOINT=http://llm:8000/v1`, `NGC_API_KEY`。
- **STT**: `STT_IMAGE=local/whisper-stt:cuda`, `STT_MODEL_LOCAL_DIR`, `STT_MODEL=/models/ggml-base.en.bin`（日本語モデルに差し替え可）、`STT_LANGUAGE=ja`, `STT_THREADS`, `STT_ENDPOINT=http://stt:6006/inference`。
- **TTS**: `TTS_IMAGE=local/openvoice:cuda`, `TTS_MODEL_LOCAL_DIR`, `TTS_REFERENCE_LOCAL_DIR`, `TTS_BACKEND`（cuda/cpu）, `TTS_PORT`, `TTS_DEFAULT_VOICE`, `TTS_OUTPUT_FORMAT=opus`, `TTS_SAMPLE_RATE=44100`。
- **Embedding**: `EMBEDDING_IMAGE=local/llama-embedding:cuda`, `EMBEDDING_ENDPOINT=http://embedding:9000/embedding`（llama.cpp `llama-server --embeddings` の REST パス）、`EMBEDDING_MODEL=/models/embd-model.gguf`, `EMBEDDING_PORT=9000`, `EMBEDDING_PARALLEL/EMBEDDING_UBATCH/EMBEDDING_NGPU/EMBEDDING_POOLING`。
- **RAG**: `RAG_INDEX_PATH=/data/faiss/index.bin`, `RAG_TOP_K`, `RAG_EMBEDDING_PROVIDER`。

## モデル/イメージの準備
### 1. LLM (NIM Qwen3-32B Instruct)
- `NGC_API_KEY` を取得し `.env` に設定。
- モデルキャッシュ用に `mkdir -p ./models/llm`。初回起動時に `/opt/nim/workspace`（上記バインド先）へモデルが自動配置される。
- NGC ログインが必要な場合:
```bash
docker login nvcr.io -u '$oauthtoken' -p "$NGC_API_KEY"
```
- ほかの Qwen バリアントを使う場合は `LLM_IMAGE`/`LLM_MODEL` を差し替える。

### 2. STT (whisper.cpp CUDA 13.0)
- モデル配置例（日本語向けは multi-lingual を推奨）:
```bash
mkdir -p ./models/stt
wget -O ./models/stt/ggml-base.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin
```
- `.env` の `STT_MODEL` を `/models/ggml-base.bin` などに変更可。`STT_THREADS` で CPU/GPU のスレッド数を調整。
- ビルド: `docker compose build stt`（aarch64 + CUDA 13.0）。

### 3. TTS (Fish Speech / Open Audio S1 mini)
- モデル配置:
```bash
mkdir -p ./models/tts
git lfs install
git clone https://huggingface.co/fishaudio/open_audio_s1 ./models/tts/openaudio-s1-mini
```
- `./references/tts` に話者リファレンス音声を置くと `TTS_REFERENCE_DIR` 経由で参照できる。
- GPU 利用時は `.env` で `TTS_BACKEND=cuda`（CPU で試す場合は `cpu`）。ビルド: `docker compose build tts`。

### 4. Embedding (llama.cpp, GGUF)
- 推奨: `nomic-embed-text-v1.5` などの GGUF を配置:
```bash
mkdir -p ./models/embedding
wget -O ./models/embedding/embd-model.gguf \
  https://huggingface.co/bartowski/nomic-embed-text-v1.5-GGUF/resolve/main/nomic-embed-text-v1.5.f16.gguf
```
- `EMBEDDING_MODEL` でファイル名を指定。ビルド: `docker compose build embedding`。

## 起動・切り替え
- 本番相当: `COMPOSE_PROFILES=prod docker compose up -d`（モデルが未配置だと llm/stt/tts/embedding が起動失敗する）。
- モック: `COMPOSE_PROFILES=mock docker compose up -d`（llm/stt/tts/embedding を echo サーバに置き換えて疎通確認）。
- 開発ホットリロード: `COMPOSE_PROFILES=dev docker compose up -d`（backend-dev/frontend-dev + 実プロバイダを起動、軽量に試す場合は `make dev` を利用）。
- GPU/プラットフォームを変える場合は `.env` の `*_PLATFORM` と `*_BACKEND` を合わせて更新。

## RAG/Embedding ジョブ
- ingest 例（`.env` の embedding/RAG 設定を利用）:
```bash
COMPOSE_PROFILES=prod docker compose run --rm backend \
  sh -c "cd /workspace/backend && python -m app.cli.ingest --source /workspace/docs --index ${RAG_INDEX_PATH:-/data/faiss/index.bin}"
```
- `/data` がホストにマウントされるため、生成されたインデックスは `data/faiss/` に残る。

## ヘルスチェック / フォールバック / レイテンシ
- `GET /health` / `GET /ready` は providers の `provider/endpoint/is_mock/fallback_count` を返却（モック利用やフォールバック発生時は `warnings` に追記）。
- LLM/NIM のヘルスは `http://localhost:18000/v1/health/ready`、whisper.cpp は `http://localhost:${STT_PORT}/health` を確認。
- レイテンシ計測は `docs/01_project/tasks/status/in_progress.md` の観点に沿って、partial/final/tts_start の p95 を 10〜20 サンプル採取し、request-id とともに記録。

## 運用ノート
- GPU 要求は llm/stt/tts/embedding で 1 枚ずつ。LLM は SM 12.1 対応の aarch64 NIM イメージで、ドライバは CUDA 13.0 以上を想定。
- モデルの切り替えは `.env` と `./models` の差し替えで完結。ロールバックは旧ディレクトリを残して再起動するだけで可能。
- ログは backend/各プロバイダが JSON で出力。`/health` `/ready` の `warnings` をプローブするとフォールバック発生を検知しやすい。
