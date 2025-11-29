# 実運用ランタイム手順（LLM/STT/TTS/Embedding）

## 全体方針
- `docker-compose.yml` を本番想定のプロバイダ構成に更新済み（vLLM + sherpa-onnx + Open Audio S1 + text-embeddings-inference）。GPU は `runtime: nvidia` + `device_requests` で要求。
- `.env.default` に本番用のエンドポイント/モデル/パラメータを環境変数として定義。`cp .env.default .env` で初期化し、各値を実環境に合わせて上書きする。
- モックは `--profile mock` で起動（echo-server）。本番は `docker compose up -d` で実プロバイダを立ち上げる。

## 環境変数の要点
- LLM: `LLM_IMAGE`（vLLM）、`LLM_MODEL_PATH`（例: `/models/gpt-oss-120b`）、`LLM_GPU_COUNT`/`LLM_TP_SIZE`、`LLM_ENDPOINT`。
- STT: `STT_IMAGE`（sherpa-onnx）、`STT_MODEL_DIR`、`STT_COMMAND`（WebSocket サーバ起動コマンドを上書き可能）、`STT_ENDPOINT`。
- TTS: `TTS_IMAGE`（Open Audio S1 サーバ想定。デフォルトは自前ビルドの `local/openvoice:cpu`）、`TTS_MODEL_DIR`、`TTS_COMMAND`、`TTS_ENDPOINT`。
- Embedding: `EMBEDDING_IMAGE`（Hugging Face text-embeddings-inference）、`EMBEDDING_MODEL`、`EMBEDDING_PORT`。Hugging Face トークンが必要なら `HUGGINGFACEHUB_API_TOKEN` をセット。
- モデル配置: `./models/{llm,stt,tts,embedding}` をホスト側の標準配置としてボリュームマウント。
- プラットフォーム: ARM ホストの場合は `*_PLATFORM=linux/amd64` を `.env` で指定してイメージを引く（qemu 必要）。ネイティブ arm64 イメージが不要ならこのまま、arm64 対応イメージを自前で用意する場合はタグを差し替えてください。

## STT/TTS を自前ビルドする場合
- TTS (Fish Speech/OpenVoice): `docker-compose.yml` は fish-speech リポジトリを `target: server` でビルドする設定に変更済み。デフォルトタグは `local/openvoice:cpu`、バックエンドは `TTS_BACKEND=cpu`（ARM でもビルド可）。ビルドコマンド例:
  ```bash
  docker compose build tts  # CPUビルド (platformは.envのTTS_PLATFORMに従う)
  ```
  モデルは `./models/tts` を `/models` にマウントする。GPU を使う場合は `.env` の `TTS_BACKEND=cuda`、`TTS_PLATFORM=linux/amd64` とし、NVIDIA 環境 + buildx/qemu を用意する。
- STT (sherpa-onnx): `docker/stt-sherpa/Dockerfile` を追加し、pip 版 `sherpa-onnx` で WebSocket サーバを起動するイメージを `local/sherpa-onnx:cpu` としてビルド。ビルドコマンド例:
  ```bash
  docker compose build stt
  ```
  モデルは `./models/stt` を `/models` にマウントし、環境変数でパスを調整可能（例: `STT_ENCODER=/models/encoder.onnx`）。`STT_PROVIDER_RUNTIME` で `cuda` 指定も可能だが、別途 CUDA ベースのイメージを用意する必要あり。

### CUDA ビルドの指定（Fish Speech: cu128 / sherpa-onnx: cu128）
- TTS (Fish Speech/OpenVoice, cu128): `docker/tts-fish-speech/Dockerfile` をベースに NGC の PyTorch ARM64 イメージからビルド。`.env` の `TTS_IMAGE=local/openvoice:cuda` のまま `docker compose build tts` を実行（ARM64 はそのまま、x86_64 でビルドする場合は `TTS_PLATFORM=linux/amd64` を指定）。
- STT (sherpa-onnx, cu128): `.env` で `STT_BACKEND=cuda`、`STT_CUDA_VERSION=12.8.0` をセットし、`docker compose build stt` で CUDA 版をビルド。compose に `runtime: nvidia` が指定されているため、GPU ホストで実行すること。`STT_PROVIDER_RUNTIME=cuda` を合わせて設定すると onnxruntime GPU を利用可能。

#### ARM ホストで CUDA イメージをビルドする場合
- 事前に qemu/binfmt を登録し、buildx を有効化する（例）:
  ```bash
  docker run --privileged --rm tonistiigi/binfmt --install amd64
  docker buildx create --name multi --use
  ```
