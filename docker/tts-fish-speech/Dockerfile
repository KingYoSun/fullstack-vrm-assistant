# Fish Speech / OpenVoice server for aarch64 CUDA (cu128)
# Base: NVIDIA NGC PyTorch (ARM64対応)

FROM nvcr.io/nvidia/pytorch:25.08-py3

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_INDEX_URL=https://pypi.org/simple

# 音声関連の依存を追加
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      git ffmpeg libsox-dev portaudio19-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Fish Speech を取得
RUN git clone https://github.com/fishaudio/fish-speech.git . 

# 任意で venv を作成
RUN python -m venv .venv
ENV VIRTUAL_ENV=/app/.venv
ENV PATH="$VIRTUAL_ENV/bin:$PATH"

# aarch64 用の GPU wheel を公式 cu128 index から導入
RUN pip install --upgrade pip \
    && pip install torch torchvision torchaudio \
       --index-url https://download.pytorch.org/whl/cu128

# Fish Speech 本体を CUDA オプションでインストール
RUN pip install -e .[cu128]

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
  'exec python tools/api_server.py \' \
  '  --listen "${API_SERVER_NAME:-0.0.0.0}:${API_SERVER_PORT:-8080}" \' \
  '  --llama-checkpoint-path "${LLAMA_CHECKPOINT_PATH}" \' \
  '  --decoder-checkpoint-path "${DECODER_CHECKPOINT_PATH}" \' \
  '  --decoder-config-name "${DECODER_CONFIG_NAME}" \' \
  '  --device "${BACKEND}"' \
  > /app/start_server.sh \
  && chmod +x /app/start_server.sh

EXPOSE 7860 8080

CMD ["/app/start_server.sh"]
