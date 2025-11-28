# MVP 実装計画（会話体験成立まで）

## 目的/ゴール
- 単独ユーザーがブラウザから音声で話し、<500ms で partial STT、発話終了後 p95 2s 以内に TTS が再生開始する一連の会話体験を成立させる。
- WebSocket を介した音声/テキストのストリーミングと three-vrm の簡易リップシンク表示をデモできる状態にする。
- LLM 応答は RAG あり（簡易 FAISS インデックス）で返す。

## 前提/制約
- docker compose ベースの dev/prod 両対応（dev はソース bind mount + ホットリロード）。
- Provider 設定は `config/providers.yaml` を使用（llm/stt/tts/rag/embedding）。
- 音声: 44.1kHz/16bit → Opus 32kbps エンコード、20ms チャンク送信を標準。
- 単独ユーザー、インフラ側で認証済み、アプリはセッションID/固定トークンのみ。
- three-vrm 表示は react-three-fiber を用い、UI コンポーネントは shadcn/ui を採用する。

## スコープ
- Backend: FastAPI WebSocket/REST、会話オーケストレーション、Provider 抽象化、RAG (LangChain+FAISS)、ログ最小限。
- Frontend: マイク取得→Opus送信、TTS受信→再生、テキストログ表示、three-vrm ベースの簡易アバター＋口パク。
- DevOps: dev 用 compose（GPU なしでも STT/TTS をモック/軽量化できるようにする）、prod サンプル compose。

## アウトスコープ（MVP後）
- マルチユーザー/ACL、SSO、詳細な権限管理。
- 本番レベルの監視/バックアップ/暗号化強化。
- 高度なアニメーション/表情制御、音声エフェクト、視線制御。

## フェーズ別タスク

### Phase 0: インフラ雛形
- [x] `docker-compose.dev.yml` を作成し、backend/frontend を bind mount + ホットリロードで起動できるようにする（llm/stt/tts は一旦モック可）。
- [x] `.env` / `.env.default` を用意し、プロバイダエンドポイントやトークンを集約。
- [x] Makefile もしくは npm scripts で dev サービス起動コマンドをラップ（例: `make dev` / `pnpm dev:docker`）。

### Phase 1: Backend スケルトン + Text Chat
- [x] FastAPI プロジェクト初期化（app/main.py, dependencies, settings）。
- [x] Provider 抽象（llm/stt/tts/rag/embedding/vector store）と DI 実装（config/providers.yaml を読む）。
- [x] Text chat REST `POST /api/v1/text-chat`（RAG + LLM ストリーム対応）を実装。
- [x] LangChain+FAISS の簡易 ingest コマンド/ジョブ（ローカルディレクトリの md/pdf を index）。
- [x] PostgreSQL 接続と会話ログの最小保存（session_id, turn_id, user_text, assistant_text, timestamps）。

### Phase 2: WebSocket 音声 I/O
- [ ] WebSocket `GET /ws/session/{id}` 実装（音声チャンク、partial/final STT、LLM/TTS ストリーム、avatar_event）。
- [ ] Opus 32kbps チャンク受信→PCM変換→STT パイプライン。
- [ ] TTS 出力を Opus 40ms チャンクにし、キュー上限/ドロップ制御を組み込み。
- [ ] Backpressure/再接続/セッションタイムアウト（無音 60s）を実装。

### Phase 3: Frontend MVP
- [ ] Vite+React プロジェクト初期化（docker dev）。
- [ ] マイク取得→Opus エンコード送信、TTS Opus 受信→再生。
- [ ] WebSocket プロトコル実装（partial/final transcript、assistant_text、avatar_event）。
- [ ] three-vrm の簡易表示とリップシンク（音量に応じた mouth open）を react-three-fiber で実装。
- [ ] テキストチャットログ UI（STT結果と LLM 応答を表示）を shadcn/ui ベースで作成。

### Phase 4: 最低限の運用性
- [ ] 構造化ログ + request ID。主要区間レイテンシ計測（STT/LLM/TTS）。
- [ ] 簡易ヘルスチェック/ready エンドポイント。
- [ ] エラーフォールバック（LLM/TTS 失敗時のテンプレ応答/テキスト提示）。

## 受け入れ基準 (MVP)
- ブラウザで音声入力→画面で partial transcript (<0.5s p95) が見える。
- 発話停止後、LLM 応答が 2s p95 以内に音声再生開始。
- three-vrm が表示され、音声再生中に口パクが動く。
- RAG: ローカルで ingest した文書を元に LLM が回答（簡易で可）。
- `docker compose up`（dev/prod）で一発起動し、接続先エンドポイントは `config/providers.yaml` から解決。

## リスク/課題メモ
- GPU 非搭載環境での dev: STT/TTS をモックまたは軽量モデルに差し替える選択肢を残す。
- Opus エンコード/デコードのブラウザ互換性（WebCodecs/AudioWorklet）の実装コスト。
- LLM レイテンシ: gpt-oss-120b が重い場合の代替モデル/パラメータ調整が必要。
