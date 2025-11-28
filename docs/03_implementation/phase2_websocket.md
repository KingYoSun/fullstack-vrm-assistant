# Phase 2: WebSocket 音声 I/O 設計メモ

## ゴール
- `GET /ws/session/{id}` でブラウザとの双方向ストリーミングを確立し、20ms Opus チャンク入力→partial/final STT→LLM→TTS→Opus 出力のループを実現する。
- 無音 60s タイムアウト、再接続時のセッション継続可否、キュー上限による backpressure 制御を組み込む。

## エンドポイント仕様（案）
- URL: `/ws/session/{session_id}`
- プロトコル: WebSocket
- 認証: Phase 1 と同様に固定トークン/セッションID 前提。必要ならヘッダ `X-Session-Token` で拡張。
- 入力チャネル: バイナリフレームで Opus 32kbps, 20ms チャンク（44100Hz/16bit ソース）。
- 出力チャネル: JSON テキスト + Opus バイナリ。音声出力は Opus 40ms チャンク。テキスト系は JSON 文字列フレーム。

## サーバ→クライアント メッセージ種別（JSON）
- `partial_transcript`: `{ "type": "partial_transcript", "session_id": "...", "turn_id": "...", "text": "...", "timestamp": 123.45 }`
- `final_transcript`: `{ "type": "final_transcript", "session_id": "...", "turn_id": "...", "text": "...", "timestamp": 123.45 }`
- `llm_token`: `{ "type": "llm_token", "session_id": "...", "turn_id": "...", "token": "..." }`
- `llm_done`: `{ "type": "llm_done", "session_id": "...", "turn_id": "...", "assistant_text": "...", "used_context": "...", "timestamp": 123.45 }`
- `tts_chunk`: バイナリ（Opus）。メタデータ付きの JSON を先行送信する場合は `tts_start`, `tts_end` を追加。
- `avatar_event`: `{ "type": "avatar_event", "session_id": "...", "turn_id": "...", "mouth_open": 0.0~1.0, "timestamp": 123.45 }`
- `error`: `{ "type": "error", "message": "...", "recoverable": true/false }`
- `ping`: `{ "type": "ping" }` / `pong`: `{ "type": "pong" }`

## クライアント→サーバ メッセージ種別
- 音声チャンク: バイナリ（Opus 20ms）。
- `control`: JSON 文字列。例:
  - `{"type": "flush"}`: 現在の発話を確定（VAD 無しで明示的に区切る）。
  - `{"type": "resume"}`: 無音解除や再開指示。
  - `{"type": "ping"}`: レイテンシ計測用。

## ステートマシン（概要）
1. `connected` → `ready`（セッション ID バリデーション）
2. `listening`: 音声チャンク蓄積しつつ VAD で発話境界検出。`partial_transcript` を随時送信。
3. `recognizing`: 発話終了で `final_transcript`。音声バッファを STT へ送信。
4. `responding`: RAG + LLM ストリームを `llm_token`/`llm_done` で送信し、TTS 変換して `tts_chunk` を送出。
5. `idle`: 出力完了後に次の発話を待つ。無音 60s で `timeout` → セッション終了。

## backpressure / キュー制御
- 入力キュー: 音声チャンクキュー上限（例: 3秒相当）。超過時は古いチャンクをドロップし `error` 通知（recoverable=true）。
+- 出力キュー: TTS チャンクキュー上限（例: 2秒相当）。キュー溢れ時は後続をドロップし `avatar_event` で mouth_open=0 を送信してクローズ。
- WebSocket 送信が詰まる場合は `await websocket.close(code=1011, reason="backpressure")`。

## 実装タスク分解（Phase 2）
1. ルーター/依存: `/ws/session/{id}` エンドポイント追加（FastAPI WebSocket + lifespan コンテナ共有）。
2. 音声パイプライン: Opus→PCM 変換（ffmpeg/pyogg など）、VAD で 20ms チャンク境界判定、STT ストリーミング（partial/final）。
3. 応答パイプライン: RAG + LLM ストリームを流用し、TTS を Opus 40ms チャンクで生成・送出。音量に応じて `avatar_event` 生成。
4. セッション管理: 無音タイマー、再接続時の turn_id 生成ポリシー、エラーハンドリング（recoverable と fatal を分離）。
5. テレメトリ: STT/LLM/TTS 区間の計測と構造化ログ。

## 動作確認のたたき台
```bash
# backend (dev) を起動済みとする
curl -s http://localhost:8000/health
curl -s -N -X POST http://localhost:8000/api/v1/text-chat \
  -H 'Content-Type: application/json' \
  -d '{"session_id":"sess-ws-dryrun","user_text":"音声WS設計を確認したい"}'

# ingest （必要に応じて）
docker compose -f docker-compose.dev.yml --profile dev run --rm \
  -v $(pwd)/docs:/workspace/docs backend \
  sh -c "cd /workspace/backend && python -m app.cli.ingest --source /workspace/docs --index /data/faiss/index.bin"
```
