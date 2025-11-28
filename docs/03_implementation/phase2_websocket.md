# Phase 2: WebSocket 音声 I/O 設計メモ

## ゴール
- `GET /ws/session/{id}` でブラウザとの双方向ストリーミングを確立し、20ms Opus チャンク入力→partial/final STT→LLM→TTS→Opus 出力のループを実現する。
- 無音 60s タイムアウト、再接続時のセッション継続可否、キュー上限による backpressure 制御を組み込む。

## エンドポイント仕様（案）
- URL: `/ws/session/{session_id}`
- プロトコル: WebSocket
- 認証: Phase 1 と同様に固定トークン/セッションID 前提。必要ならヘッダ `X-Session-Token` で拡張。
- 初期ハンドシェイク: `session_id` 検証後に `ready` ステートへ。10s 間隔で `ping/pong` を開始。
- 入力チャネル: バイナリフレームで Opus 32kbps, 20ms チャンク（44100Hz/16bit ソース）。サーバ側で 16k mono PCM へ変換。
- 出力チャネル: JSON テキスト + Opus バイナリ。音声出力は Opus 40ms チャンク。音声再生開始/終了を `tts_start`/`tts_end` で明示。

## サーバ→クライアント メッセージ種別（JSON）
- `partial_transcript`: `{ "type": "partial_transcript", "session_id": "...", "turn_id": "...", "text": "...", "timestamp": 123.45 }`
- `final_transcript`: `{ "type": "final_transcript", "session_id": "...", "turn_id": "...", "text": "...", "timestamp": 123.45 }`
- `llm_token`: `{ "type": "llm_token", "session_id": "...", "turn_id": "...", "token": "..." }`
- `llm_done`: `{ "type": "llm_done", "session_id": "...", "turn_id": "...", "assistant_text": "...", "used_context": "...", "timestamp": 123.45 }`
- `tts_start`: `{ "type": "tts_start", "session_id": "...", "turn_id": "...", "sample_rate": 16000, "channels": 1, "chunk_ms": 40 }`
- `tts_chunk`: バイナリ（Opus）。`tts_start` に続けて送出。
- `tts_end`: `{ "type": "tts_end", "session_id": "...", "turn_id": "...", "timestamp": 123.45 }`
- `avatar_event`: `{ "type": "avatar_event", "session_id": "...", "turn_id": "...", "mouth_open": 0.0~1.0, "timestamp": 123.45 }`
- `error`: `{ "type": "error", "message": "...", "recoverable": true/false }`
- `ping`: `{ "type": "ping" }` / `pong`: `{ "type": "pong" }`

## クライアント→サーバ メッセージ種別
- 音声チャンク: バイナリ（Opus 20ms）。
- `control`: JSON 文字列。例:
  - `{"type": "flush"}`: 現在の発話を確定（VAD 無しで明示的に区切る）。
  - `{"type": "resume"}`: 無音解除や再開指示。
  - `{"type": "ping"}`: レイテンシ計測用。

## メッセージフロー（概要）
1. 接続/認証: クライアントが接続し、`session_id` バリデーション後に `ready` ステートへ。10s ごとの `ping/pong` を開始。
2. 入力ストリーム: クライアントは 20ms Opus チャンクを送信。サーバはリングバッファへ積み、デコード→16k PCM へ変換。
3. STT: 20ms 単位で `webrtcvad` などで VAD 判定。発話中は連結した PCM を STT ストリームへ送りつつ `partial_transcript` を返却。
4. 発話区切り: 無音や `flush` で turn を確定し、`final_transcript` を送信。STT の結果を LLM/RAG に渡し `responding` へ。
5. LLM/TTS: LLM トークンを `llm_token` で逐次返し、最終結果を `llm_done`。同時に TTS を 40ms Opus チャンクにし、`tts_start` → `tts_chunk` → `tts_end`。音量エンベロープから `avatar_event` を数百 ms 間隔で送信。
6. Idle/再開: 出力が終われば `idle`。次の音声が来れば `listening` に戻る。無音 60s で `timeout` を送信し、クローズ。

