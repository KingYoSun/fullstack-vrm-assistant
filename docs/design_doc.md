# フルスタックAI秘書アプリケーション Design Doc（案）

* 対象HW: DGX Spark 1台（複数GPU想定）
* 主な技術スタック

  * LLM: gpt-oss-120b
  * RAG: LangChain + FAISS
  * STT: sherpa-onnx (+ reazon speech)
  * TTS: Open Audio S1 (Fish Audio)
  * Backend: FastAPI
  * Frontend: Vite + React + TypeScript + three-vrm
  * コンテナオーケストレーション: Docker Compose（一発起動）

---

## 1. 目的・スコープ

音声で会話できる「3D人型キャラクターのAI秘書」を、DGX Spark 1台上に完結して構築する。
要件として、

1. **docker compose で一発起動**できること
2. **LLM・RAG・TTS・STT の接続をモジュール化**し、後からモデル/ホスティングを差し替え可能にすること
3. **主要UIは three-vrm の3D人型キャラクター**であること

を満たすアーキテクチャ/設計を定義する。

---

## 2. 要求整理

### 2.1 機能要件（概要）

* 音声対話

  * ユーザーのマイク音声から STT でテキスト化
  * テキストを RAG + LLM で処理し、自然な応答テキストを生成
  * 応答テキストを TTS で音声合成し、ブラウザ側で再生
* 3Dキャラクター UI

  * three-vrm による 3D 人型キャラクター表示
  * 会話に合わせた口パク（リップシンク）、表情、簡易ジェスチャ
* 会話履歴・ナレッジ

  * 会話ログ保存（少なくともセッション単位）
  * ドキュメントを取り込み、FAISSにインデックスしてRAGで利用
* マルチモーダル I/O（将来）

  * テキストチャットUIも用意し、音声が使えない環境でも利用可能にする
* セキュリティ・運用前提

  * 単独ユーザー利用を想定し、認証はインフラ側（リバプロ等）で実施
  * アプリ側はセッションID/固定トークンのみで認可を簡素化
  * CORS はフロントと同一オリジン前提、CSRF は限定オリジンのみ許可
  * PII を含むデータを永続保存（ユーザー操作がない限り削除しない）

### 2.2 非機能要件（概要）

* レイテンシ

  * STT 部分：発話中に 500ms 以内の partial transcript を返す
  * 応答：発話終了から 2 秒以内に TTS 再生開始（p95 目標）
* 同時接続数

  * 初期目標：数セッション〜十数セッション程度（社内PoC想定）
* 可搬性・拡張性

  * LLM・STT・TTS・RAG を **インターフェースレベルで抽象化**
  * ローカルモデル → クラウドAPIへの切り替え等が、**設定変更だけ**で可能
* デプロイ

  * `docker compose up` だけで、全てのサービスが起動し疎通する

---

## 3. 全体アーキテクチャ概要

### 3.1 コンポーネント構成

論理コンポーネントは以下とする：

1. **Frontend (Vite + React + three-vrm)**

   * 3D アバター表示
   * 音声キャプチャ & 再生
   * WebSocket で backend とストリーミング通信

2. **Conversation Orchestrator (FastAPI)**

   * WebSocket エンドポイント
   * 会話オーケストレーション
   * STT / RAG / LLM / TTS の各 Provider を呼び出し

3. **LLM Service**

   * gpt-oss-120b をホスト（例: vLLM / DeepSpeed-Inference 等の実装は任意）
   * HTTP / gRPC ベースの Chat Completion API を提供
   * 将来的に別LLMサーバ（例: クラウドAPI）に置き換え可能な形

4. **RAG / Vector Store**

   * LangChain を用いたドキュメント ingestion / retrieval
   * Vector DB は FAISS を採用（ローカルファイル + ボリューム）
   * Embedding モデルは抽象化（差し替え可）

5. **STT Service (sherpa-onnx + reazon speech)**

   * ストリーミング音声認識
   * reazon speech による VAD / セグメンテーション（構成に応じて）

6. **TTS Service (Open Audio S1)**

   * テキストから音声をストリーミング生成
   * 複数 voice / style の切り替え（設定から制御）

7. **共通インフラ**

   * 永続DB（会話ログ・ユーザー設定など、PostgreSQL想定）
   * Redis（セッション状態・キュー）※必須ではないが推奨
   * ログ/メトリクス（Prometheus + Grafana など、ここでは概念レベル）

