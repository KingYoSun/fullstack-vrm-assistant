# 実装ガイド概要

- 開発環境は `docker-compose.dev.yml` と `Makefile` (`make dev`/`make dev-all`/`make dev-down`) を利用。初回は `cp .env.default .env` を実行してから `make dev` で backend/frontend を起動。
- Backlog: dev 用 compose / lint・test コマンドの具体値を追記予定。
- Backend 依存メモ: WebSocket 音声処理で `ffmpeg` バイナリ + `webrtcvad` + `websockets` を利用する（サーバイメージに追加が必要）。
- Frontend メモ: Vite+React+TS を `frontend/` に初期化済み。パッケージマネージャは pnpm（`pnpm install` / `pnpm dev -- --host --port 5173`）。`src/App.tsx` に WebSocket コンソールを実装し、partial/final transcript/llm_token/tts_chunk/avatar_event の受信・ログ表示、`ping/flush/resume` 送信、マイク録音→WebM(Opus) 送信、受信 TTS をまとめて再生するたたき台を用意。
