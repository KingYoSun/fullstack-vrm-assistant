# Repository Guidelines

## プロジェクト構成
- `docs/`: 設計・実装ガイド、API JSONは`docs/apis/`

## ビルド・テスト・開発

## コーディング規約

## テスト指針

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
- 開始時: `tasks/priority/critical.md` から対象を選び、`tasks/status/in_progress.md` に移動して着手を明示。
- 作業中: 原則 `tasks/status/in_progress.md` のみを更新（進捗/メモ）。他ファイルは必要時のみ編集。
- 完了時: `tasks/completed/YYYY-MM-DD.md` に完了内容を追記し、`in_progress.md` から削除。重要な変更は進捗レポートを作成。
- ブロッカー: 発生時は `tasks/context/blockers.md` に追記し、解決後は削除。

### 作業完了チェックリスト
- [ ] `tasks/completed/YYYY-MM-DD.md` に完了タスクを追記
- [ ] `tasks/status/in_progress.md` から当該タスクを削除
- [ ] 重要な変更について進捗レポートを作成

## ドキュメント構成/配置
- 優先参照順: `docs/SUMMARY.md` → `docs/01_project/activeContext/` → 各ディレクトリの `summary.md` → 詳細ドキュメント。
- すべてのドキュメントは `./docs/` 以下に配置（`kukuri-tauri/docs/` などのサブディレクトリは作成しない）。
- 進捗レポート: `docs/01_project/progressReports/`
- 実装ガイド: `docs/03_implementation/`
- アーキテクチャ: `docs/02_architecture/`

## プロジェクト概要/技術スタック

## アーキテクチャ（レイヤー）

## 追加コマンド備考