### 3.2 データフロー（高レベル）

1. ユーザーがブラウザで 3D キャラ画面を開く
2. ブラウザが `WebSocket (wss://backend/ws/session/{id})` を開く
3. ブラウザがマイク音声を 44.1kHz 16bit で取得し、Opus 32kbps にエンコードしてストリーミング送信（帯域を抑えつつ遅延を確保）
4. Orchestrator が STT Provider 経由で partial / final transcript を取得
5. final transcript をトリガとして、RAG → LLM で応答テキストを生成
6. 応答テキストを TTS Provider に渡し、音声ストリーミングを取得
7. 音声チャンクが WebSocket でブラウザに送信され、再生 & アバターリップシンク
8. 同時に、会話ログとRAG用メタデータをDB/FAISSに保存

---

## 4. バックエンド設計（FastAPI Orchestrator）

### 4.1 サービス構成

* アプリケーションレイヤ

  * WebSocket / REST API
  * セッション管理
  * 会話オーケストレーション
* ドメインサービス

  * `ConversationService`
  * `RagService`（LangChain を利用）
* AI Provider インターフェース層

  * `LlmProvider` / `SttProvider` / `TtsProvider` / `EmbeddingProvider` / `VectorStoreProvider`

#### 4.1.1 データモデル（例）

* 会話ログ: `conversations(session_id, turn_id, user_text, assistant_text, user_audio_ref, assistant_audio_ref, created_at, summary_flag)`
* ドキュメントメタ: `documents(doc_id, source, hash, embedding_version, pii_flag, owner_scope='self', created_at, updated_at)`

永続保存をデフォルトとし、ユーザー操作がない限り削除しない。サマライズ運用を行う場合も原文を保持する想定（追加要件が生じたら再検討）。

### 4.2 主なエンドポイント

#### WebSocket

* `GET /ws/session/{session_id}`

  * 双方向ストリーミング
  * クライアント → サーバー:

    * `audio_chunk` (binary)
    * `control` (JSON: start/stop, settings)
  * サーバー → クライアント:

    * `transcript_partial` / `transcript_final`
    * `assistant_text_partial` / `assistant_text_final`
    * `assistant_audio_chunk` (binary)
    * アバター制御用イベント `avatar_event`（emotion, gestureなど）

#### REST（例）

* `POST /api/v1/text-chat`

  * テキスト入力 → テキスト応答
* `POST /api/v1/rag/index`

  * ドキュメントファイルをアップロードし、FAISSにインデックス
* `GET /api/v1/config/providers`

  * 現在の Provider 構成の確認

### 4.3 会話オーケストレーション（ロジック概要）

疑似コードイメージ（Python風）：

```python
async def handle_audio_stream(session_id, audio_stream):
    # 1. STT ストリームを開始
    async for stt_event in stt_provider.recognize_stream(audio_stream):
        if stt_event.type == "partial":
            await ws.send_json({"type": "transcript_partial", "text": stt_event.text})
        elif stt_event.type == "final":
            user_text = stt_event.text
            await ws.send_json({"type": "transcript_final", "text": user_text})
            # 2. 応答生成を非同期で起動
            asyncio.create_task(handle_turn(session_id, user_text))

async def handle_turn(session_id, user_text):
    # 1. RAG で関連ドキュメント取得
    docs = await rag_service.retrieve(user_text, top_k=5)

    # 2. LLM で応答生成（ストリーミング）
    async for llm_event in llm_provider.chat_stream(
        messages=build_messages(session_id, user_text, docs)
    ):
        if llm_event.type == "token":
            await ws.send_json({"type": "assistant_text_partial", "delta": llm_event.text})
        elif llm_event.type == "final":
            assistant_text = llm_event.text
            await ws.send_json({"type": "assistant_text_final", "text": assistant_text})
            # 3. TTS へ
            asyncio.create_task(stream_tts(assistant_text))
```

`stt_provider` / `llm_provider` / `rag_service` / `tts_provider` は DI により差し替え可能にする。

ストリーミングは WebSocket 上で backpressure 制御（送信キュー上限、輻輳時の古いチャンク破棄）と再接続ハンドリングを行い、セッションタイムアウト（例: 無音 60 秒）を設ける。

