#!/usr/bin/env bash
set -e

# 必須: モデルパス（コンテナ内）
: "${LLAMA_MODEL:?LLAMA_MODEL env var must point to a .gguf embedding model (inside /models)}"

PORT="${LLAMA_PORT:-8021}"
PARALLEL="${LLAMA_PARALLEL:-4}"
UBATCH="${LLAMA_UBATCH:-1024}"
NGPU="${LLAMA_NGPU:-999}"        # 事実上「全部 GPU に載せる」
POOLING="${LLAMA_POOLING:-mean}" # embedding モデルに合わせて last / cls などに変更可

cd /opt/llama.cpp

exec ./build/bin/llama-server \
  -m "${LLAMA_MODEL}" \
  --embeddings \
  --host 0.0.0.0 \
  --port "${PORT}" \
  --n-gpu-layers "${NGPU}" \
  --ubatch-size "${UBATCH}" \
  --parallel "${PARALLEL}" \
  --pooling "${POOLING}"
