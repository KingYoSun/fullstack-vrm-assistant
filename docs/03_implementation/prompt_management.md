# プロンプト管理（SystemPrompt / CharacterProfile）

## 概要
- システムプロンプトとキャラクター設定を PostgreSQL で管理し、LLM パイプライン（WS/Text/Diagnostics）に自動適用できる。
- active な SystemPrompt が存在すればそれを使用。未設定の場合はデフォルト文（会話調・150 字以内、要点のみ）を利用する。
- CharacterProfile は任意で付与でき、人物像と話し方のヒントをシステムプロンプトに連結する。

## API エンドポイント
- SystemPrompt: `/api/v1/system-prompts`
  - GET 一覧、POST 作成（`is_active` で適用切替）、PUT 更新、DELETE 削除、GET `/active` で active or 最新を取得。
  - タイトル重複は 409 を返す。削除で active が消えた場合は最新が自動で active になる。
- CharacterProfile: `/api/v1/characters`
  - GET 一覧、POST 作成、PUT 更新、DELETE 削除。
  - 重複タイトル（name）は 409。

## パイプラインでの適用
- WS 音声セッション: `/ws/session/{session_id}?character_id=...` で接続すると、active SystemPrompt + 指定キャラを適用。
- TextChat: `/api/v1/text-chat` の `character_id` フィールドでキャラ指定。SystemPrompt は自動で active を使用。
- Diagnostics LLM: `/api/v1/diagnostics/llm` で `character_id` を指定可能。SystemPrompt は active が使われる。
- レスポンスは 150 文字でクランプされ、ストリーミング中も超過で打ち切り。

## フロントエンド（`frontend/src/App.tsx`）
- 「Conversation Persona」パネルで CharacterProfile の CRUD + 適用。
- 同パネル内で SystemPrompt の一覧/作成/更新/削除/適用が可能。適用済みは active と表示。
- 選択したキャラ ID と active SystemPrompt を自動で WS/Diagnostics LLM リクエストへ付与。

## デフォルトシステムプロンプト
```
あなたは音声対応の VRM アシスタントです。ユーザーと自然な会話をするように口語で話し、本文は150文字以内にまとめてください。要点だけを端的に返し、一息で読み上げられる長さを維持します。提供されたコンテキストは関連する部分だけ取り込み、無い場合は簡潔に答えてください。
```