---

## 5. モジュール化された AI コンポーネント設計

### 5.1 共通インターフェース設計

#### LLM Provider

```python
from typing import Protocol, AsyncIterator

class ChatMessage(BaseModel):
    role: str  # "system" | "user" | "assistant"
    content: str

class LlmChunk(BaseModel):
    type: str  # "token" | "final"
    text: str

class LlmProvider(Protocol):
    async def chat_stream(
        self,
        messages: list[ChatMessage],
        **kwargs
    ) -> AsyncIterator[LlmChunk]:
        ...
```

実装例:

* `LocalGptOss120bProvider`（llm コンテナの OpenAI 互換 API を叩く）
* `RemoteOpenAiProvider`（将来の拡張、OpenAI / Azure 等）

> **ポイント：**
> LLM サーバ側の API は **OpenAI Chat Completions 互換**にしておくと、
> 差し替え時の工数が激減する。

#### RAG / VectorStore Provider

```python
class Document(BaseModel):
    id: str
    text: str
    metadata: dict

class RagRetriever(Protocol):
    async def retrieve(self, query: str, top_k: int = 5) -> list[Document]:
        ...
```

内部では LangChain + FAISS を利用するが、外側は `RagRetriever` として隠蔽する。

#### STT Provider

```python
class SttEvent(BaseModel):
    type: str  # "partial" | "final"
    text: str

class SttProvider(Protocol):
    async def recognize_stream(
        self,
        audio_stream: AsyncIterator[bytes],
        language: str = "ja-JP",
    ) -> AsyncIterator[SttEvent]:
        ...
```

実装例:

* `SherpaOnnxProvider`

  * sherpa-onnx サーバの gRPC / WebSocket をラップ
  * reazon speech ベースの VAD で区切りを検出

将来:

* `WhisperProvider` などに差し替え可能

標準ではクライアントから Opus 32kbps チャンクを受け取り、サーバー側で 16k〜48kHz PCM にデコードして STT に渡す。

#### TTS Provider

```python
class TtsChunk(BaseModel):
    type: str  # "audio"
    audio: bytes  # raw PCM or encoded
    format: str   # "pcm16", "opus" etc.

class TtsProvider(Protocol):
    async def synthesize_stream(
        self,
        text: str,
        voice: str = "default",
        language: str = "ja-JP",
    ) -> AsyncIterator[TtsChunk]:
        ...
```

実装例:

* `OpenAudioS1Provider`（Open Audio S1 をホストする TTS サービスをラップ）

将来:

* `RemoteTtsProvider`（クラウドTTS API への切り替え）

標準では Opus 32kbps を返し、クライアントは同フォーマットで再生する。

### 5.2 Provider 選択 & 設定

`config/providers.yaml` 例：

```yaml
llm:
  provider: "local-gpt-oss-120b"
  endpoint: "http://llm:8000/v1"
  model: "gpt-oss-120b"

stt:
  provider: "sherpa-onnx"
  endpoint: "http://stt:6006"

tts:
  provider: "open-audio-s1"
  endpoint: "http://tts:7007"
  default_voice: "ja_female_1"

rag:
  provider: "faiss"
  index_path: "/data/faiss/index.bin"
  embedding_provider: "local-embedding"
```

FastAPI 起動時にこの設定を読み込み、DI コンテナで Provider を組み立てる。

---

## 6. フロントエンド設計（Vite + React + three-vrm）

### 6.1 UI コンポーネント構成

主な React コンポーネント:

* `<App>`

  * 全体の状態管理（React Query / Zustand / Reduxなど）
* `<AvatarScene>`

  * three.js + three-vrm による 3D アバター表示
  * カメラ・ライト・背景などのシーン管理
* `<AvatarController>`

  * WebSocket から受け取る `avatar_event` / 音声レベル情報に応じて

    * 口パク (blendshape: A/I/U/E/O 等)
    * 表情 (smile, angry, thinking など)
* `<VoiceChatController>`

  * Web Audio API でマイク音声を取得
  * WebSocket への audio chunk 送信
  * サーバーからの audio chunk を再生
* `<ChatLog>`

  * テキストの会話ログ表示（STT結果 & LLM応答）

### 6.2 three-vrm 制御の概要

