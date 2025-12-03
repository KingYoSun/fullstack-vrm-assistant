# MVP 実装計画（会話体験成立まで）

## 目的/ゴール
- 単独ユーザーがブラウザから音声で話し、<500ms で partial STT、発話終了後 p95 2s 以内に TTS が再生開始する一連の会話体験を成立させる。
- WebSocket を介した音声/テキストのストリーミングと three-vrm の簡易リップシンク表示をデモできる状態にする。
- LLM 応答は RAG あり（簡易 FAISS インデックス）で返す。
- LLM/STT/TTS/Embedding は実プロバイダ（本番想定エンドポイント）で動作し、モックは dev 検証用のオプションにとどめる。

## 前提/制約
- docker compose ベースの dev/prod 両対応（dev も原則実プロバイダ接続、本番と同一のサービス名/ポート。GPU なし環境向けに mock/軽量モデルのプロファイルを併設）。
- Provider 設定は `config/providers.yaml` を使用（llm/stt/tts/rag/embedding）。エンドポイントは環境変数経由で実プロバイダ URL/トークンを差し込む。
- 音声: 44.1kHz/16bit → Opus 32kbps エンコード、20ms チャンク送信を標準。
- 単独ユーザー、インフラ側で認証済み、アプリはセッションID/固定トークンのみ。
- three-vrm 表示は react-three-fiber を用い、UI コンポーネントは shadcn/ui を採用する。

## スコープ
- Backend: FastAPI WebSocket/REST、会話オーケストレーション、Provider 抽象化、RAG (LangChain+FAISS)、ログ最小限。
- Frontend: マイク取得→Opus送信、TTS受信→再生、テキストログ表示、three-vrm ベースの簡易アバター＋口パク。
- DevOps: dev/prod compose に実プロバイダサービス（もしくは実サーバーへのエイリアス）を定義し、GPU リソース指定・モデル配置・シークレット管理を含めた運用手順を整備。mock/軽量モデルは別プロファイルで起動可とする。

## アウトスコープ（MVP後）
- マルチユーザー/ACL、SSO、詳細な権限管理。
- 本番レベルの監視/バックアップ/暗号化強化。
- 高度なアニメーション/表情制御、音声エフェクト、視線制御。

## フェーズ別タスク

### Phase 0: インフラ雛形
- [x] `docker-compose.dev.yml` を作成し、backend/frontend を bind mount + ホットリロードで起動できるようにする（実プロバイダ接続を基本とし、mock プロファイルは検証用に残す）。
- [x] `.env` / `.env.default` を用意し、プロバイダエンドポイントやトークンを集約。
- [x] Makefile もしくは npm scripts で dev サービス起動コマンドをラップ（例: `make dev` / `pnpm dev:docker`）。

### Phase 1: Backend スケルトン + Text Chat
- [x] FastAPI プロジェクト初期化（app/main.py, dependencies, settings）。
- [x] Provider 抽象（llm/stt/tts/rag/embedding/vector store）と DI 実装（config/providers.yaml を読む）。
- [x] Text chat REST `POST /api/v1/text-chat`（RAG + LLM ストリーム対応）を実装。
- [x] LangChain+FAISS の簡易 ingest コマンド/ジョブ（ローカルディレクトリの md/pdf を index）。
- [x] PostgreSQL 接続と会話ログの最小保存（session_id, turn_id, user_text, assistant_text, timestamps）。

### Phase 2: WebSocket 音声 I/O
- [x] WebSocket `GET /ws/session/{id}` 実装（音声チャンク、partial/final STT、LLM/TTS ストリーム、avatar_event）。
- [x] Opus 32kbps チャンク受信→PCM変換→STT パイプライン。
- [x] TTS 出力を Opus 40ms チャンクにし、キュー上限/ドロップ制御を組み込み。
- [x] Backpressure/再接続/セッションタイムアウト（無音 60s）を実装。
- [x] 設計メモ: `docs/03_implementation/phase2_websocket.md` にプロトコル/ステート/キュー方針を明記。

