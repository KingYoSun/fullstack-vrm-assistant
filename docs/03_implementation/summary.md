# 実装ガイド概要

- 開発環境は `docker-compose.yml` の dev プロファイルと `Makefile` (`make dev`/`make dev-all`/`make dev-down`) を利用。初回は `cp .env.default .env` を実行してから `make dev` で backend/frontend を起動。
- Backlog: dev 用 compose / lint・test コマンドの具体値を追記予定。
- Backend 依存メモ: WebSocket 音声処理で `ffmpeg` バイナリ + `webrtcvad` + `websockets` を利用する（サーバイメージに追加が必要）。
- Frontend メモ: Vite+React+TS を `frontend/` に初期化済み。パッケージマネージャは pnpm（`pnpm install` / `pnpm dev -- --host --port 5173`）。`src/App.tsx` では WebSocket コンソールに加え、react-three-fiber + three-vrm での VRM 表示と RMS ベースのリップシンク、shadcn 風チャットログ UI を実装。依存: `three` / `@react-three/fiber` / `@react-three/drei` / `@pixiv/three-vrm`（`pnpm build` で確認済み）。