* VRM モデルをロードして `VRM` インスタンスを取得
* 口パク:

  * ブラウザ側で再生中の TTS 音声を Web Audio の AnalyserNode で解析
  * フレームごとに音量 / 周波数帯域から簡易的な mouth open 値を計算
  * `vrm.blendShapeProxy.setValue("A", value)` などで制御
* 表情:

  * サーバーからの `avatar_event`（emotion: "smile" | "thinking" etc）を受け取り
  * 対応する blendshape を一定時間オンにする

### 6.3 WebSocket メッセージプロトコル（例）

* 音声は 44.1kHz/16bit 取得 → Opus 32kbps にエンコードし、20〜40ms 単位のチャンクで送信。クライアント送信キューに上限を設け、輻輳時は古いチャンクをドロップして遅延を抑制。

クライアント → サーバー:

```jsonc
// 音声チャンク
{
  "type": "audio_chunk",
  "data": "<binary>"
}

// 会話制御
{
  "type": "control",
  "action": "start" | "stop",
  "language": "ja-JP"
}
```

サーバー → クライアント:

```jsonc
// STT 部分結果
{
  "type": "transcript_partial",
  "text": "えっとですね…"
}

// STT 確定
{
  "type": "transcript_final",
  "text": "明日のスケジュールを教えて"
}

// LLM 応答ストリーム
{
  "type": "assistant_text_partial",
  "delta": "明日のスケジュールは…"
}
{
  "type": "assistant_text_final",
  "text": "明日のスケジュールは、10時にミーティングがあります。"
}

// TTS 音声チャンク（バイナリフレームで送る想定）
{
  "type": "assistant_audio_chunk",
  "format": "opus",
  "seq": 1,
  "data": "<binary>"
}

// アバター用イベント
{
  "type": "avatar_event",
  "event": "emotion",
  "value": "smile"
}
```

---

## 7. RAG / ナレッジ基盤（LangChain + FAISS）

### 7.1 インデクシングパイプライン

* `rag-indexer` コンテナを別途用意し、ジョブとして実行

  * 対象: PDF / Markdown / Webページ / 社内wiki 等
  * LangChain の Document Loader / TextSplitter で分割（チャンク 800〜1200 文字、オーバーラップ 200 文字目安）
  * `EmbeddingProvider`（例: ローカル埋め込みモデル）で埋め込み生成
  * FAISS index を作成し、`/data/faiss/index.bin` に保存
* 初回インデックス + 差分更新をサポート（ファイルハッシュ等で判定、重複排除）
* 日本語最適化の埋め込みモデルを優先採用
* ACL は単一ユーザー前提で `owner=self` 固定

### 7.2 クエリ時の RAG フロー

1. ユーザー発話から得られた `user_text` を入力
2. `RagRetriever.retrieve(user_text)` で上位 k 件を取得
3. LLM プロンプトに以下のように埋め込む:

```text
[system] あなたはユーザーの秘書です。以下のコンテキストを参考にして、自然で丁寧な日本語で回答してください。

[context]
{doc1 text...}
---
{doc2 text...}
...

[conversation history]
ユーザー: ...
アシスタント: ...

[ユーザーの質問]
{user_text}
```

4. LLM の出力をユーザー応答として採用

※ 将来的に FAISS → 他VectorDB（Qdrant, Milvus など）へ移行しやすいよう、
`VectorStoreProvider` インターフェースで抽象化しておく。

---

## 8. インフラ & デプロイ（DGX Spark + Docker Compose）

### 8.1 コンテナ一覧

* `frontend` : Vite + React ビルド済み静的ファイル + Node/Nginx
* `backend` : FastAPI Orchestrator
* `llm` : gpt-oss-120b 推論サーバ
* `stt` : sherpa-onnx + reazon speech
* `tts` : Open Audio S1 TTS サービス
* `rag-indexer` : RAG インデクシングジョブ（必要時のみ実行）
* `db` : PostgreSQL
* `redis` : (オプション) セッション管理・キュー
* 共通ネットワーク: `backend-net`

### 8.2 GPU 割り当て方針（例）

* `llm` : DGX Spark の大部分の GPU を占有（例: 6〜8枚）
* `stt` : 1 GPU
* `tts` : 1 GPU
* `backend` / `frontend` / `db` / `redis` : CPU

※ 実際には DGX Spark の GPU 数やメモリに応じて最適化する。

