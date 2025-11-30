# Fish Speech / OpenVoice server for aarch64 CUDA (cu129)

FROM nvidia/cuda:12.9.0-devel-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PIP_DEFAULT_TIMEOUT=100 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_INDEX_URL=https://pypi.org/simple

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      software-properties-common ca-certificates curl gnupg libgomp1 \
    && add-apt-repository -y ppa:deadsnakes/ppa \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
      python3.12 python3.12-venv python3.12-dev \
    && update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.12 1 \
    && python3 -m ensurepip --upgrade \
    && python3 -m pip install --upgrade pip setuptools wheel \
    && rm -rf /var/lib/apt/lists/*

# 音声関連の依存を追加
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      git ffmpeg libsox-dev portaudio19-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Fish Speech を取得
RUN git clone https://github.com/KingYoSun/fish-speech.git . 
RUN git checkout build/dgxspark

# Fish Speech 本体をインストール
RUN pip install torch==2.9.0 torchvision==0.24.0 torchaudio==2.9.0 --index-url https://download.pytorch.org/whl/cu129
RUN pip install --no-cache-dir --retries=5 --timeout=60 -e .[cu129]

# Server mode entrypoint (API)
ENV API_SERVER_NAME=0.0.0.0 \
    API_SERVER_PORT=8080 \
    LLAMA_CHECKPOINT_PATH=checkpoints/openaudio-s1-mini \
    DECODER_CHECKPOINT_PATH=checkpoints/openaudio-s1-mini/codec.pth \
    DECODER_CONFIG_NAME=modded_dac_vq \
    BACKEND=cuda

RUN printf '%s\n' \
  '#!/usr/bin/env bash' \
  'set -euo pipefail' \
  'export BACKEND=${BACKEND:-cuda}' \
  'echo "[tts] Starting Fish Speech API server (backend=${BACKEND})"' \
  'exec python3 tools/api_server.py \' \
  '  --listen "${API_SERVER_NAME:-0.0.0.0}:${API_SERVER_PORT:-8080}" \' \
  '  --llama-checkpoint-path "${LLAMA_CHECKPOINT_PATH}" \' \
  '  --decoder-checkpoint-path "${DECODER_CHECKPOINT_PATH}" \' \
  '  --decoder-config-name "${DECODER_CONFIG_NAME}" \' \
  '  --device "${BACKEND}"' \
  > /app/start_server.sh \
  && chmod +x /app/start_server.sh

EXPOSE 7860 8080

CMD ["/app/start_server.sh"]