### Phase 3: Frontend MVP
- [x] Vite+React プロジェクト初期化（docker dev）。
- [x] マイク取得→Opus エンコード送信、TTS Opus 受信→再生（Audio/Opus ストリーム再生のたたき台）。
- [x] WebSocket プロトコル実装（partial/final transcript、assistant_text、avatar_event）。
- [x] three-vrm の簡易表示とリップシンク（音量に応じた mouth open）を react-three-fiber で実装。
- [x] テキストチャットログ UI（STT結果と LLM 応答を表示）を shadcn/ui ベースで作成。

### Phase 4: 最低限の運用性
- [x] 構造化ログ + request ID（JSON ログ + request-id コンテキスト）。主要区間レイテンシ計測（STT/LLM/TTS）。
- [x] 簡易ヘルスチェック/ready エンドポイント。
- [x] エラーフォールバック（LLM/TTS 失敗時のテンプレ応答/テキスト提示）。

## 実運用レベルへの残タスク（追加で対応が必要な項目）
- [x] docker compose を実プロバイダ構成に更新: `docker-compose.yml` を NIM Qwen3-32B / whisper.cpp / Open Audio S1 (Fish Speech) / llama.cpp embedding（CUDA13, aarch64, SM12.1）前提にし、GPU `deploy.resources.reservations`・モデルボリューム・ヘルスチェックを定義。モックは `profile=mock` として分離。
- [x] `config/providers.yaml` を本番想定値で再定義: 環境変数プレースホルダ化し、`.env.default` に各キー/パラメータを追加。`load_providers_config` で未解決プレースホルダを検出するように変更。
- [x] プロバイダランタイムの用意: `docs/03_implementation/production_runtime.md` に Qwen3 NIM / whisper.cpp / Open Audio S1 / llama.cpp embedding のモデル取得と起動手順を記載。
- [x] RAG/Embedding パイプラインの整合性確認: ingest ジョブを `/data` へ書き出す手順を文書化し、実 Embedding API 接続前提のコマンドを提示。
- [ ] 本番相当のレイテンシ計測: 実プロバイダ接続で `partial`/`final`/`tts_start` の p95 を 10〜20 サンプル計測し、`docs/01_project/tasks/status/in_progress.md` の確認タスクを埋める（手順は `production_runtime.md` に追記済み、実測は未実施）。
- [x] フォールバック検出の強化: `/health` `/ready` で `is_mock`/`fallback_count` を返却し、検知時は `warnings` 付きで `status=degraded` とする。
- [x] 運用手順の追加: GPU 目安・ログ/メトリクス・ロールバック方針を `docs/03_implementation/production_runtime.md` に集約。

## 受け入れ基準 (MVP)
- ブラウザで音声入力→画面で partial transcript (<0.5s p95) が見える。
- 発話停止後、LLM 応答が 2s p95 以内に音声再生開始。
- three-vrm が表示され、音声再生中に口パクが動く。
- RAG: ローカルで ingest した文書を元に LLM が回答（簡易で可）。
- `COMPOSE_PROFILES=dev|prod docker compose up` で一発起動し、接続先エンドポイントは `config/providers.yaml` から解決。
- LLM/STT/TTS/Embedding は実プロバイダ接続で正常に応答し、通常経路でフォールバックが発火しない。

## リスク/課題メモ
- GPU 非搭載環境での dev: STT/TTS をモックまたは軽量モデルに差し替える選択肢を残す。
- Opus エンコード/デコードのブラウザ互換性（WebCodecs/AudioWorklet）の実装コスト。
- LLM レイテンシ: Qwen3-32B が重い場合の代替モデル/パラメータ調整が必要。
- モデル配布とライセンス: Qwen3 / Open Audio S1 / whisper.cpp のモデル取得・配布条件を満たす運用フローが必要。
