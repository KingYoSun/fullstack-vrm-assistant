# 実運用ランタイム手順（LLM/STT/TTS/Embedding）

## 全体方針
- DGX Spark (aarch64, CUDA 13.0, SM 12.1) 向けに、LLM=gpt-oss-20b (GGUF) を llama.cpp (CUDA, sm_121) でホストし、STT=whisper.cpp、TTS=Fish Speech/OpenVoice (Open Audio S1 mini)、Embedding=llama.cpp の構成に更新済み。
- `.env.default` にプロバイダのエンドポイント/ポート/モデルパスを集約。`cp .env.default .env` の上で `LLM_MODEL`（gpt-oss-20b GGUF へのパス）や各モデルパス、BACKEND (cuda/cpu) を実環境に合わせて上書きする。
- GPU を使うコンテナは `llm/stt/tts/embedding` のみ。モデルは `./models/{llm,stt,tts,embedding}` をそれぞれにバインドし、モックは `--profile mock` で echo-server に切り替えられる。
- STT/TTS/Embedding/LLM は付属の Dockerfile から CUDA 13.0 対応でビルド（LLM は `docker/llm-llama/Dockerfile` で CMAKE_CUDA_ARCHITECTURES=121 を指定）。

## 主要環境変数 (.env)
- **LLM**: `LLM_IMAGE=local/gpt-oss-llm:cuda`, `LLM_PLATFORM=linux/arm64`, `LLM_UBUNTU_VERSION`/`LLM_CUDA_VERSION`/`LLM_CUDA_ARCH=121`, `LLAMA_CPP_REF`, `LLM_LOCAL_PORT`/`LLM_PORT=8080`, `LLM_MODEL_DIR=/models`, `LLM_MODEL=/models/gpt-oss-20b.gguf`, `LLM_CTX_SIZE`/`LLM_THREADS`/`LLM_N_GPU_LAYERS`/`LLM_FLASH_ATTN`, `LLM_ENDPOINT=http://llm:${LLM_PORT}/v1`。
- **STT**: `STT_IMAGE=local/whisper-stt:cuda`, `STT_MODEL_LOCAL_DIR`, `STT_MODEL=/models/ggml-base.en.bin`（日本語モデルに差し替え可）、`STT_LANGUAGE=ja`, `STT_THREADS`, `STT_ENDPOINT=http://stt:6006/inference`。
- **TTS**: `TTS_IMAGE=local/openvoice:cuda`, `TTS_MODEL_LOCAL_DIR`, `TTS_REFERENCE_LOCAL_DIR`, `TTS_BACKEND`（cuda/cpu）, `TTS_PORT`, `TTS_DEFAULT_VOICE`, `TTS_OUTPUT_FORMAT=opus`, `TTS_SAMPLE_RATE=44100`。
- **Embedding**: `EMBEDDING_IMAGE=local/llama-embedding:cuda`, `EMBEDDING_ENDPOINT=http://embedding:9000/embedding`（llama.cpp `llama-server --embeddings` の REST パス）、`EMBEDDING_MODEL=/models/embd-model.gguf`, `EMBEDDING_PORT=9000`, `EMBEDDING_PARALLEL/EMBEDDING_UBATCH/EMBEDDING_NGPU/EMBEDDING_POOLING`。
- **RAG**: `RAG_INDEX_PATH=/data/faiss/index.bin`, `RAG_TOP_K`, `RAG_EMBEDDING_PROVIDER`。

## モデル/イメージの準備
### 1. LLM (gpt-oss-20b GGUF + llama-server)
- gpt-oss-20b の GGUF を `./models/llm` に配置（例: `./models/llm/gpt-oss-20b.gguf` とし、`.env` の `LLM_MODEL` を同じパスに合わせる）。
- 取得例（URL は使用する量子化に応じて差し替え）:
```bash
mkdir -p ./models/llm
wget -O ./models/llm/gpt-oss-20b.gguf <your-gpt-oss-20b-gguf-url>
```
- ビルド: `docker compose build llm`（`docker/llm-llama/Dockerfile` が CUDA 13.0 / SM 12.1 で llama.cpp をビルド）。
- CUDA バージョンやアーキテクチャを変える場合は `.env` の `LLM_UBUNTU_VERSION` / `LLM_CUDA_VERSION` / `LLM_CUDA_ARCH` / `LLAMA_CPP_REF` を上書きする。

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
- GPU/プラットフォームを変える場合は `.env` の `*_PLATFORM` と `*_BACKEND`、もしくは LLM の `LLM_CUDA_ARCH`/`LLM_CUDA_VERSION` を合わせて更新。

## RAG/Embedding ジョブ
- ingest 例（`.env` の embedding/RAG 設定を利用）:
```bash
COMPOSE_PROFILES=prod docker compose run --rm backend \
  sh -c "cd /workspace/backend && python -m app.cli.ingest --source /workspace/docs --index ${RAG_INDEX_PATH:-/data/faiss/index.bin}"
```
- `/data` がホストにマウントされるため、生成されたインデックスは `data/faiss/` に残る。

## ヘルスチェック / フォールバック / レイテンシ
- `GET /health` / `GET /ready` は providers の `provider/endpoint/is_mock/fallback_count` を返却（モック利用やフォールバック発生時は `warnings` に追記）。
- LLM (llama-server) のヘルスは `http://localhost:${LLM_LOCAL_PORT:-18000}/health`、whisper.cpp は `http://localhost:${STT_PORT}/health` を確認。
- レイテンシ計測は `docs/01_project/tasks/status/in_progress.md` の観点に沿って、partial/final/tts_start の p95 を 10〜20 サンプル採取し、request-id とともに記録。

## 運用ノート
- GPU 要求は llm/stt/tts/embedding で 1 枚ずつ（llm は compose 設定で GPU 全割り当て）。LLM は CUDA 13.0 / SM 12.1 向けにビルドした llama.cpp で動作する想定。
- モデルの切り替えは `.env` と `./models` の差し替えで完結。ロールバックは旧ディレクトリを残して再起動するだけで可能（GGUF のファイル名変更で `LLM_MODEL` を合わせる）。
- ログは backend/各プロバイダが JSON で出力。`/health` `/ready` の `warnings` をプローブするとフォールバック発生を検知しやすい。