- その上で `docker compose build tts stt` を実行。登録がないと `exec format error` で失敗する。
- qemu が使えない環境では、`*_BACKEND=cpu` と `*_PLATFORM=linux/arm64` に切り替えて CPU ビルドを行う。
- aarch64 + CUDA の wheel を自前で用意する場合は `tools/wheels/README.md` を参照し、cibuildwheel で torch 2.8.0+cu128 / sherpa-onnx 1.12.18 の wheel を `wheels/` 配下に配置してから Docker ビルドで参照する。TTS は NGC PyTorch ベースの `docker/tts-fish-speech/Dockerfile` を推奨（cu128 aarch64 wheel を公式 index から取得するため）。

## プロバイダセットアップ例
1. LLM (gpt-oss-120b, vLLM)
   ```bash
   # モデル取得例（事前に git-lfs / HF token を準備）
   mkdir -p ./models/llm
   huggingface-cli download gpt-oss/gpt-oss-120b \
     --local-dir ./models/llm/gpt-oss-120b \
     --local-dir-use-symlinks False
   # 必要に応じて LLM_MODEL_PATH=/models/gpt-oss-120b を調整
   ```
2. STT (sherpa-onnx)
   ```bash
   mkdir -p ./models/stt
   # sherpa-onnx の公開モデルを取得（例: streaming zipformer）
   # （例）https://github.com/k2-fsa/sherpa-onnx/releases から ja 系の streaming zipformer を選択
   wget -O ./models/stt/model.tar.gz https://github.com/k2-fsa/sherpa-onnx/releases/download/<tag>/<streaming-zipformer-ja-asset>.tar.gz
   tar -xf ./models/stt/model.tar.gz -C ./models/stt --strip-components=1
   # コマンドを必要に応じて上書き（.env の STT_COMMAND もしくは docker compose で指定）
   # デフォルト: python3 -m sherpa_onnx.python_api.offline_websocket_server --port 6006 --tokens .../tokens.txt --encoder-onnx .../encoder.onnx ...
   ```
3. TTS (Open Audio S1)
   ```bash
   mkdir -p ./models/tts
   git clone https://huggingface.co/fishaudio/open_audio_s1 ./models/tts/open_audio_s1
   # .env の TTS_MODEL_DIR=/models/tts を維持しつつ、必要なら TTS_COMMAND を上書き
   ```
4. Embedding (text-embeddings-inference)
   - 既定で `intfloat/multilingual-e5-base` を使用。大型モデルに入れ替える場合は `EMBEDDING_MODEL` と `EMBEDDING_IMAGE` を変更し、HF トークンを付与。

## 起動・切り替え
- 本番: `docker compose up -d`（GPU 要求あり。モデルが未配置の場合は起動に失敗するため上記で準備）。
- モック: `docker compose --profile mock up -d`（実プロバイダを停止したい場合は `docker compose stop llm stt tts embedding`）。
- 開発（ホットリロード）は従来通り `docker-compose.dev.yml` + `COMPOSE_PROFILES=dev` を利用。

## RAG/Embedding ジョブ
- ingest ジョブ: `docker compose run --rm backend python -m app.cli.ingest --source docs --providers config/providers.yaml --index ${RAG_INDEX_PATH:-/data/faiss/index.bin}`
  - `/data` がホストにマウントされるため、生成された FAISS インデックスは `data/faiss/` に残る。
  - `EMBEDDING_ENDPOINT`/`RAG_INDEX_PATH` は `.env` の値をそのまま利用。

## ヘルスチェック / フォールバック検知 / レイテンシ
- `GET /health`: `providers` に各プロバイダの `provider/endpoint/is_mock/fallback_count` を返却。モック利用やフォールバック発生時は `warnings` に追記。
- `GET /ready`: DB/RAG ロードの状態に加えて上記 `warnings` を表示し、検知時は `status=degraded`。
  ```bash
  curl -s http://localhost:${BACKEND_PORT:-8000}/ready | jq
  ```
- レイテンシ計測: `docs/01_project/tasks/status/in_progress.md` の観点に合わせ、実プロバイダ接続で `partial/final/tts_start` の p95 を 10〜20 サンプル計測。計測ログは request-id 付きで保存し、数値をタスク欄に転記。

## 運用ノート（GPU/ログ/ロールバック）
- GPU 目安: gpt-oss-120b は 6〜8 GPU (H100 クラス) を想定。`LLM_GPU_COUNT`/`LLM_TP_SIZE` で割り当てを調整し、STT/TTS は 1 GPU ずつで十分なことが多い。
- ログ/監視: backend は JSON ログ + `request_id` を出力。`/health`/`/ready` の `warnings` と `fallback_count` をプローブしてフォールバック発生を検知し、必要に応じてメトリクス収集へ転送する。
- モデル更新/ロールバック: モデルディレクトリを差し替えたうえで対象サービスを再起動 (`docker compose restart llm` など)。旧ディレクトリを残しておけば環境変数を戻すだけでロールバック可能。
