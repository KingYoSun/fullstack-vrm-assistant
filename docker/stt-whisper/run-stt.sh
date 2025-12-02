#!/usr/bin/env bash
set -e

: "${WHISPER_MODEL:?WHISPER_MODEL must point to a ggml/GGUF Whisper model inside /models}"

PORT="${WHISPER_PORT:-8025}"
THREADS="${WHISPER_THREADS:-8}"
LANG="${WHISPER_LANG:-auto}"

cd /opt/whisper.cpp

if [ -x "./build/bin/whisper-server" ]; then
  SERVER_BIN="./build/bin/whisper-server"
else
  echo "whisper-server binary not found under /opt/whisper.cpp/build/bin" >&2
  ls -R .
  exit 1
fi

exec "${SERVER_BIN}" \
  -m "${WHISPER_MODEL}" \
  --host 0.0.0.0 \
  --port "${PORT}" \
  --threads "${THREADS}" \
  --language "${LANG}" \
  --convert
