# Repository Guidelines

## プロジェクト構成
- `docs/`: 設計・実装ガイド

## ビルド・テスト・開発
- 現状: 設計フェーズ。実装後はこの節を最新の実コマンドに合わせて都度更新する。
- Backend (FastAPI想定)
  - 依存: Python 3.12 系を想定。
  - ローカル開発: docker compose（dev プロファイル）で起動し、ソースを bind mount してホットリロードする。ホストでの直接起動は避ける。例: `COMPOSE_PROFILES=dev docker compose up backend-dev`。
- Frontend (Vite + React + TypeScript 想定)
  - 依存: Node.js LTS (推奨: 20.x)。パッケージマネージャは `pnpm` を第一候補（未決なら `npm` でも可、統一する）。
  - ローカル開発: docker compose（dev プロファイル）でフロントエンドコンテナを起動し、`pnpm dev -- --host` をコンテナ内で実行。ホストでの直接起動は避ける。例: `COMPOSE_PROFILES=dev docker compose up frontend-dev`。
- コンテナ起動: `COMPOSE_PROFILES=prod docker compose up -d` を最終形とし、GPU は `runtime: nvidia` + `device_requests` で割り当てる。
- 依存追加時は README/ドキュメントに反映し、ロックファイルを必ず更新する。

## コーディング規約
- 言語: Python, TypeScript/React を主とする。
- Python: 型ヒント必須（`mypy --strict` を通す前提で記述）。非同期 I/O 優先（FastAPIは async/await）。
- TypeScript: `strict` モードを前提。コンポーネントは関数コンポーネント + Hooks で記述。
- スタイル: フォーマッタ（Python: `ruff format` or `black`; TS: `prettier`）を導入後は必ず適用。Lint は CI でブロックする。
- コメント: 意図や前提条件が読み取りにくい箇所のみ短く補足。冗長なコメントは避ける。

## テスト指針
- 実装後は以下を基本とする（コマンドは導入時に確定させ、この節を更新する）。
- Python: `pytest` + `pytest-asyncio`。FastAPI エンドポイントは `httpx.AsyncClient` でカバレッジ。
- TypeScript: `vitest` または `jest`（Vite なら vitest を第一候補）。フロントのユニット/ロジックを優先、必要ならコンポーネントのスナップショット/DOMテストも追加。
- E2E: Playwright を検討。音声ストリーミングはモック/録音ファイルで再現し、WebSocket レイテンシの計測を組み込む。
- CI: Lint → Unit Test → E2E（任意）→ ビルドの順でジョブを構成。失敗時はログを必ず共有。

## コミット/PR
- Conventional Commits推奨: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`
- PRに含める: 要約、根拠/設計意図、再現/確認手順、関連Issue、UI変更はスクリーンショット
- 無関係な整形・リファクタは分離。サブモジュールは`git submodule update --init --recursive`

## エージェント運用ルール（Codex CLI）
- 作業開始前チェック: 
- 言語: 回答・記述は日本語で統一。
- ツール: GitHub操作は `gh`、JSONの調査/整形は `jq`。
- コミット: ユーザーから明示的に要求されない限り、絶対にコミットしない。
- DRY原則: 新規クラス/メソッド/型の実装前に既存の重複機能がないか調査。
- 依存追加: 追加時は最新安定版を確認して採用。
- 検証必須: テスト・型・リント修正タスクは、実際にコマンドを実行しエラーが出ないことを確認してから完了とする。
- 日付記法: ドキュメント内の日付は `date "+%Y年%m月%d日"` の出力を使用。

## タスク管理ルール
- 開始時: `docs/01_project/tasks/priority/critical.md` から対象を選び、`docs/01_project/tasks/status/in_progress.md` に移動して着手を明示。
- 作業中: 原則 `docs/01_project/tasks/status/in_progress.md` のみを更新（進捗/メモ）。他ファイルは必要時のみ編集。
- 完了時: `docs/01_project/tasks/completed/YYYY-MM-DD.md` に完了内容を追記し、`in_progress.md` から削除。重要な変更は進捗レポートを作成。
- ブロッカー: 発生時は `docs/01_project/tasks/context/blockers.md` に追記し、解決後は削除。

### 作業完了チェックリスト
- [ ] `tasks/completed/YYYY-MM-DD.md` に完了タスクを追記
- [ ] `tasks/status/in_progress.md` から当該タスクを削除
- [ ] 重要な変更について進捗レポートを作成

## ドキュメント構成/配置
- 優先参照順: `docs/SUMMARY.md` → `docs/01_project/activeContext/` → 各ディレクトリの `summary.md` → 詳細ドキュメント。
- すべてのドキュメントは `./docs/` 以下に配置
- 進捗レポート: `docs/01_project/progressReports/`
- 実装ガイド: `docs/03_implementation/`
- アーキテクチャ: `docs/02_architecture/`

## プロジェクト概要/技術スタック
- 概要: DGX Spark 1台で完結する音声対話型 3D アバター秘書。three-vrm でアバター表示、音声は STT→RAG→LLM→TTS のストリーム。
- 技術スタック: FastAPI / LangChain / FAISS / gpt-oss-120b / sherpa-onnx / Open Audio S1 / Vite + React + TypeScript + three-vrm / Docker Compose。

## アーキテクチャ（レイヤー）
- Presentation: Frontend (Vite+React+three-vrm)、音声キャプチャ/再生、アバター制御。
- API/Orchestration: FastAPI (WebSocket/REST)、セッション管理、会話オーケストレーション。
- AI Providers: LLM/STT/TTS/Embedding/VectorStore の抽象化レイヤー、`config/providers.yaml` で差し替え。
- Data: PostgreSQL (会話ログ/設定)、FAISS (ベクタストア)、Redis (任意でセッション/キュー)。

## 追加コマンド備考
- JSON の調査/整形は `jq` を使用。GitHub 操作は `gh` を使用。
- 音声・WebSocketの検証時は `websocat` や `ffmpeg` で録音/送信を行うと再現しやすい（導入は任意）。
- GPU を使う docker compose 実行例: `docker compose --profile gpu up -d`（プロファイル導入時）。NVIDIA 環境変数やドライババージョンに留意。
