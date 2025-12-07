# Fish Speech / OpenVoice server for aarch64 CUDA (cu129)

FROM nvidia/cuda:13.0.2-devel-ubuntu24.04

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PIP_DEFAULT_TIMEOUT=100 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_BREAK_SYSTEM_PACKAGES=1 \
    PIP_INDEX_URL=https://pypi.org/simple

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      software-properties-common ca-certificates curl gnupg libgomp1 wget git ffmpeg libsox-dev portaudio19-dev \
    && add-apt-repository -y ppa:deadsnakes/ppa \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
      python3.12 python3-pip python3.12-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Fish Speech を取得
RUN git clone https://github.com/KingYoSun/fish-speech.git . 
RUN git checkout build/dgxspark

# Fish Speech 本体をインストール
RUN pip install --no-cache-dir --retries=5 --timeout=60 .
# torchをCUDA版に確実に上書き
RUN pip uninstall -y torch torchvision torchaudio \
 && pip install --no-cache-dir torch==2.9.0 torchvision==0.24.0 torchaudio==2.9.0 --index-url https://download.pytorch.org/whl/cu130

# torchcodecは有志wheelを入れる（0.8.1）
RUN curl -L -o /tmp/torchcodec-0.8.1-cp312-cp312-linux_aarch64.whl \
    https://github.com/time2k/torchcodec_for_aarch64/raw/main/torchcodec-0.8.1-cp312-cp312-linux_aarch64.whl \
 && pip install /tmp/torchcodec-0.8.1-cp312-cp312-linux_aarch64.whl \
 && rm -f /tmp/torchcodec-0.8.1-cp312-cp312-linux_aarch64.whl

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
  'export TRITON_PTXAS_PATH=${TRITON_PTXAS_PATH:-/usr/local/cuda/bin/ptxas}' \
  'export TORCH_CUDA_ARCH_LIST=${TORCH_CUDA_ARCH_LIST:-12.1a}' \
  'export PATH=/usr/local/cuda/bin:${PATH:-}' \
  'export LD_LIBRARY_PATH=/usr/local/cuda/lib64:${LD_LIBRARY_PATH:-}' \
  'echo "[tts] Starting Fish Speech API server (backend=${BACKEND})"' \
  'exec python3 tools/api_server.py \' \
  '  --listen "${API_SERVER_NAME:-0.0.0.0}:${API_SERVER_PORT:-8080}" \' \
  '  --llama-checkpoint-path "${LLAMA_CHECKPOINT_PATH}" \' \
  '  --decoder-checkpoint-path "${DECODER_CHECKPOINT_PATH}" \' \
  '  --decoder-config-name "${DECODER_CONFIG_NAME}" \' \
  '  --device "${BACKEND}" \' \
  '  --compile' \
  > /app/start_server.sh \
  && chmod +x /app/start_server.sh

EXPOSE 7860 8080

CMD ["/app/start_server.sh"]
