#!/usr/bin/env bash
set -euo pipefail

PORT="${STT_PORT:-6006}"
MODEL_DIR="${STT_MODEL_DIR:-/models}"
TOKENS="${STT_TOKENS:-${MODEL_DIR}/tokens.txt}"
ENCODER="${STT_ENCODER:-${MODEL_DIR}/encoder.onnx}"
DECODER="${STT_DECODER:-${MODEL_DIR}/decoder.onnx}"
JOINER="${STT_JOINER:-${MODEL_DIR}/joiner.onnx}"
PROVIDER="${STT_PROVIDER_RUNTIME:-cpu}"

DEFAULT_CMD=(python3 -m sherpa_onnx.python_api.offline_websocket_server
  --port "${PORT}"
  --tokens "${TOKENS}"
  --encoder-onnx "${ENCODER}"
  --decoder-onnx "${DECODER}"
  --joiner-onnx "${JOINER}"
  --provider "${PROVIDER}"
  --max-batch-size "${STT_MAX_BATCH_SIZE:-8}"
  --num-threads "${STT_NUM_THREADS:-4}"
)

if [[ -n "${STT_COMMAND:-}" ]]; then
  echo "[stt] Using custom STT_COMMAND"
  exec bash -lc "${STT_COMMAND}"
else
  echo "[stt] Starting sherpa-onnx websocket server on port ${PORT} (provider=${PROVIDER})"
  exec "${DEFAULT_CMD[@]}"
fi