## ステートマシン（概要）
1. `connected` → `ready`（セッション ID バリデーション）
2. `listening`: 音声チャンク蓄積しつつ VAD で発話境界検出。`partial_transcript` を随時送信。
3. `recognizing`: 発話終了で `final_transcript`。音声バッファを STT へ送信し、turn_id を確定。
4. `responding`: RAG + LLM ストリームを `llm_token`/`llm_done` で送信し、TTS 変換して `tts_chunk` を送出。音声キュー詰まり時は `backpressure` に遷移。
5. `idle`: 出力完了後に次の発話を待つ。無音 60s で `timeout` → セッション終了。再接続時は `ready` で既存 session_id を検証し、最新 turn_id+1 から再開。

## backpressure / キュー制御
- 入力キュー: 音声チャンクキュー上限（例: 3秒相当）。超過時は古いチャンクをドロップし `error` 通知（recoverable=true）を送る。
- 出力キュー: TTS チャンクキュー上限（例: 2秒相当）。キュー溢れ時は後続をドロップし `avatar_event` で mouth_open=0 を送信してクローズ。音声開始前にバッファ長を `tts_start` で送信し、再生側でドロップ判定を容易にする。
- WebSocket 送信が詰まる場合は `await websocket.close(code=1011, reason="backpressure")`。クライアントは再接続時に `offset_turn_id` を送れば復帰可能とする。

## 実装タスク分解（Phase 2）
※ 実装完了済み。後続フェーズはこの仕様を前提にフロントエンド/テストを進める。
1. ルーター/依存: `/ws/session/{id}` エンドポイント追加（FastAPI WebSocket + lifespan コンテナ共有）。
2. 音声パイプライン: Opus→PCM 変換（ffmpeg/pyogg など）、VAD で 20ms チャンク境界判定、STT ストリーミング（partial/final）。
3. 応答パイプライン: RAG + LLM ストリームを流用し、TTS を Opus 40ms チャンクで生成・送出。音量に応じて `avatar_event` 生成。
4. セッション管理: 無音タイマー、再接続時の turn_id 生成ポリシー、エラーハンドリング（recoverable と fatal を分離）。
5. テレメトリ: STT/LLM/TTS 区間の計測と構造化ログ。

## 実装メモ/依存ライブラリ候補
- デコード: `ffmpeg` CLI で Opus → PCM 16k mono にデコード（無い場合は入力を PCM とみなすフォールバック）。
- VAD: `webrtcvad` を採用。無音検出間隔 20ms、連続無音が `silence_flush_ms`（デフォルト600ms）を超えたら turn を区切る。
- STT: 既存 Provider 抽象にストリーミング STT クライアントを追加。partial ごとにキャンセル/flush API を用意。
- TTS: 40ms Opus チャンク生成時に音量 RMS を取り `avatar_event` を 200ms ピッチで送信。
- テレメトリ: `structlog` で `session_id`, `turn_id`, `latency_stt_ms`, `latency_llm_ms`, `latency_tts_ms` を記録。`prometheus` 用メトリクスは Phase 4 で拡張。

### 実装状況（2025-11-28）
- WebSocket セッションは Opus バイナリを受け取り、`ffmpeg` で PCM 変換→`webrtcvad` で無音検出し、`silence_flush_ms`/バックログで turn を確定。
- STT クライアントは HTTP/WS をサポートし、失敗時はモック文字列を返すフォールバックを備える。
- TTS クライアントは HTTP ストリーミング＋フォールバックのサイレント音声を返し、`tts_start`/`tts_end` と RMS ベースの `avatar_event` を送出。

## 再接続とタイムアウトの扱い
- 無音 60s で `timeout` を送り、サーバ側はセッションコンテキストを閉じる。
- クライアント再接続時は `session_id`, `last_turn_id` をクエリ/ヘッダで渡し、`ready` ハンドシェイクで復帰。復帰不可なら `error`（recoverable=false）を返してクローズ。
- 送信中に backpressure で落ちた場合は `backpressure` コードでクローズし、クライアントは未完了 turn を UI にマーク。

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