### 8.3 docker-compose.yml（サンプル）

※ 実際の GPU 設定は環境に合わせて調整が必要。ここでは概念的な例。

```yaml
version: "3.9"

services:
  frontend:
    image: myorg/ai-secretary-frontend:latest
    ports:
      - "8080:80"
    depends_on:
      - backend
    networks:
      - backend-net

  backend:
    image: myorg/ai-secretary-backend:latest
    environment:
      - PROVIDER_CONFIG=/config/providers.yaml
    volumes:
      - ./config:/config:ro
      - faiss-data:/data/faiss
    depends_on:
      - llm
      - stt
      - tts
      - db
    ports:
      - "8000:8000"
    networks:
      - backend-net

  llm:
    image: myorg/gpt-oss-120b-server:latest
    runtime: nvidia
    device_requests:
      - driver: nvidia
        count: 6
        capabilities: ["gpu"]
    networks:
      - backend-net

  stt:
    image: myorg/sherpa-onnx-server:latest
    runtime: nvidia
    device_requests:
      - driver: nvidia
        count: 1
        capabilities: ["gpu"]
    networks:
      - backend-net

  tts:
    image: myorg/open-audio-s1-server:latest
    runtime: nvidia
    device_requests:
      - driver: nvidia
        count: 1
        capabilities: ["gpu"]
    networks:
      - backend-net

  db:
    image: postgres:16
    environment:
      - POSTGRES_USER=assistant
      - POSTGRES_PASSWORD=assistant
      - POSTGRES_DB=assistant
    volumes:
      - db-data:/var/lib/postgresql/data
    networks:
      - backend-net

  redis:
    image: redis:7
    networks:
      - backend-net

volumes:
  db-data:
  faiss-data:

networks:
  backend-net:
```

> **一発起動要件**
> この compose ファイル＋事前ビルドされた各イメージを用意すれば、
> `docker compose up -d` で全サービスが立ち上がる構成を目指す。
> モデルファイルは各コンテナのボリュームに配置し、起動ヘルスチェックを入れて依存順を担保する。

---

## 9. ログ・監視・運用

* ログ

  * FastAPI / LLM / STT / TTS の各サービスで構造化ログ(JSON)
  * 会話単位のトレースIDを付与
* メトリクス

  * レイテンシ（STT, LLM, TTS 各区間）: STT partial p95 <= 0.5s、応答開始 p95 <= 2s
  * GPU使用率
  * セッション数 / エラー率
* アラート

  * LLM 応答失敗率が閾値を超えた場合
  * STT / TTS サービスのダウン
* フォールバック

  * LLM 失敗時はテンプレ応答でリカバリ、TTS 失敗時はテキスト提示のみ返却
* バックアップ / 暗号化

  * 初期フェーズは特段のバックアップ・暗号化要件なし（シンプル構成優先、要件追加時に再検討）
* モデル差し替え運用

  * Provider 設定ファイルを変更 → CI/CD パイプラインで rollout
  * ロールバックを容易にするため、タグ付きイメージを利用

---

## 10. 段階的な実装ロードマップ（例）

1. **Phase 1: 最小プロトタイプ**

   * Text chat ベース（音声なし）で LLM + RAG 動作確認
   * FastAPI + LangChain + FAISS のみ
2. **Phase 2: 音声入出力・3D UI**

   * STT（sherpa-onnx）& TTS（Open Audio S1）を追加
   * WebSocket で音声ストリーミング
   * three-vrm で簡易アバター & 口パク
3. **Phase 3: モジュール化・差し替え**

   * Provider 抽象化を完了
   * LLM / STT / TTS を別モデルに差し替える PoC
4. **Phase 4: チューニング & RAG 強化**

   * レイテンシ最適化（並列化・キャッシュ・早期 TTS 等）
   * ドキュメント種別ごとの RAG チェーン最適化

---

以上が、DGX Spark 1台上で動作する three-vrm ベース AI秘書アプリの設計書（初版案）です。

もしよければ、次のステップとして：

* 実際の `providers.yaml` の中身の詳細（どんなLLM/TTS設定にするか）
* three-vrm 側のアニメーション仕様（どの表情をどのイベントに紐づけるか）

あたりをもう少し掘り下げた「詳細設計」を一緒に詰めていきましょう。
