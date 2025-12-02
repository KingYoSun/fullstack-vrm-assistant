# フルスタックAI秘書アプリケーション Design Doc（案）

* 対象HW: DGX Spark 1台（複数GPU想定）
* 主な技術スタック

  * LLM: Qwen2.5/Qwen3 32B (NIM, aarch64, cu130/SM 12.1)
  * RAG: LangChain + FAISS
  * STT: whisper.cpp (CUDA 対応ビルド、ggml/GGUF モデル)
  * TTS: Open Audio S1 (Fish Speech / OpenVoice, CUDA 13.0)
  * Embedding: llama.cpp (CUDA 対応埋め込みサーバ, GGUF)
  * Backend: FastAPI
  * Frontend: Vite + React + TypeScript + three-vrm（react-three-fiber 経由）+ shadcn/ui
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

   * NIM コンテナで Qwen 32B Instruct（aarch64, cu130, SM 12.1）をホスト
   * OpenAI 互換の Chat Completion API を HTTP で提供（`http://llm:8000/v1`）
   * 別 LLM サーバ（クラウド API 含む）に差し替え可能な形を維持

4. **RAG / Vector Store**

   * LangChain を用いたドキュメント ingestion / retrieval
   * Vector DB は FAISS を採用（ローカルファイル + ボリューム）
   * Embedding モデルは抽象化（差し替え可）

5. **STT Service (whisper.cpp)**

   * whisper.cpp を CUDA 13.0 でビルドし、`whisper-server` でストリーミング音声認識
   * ggml/GGUF モデルをマウント（例: `ggml-base.en.bin` / `ggml-base.bin`）

6. **TTS Service (Open Audio S1)**

   * Fish Speech/OpenVoice ベースで Open Audio S1 mini をストリーミング生成
   * CUDA 13.0（または CPU）で動作し、voice/style を設定で切り替え

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

* `WhisperCppProvider`

  * whisper.cpp の HTTP/WebSocket サーバ (`whisper-server`) を叩く実装
  * CUDA 13.0 ビルドの ggml/GGUF モデル（例: `ggml-base.en.bin`）を使用

将来:

* sherpa-onnx など別エンジンにも差し替え可能

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
  provider: "nim-qwen3"
  endpoint: "http://llm:8000/v1"
  model: "qwen3-32b-instruct"

stt:
  provider: "whisper-cpp"
  endpoint: "http://stt:6006/inference"
  language: "ja"

tts:
  provider: "open-audio-s1"
  endpoint: "http://tts:7007"
  default_voice: "ja_female_1"
  stream: true

embedding:
  provider: "local-embedding"
  endpoint: "http://embedding:9000/v1"
  model: "/models/embd-model.gguf"

rag:
  provider: "faiss"
  index_path: "/data/faiss/index.bin"
  embedding_provider: "local-embedding"
```

FastAPI 起動時にこの設定を読み込み、DI コンテナで Provider を組み立てる。
実際のデフォルト設定は `config/providers.yaml` に配置し、docker compose のサービス名（`llm`, `stt`, `tts` など）を前提としたエンドポイントを記載する。

---

## 6. フロントエンド設計（Vite + React + three-vrm）

* three.js / three-vrm は `@react-three/fiber` を用いて React コンポーネント化する。
* UI コンポーネント/フォーム/トースト等は shadcn/ui を採用し、デザインの一貫性を担保する。

### 6.1 UI コンポーネント構成

主な React コンポーネント:

* `<App>`

  * 全体の状態管理（React Query / Zustand / Reduxなど）
* `<AvatarScene>`

  * react-three-fiber + three-vrm による 3D アバター表示
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

* VRM モデルをロードして `VRM` インスタンスを取得（react-three-fiber の Canvas コンテキスト内で管理）
* 口パク:

  * ブラウザ側で再生中の TTS 音声を Web Audio の AnalyserNode で解析
  * フレームごとに音量 / 周波数帯域から簡易的な mouth open 値を計算
  * `vrm.blendShapeProxy.setValue("A", value)` などで制御
* 表情:

  * サーバーからの `avatar_event`（emotion: "smile" | "thinking" etc）を受け取り
  * 対応する blendshape を一定時間オンにする

### 6.3 WebSocket メッセージプロトコル（例）

* 音声は 44.1kHz/16bit 取得 → Opus 32kbps にエンコードし、デフォルト 20ms（調整幅 20〜40ms）のチャンクで送信。クライアント送信キュー上限は 25 チャンク（約 0.5s 相当）で、輻輳時は古いチャンクをドロップして遅延を抑制。
* 下り（TTS→クライアント）は 40ms チャンクを基本とし、再生キュー上限 30 チャンク（約 1.2s）で古いチャンクを破棄して詰まりを回避。

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

* backend コンテナ（もしくは専用ジョブ）で ingest CLI を実行し、必要に応じて `rag-indexer` として切り出す

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

- `frontend` : Node 20 上で Vite ビルド + preview（pnpm をコンテナ内で実行）
- `backend` : FastAPI Orchestrator（python:3.12-slim）
- `llm` : NIM Qwen 32B Instruct（nvcr.io/nim/qwen/qwen3-32b-dgx-spark:latest, aarch64, cu130/SM 12.1）
- `stt` : whisper.cpp CUDA ビルド (`whisper-server`)、ggml/GGUF モデルを `/models` にマウント
- `tts` : Fish Speech / OpenVoice (Open Audio S1 mini) CUDA 13.0 サーバ
- `embedding` : llama.cpp embedding サーバ（GGUF, CUDA 13.0）
- `postgres` : PostgreSQL 16
- `mock providers` : echo-server（llm/stt/tts/embedding のエイリアス、`profile=mock`）

### 8.2 GPU / プラットフォーム方針

- DGX Spark (aarch64, CUDA 13.0, SM 12.1) を前提に、`deploy.resources.reservations.devices` で GPU を各サービス 1 枚ずつ確保（llm/stt/tts/embedding）。
- STT/TTS/Embedding のビルドベースは `nvidia/cuda:13.0.2-devel-ubuntu24.04`。LLM は `platform=linux/aarch64` の NIM イメージを使用。
- LLM のモデルキャッシュは `/opt/nim/workspace` を `./models/llm` にバインド。`NGC_API_KEY` を `.env` に設定し、NIM がモデルを自動取得する前提。
- STT/TTS/Embedding は `./models/{stt,tts,embedding}` を `/models` / `/app/checkpoints` にマウントし、GGUF/音声モデル/リファレンス音声を事前配置する。

### 8.3 docker-compose.yml（現行の要点）

```yaml
name: fullstack-vrm-assistant

x-common-env: &common-env
  env_file:
    - .env

x-nvidia: &nvidia
  deploy:
    resources:
      reservations:
        devices:
          - driver: nvidia
            count: 1
            capabilities: [gpu]

services:
  backend:
    image: python:3.12-slim
    working_dir: /workspace/backend
    command: |
      sh -c "
        cd /workspace/backend &&
        apt-get update &&
        DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ffmpeg build-essential curl &&
        rm -rf /var/lib/apt/lists/* &&
        python -m pip install --no-cache-dir --upgrade pip setuptools wheel &&
        if [ -f requirements.dev.txt ]; then
          PIP_NO_BUILD_ISOLATION=1 pip install --no-cache-dir -r requirements.dev.txt;
        else
          echo 'requirements.dev.txt が見つかりません。';
        fi &&
        uvicorn app.main:app --host 0.0.0.0 --port ${BACKEND_PORT:-8000}
      "
    volumes:
      - ./backend:/workspace/backend
      - ./config:/workspace/config:ro
      - ./data:/data
    <<: *common-env
    environment:
      - PROVIDERS_CONFIG_PATH=${PROVIDERS_CONFIG_PATH:-/workspace/config/providers.yaml}
      - PYTHONPATH=/workspace/backend
    ports:
      - "${BACKEND_PORT:-8000}:${BACKEND_PORT:-8000}"
    depends_on:
      postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:${BACKEND_PORT:-8000}/ready || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 5

  frontend:
    image: node:20-bullseye
    working_dir: /workspace/frontend
    command: |
      sh -c "
        cd /workspace/frontend &&
        corepack enable &&
        pnpm install --frozen-lockfile=false &&
        pnpm build &&
        pnpm preview -- --host --port ${FRONTEND_PORT:-5173}
      "
    volumes:
      - ./frontend:/workspace/frontend
      - frontend_node_modules:/workspace/frontend/node_modules
    <<: *common-env
    ports:
      - "${FRONTEND_PORT:-5173}:${FRONTEND_PORT:-5173}"
    depends_on:
      backend:
        condition: service_started

  llm:
    image: ${LLM_IMAGE:-nvcr.io/nim/qwen/qwen3-32b-dgx-spark:latest}
    platform: ${LLM_PLATFORM:-linux/aarch64}
    <<: *nvidia
    environment:
      - NVIDIA_VISIBLE_DEVICES=all
      - NGC_API_KEY=${NGC_API_KEY}
    volumes:
      - ${LLM_MODEL_LOCAL_DIR:-./models/llm}:${LLM_MODEL_DIR:-/opt/nim/workspace}
    ports:
      - "${LLM_LOCAL_PORT:-18000}:${LLM_PORT:-8000}"
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:18000/v1/health/ready || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 5

  stt:
    image: ${STT_IMAGE:-local/whisper-stt:cuda}
    build:
      context: .
      dockerfile: docker/stt-whisper/Dockerfile
    <<: *nvidia
    volumes:
      - ${STT_MODEL_LOCAL_DIR:-./models/stt}:${STT_MODEL_DIR:-/models}
    environment:
      - WHISPER_MODEL=${STT_MODEL:-/models/ggml-base.en.bin}
      - WHISPER_PORT=${STT_PORT:-6006}
      - WHISPER_LANG=${STT_LANGUAGE:-ja}
      - WHISPER_THREADS=${STT_THREADS:-16}
    ports:
      - "${STT_PORT:-6006}:${STT_PORT:-6006}"
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:${STT_PORT:-6006}/health || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 5

  tts:
    image: ${TTS_IMAGE:-local/openvoice:cuda}
    build:
      context: .
      dockerfile: docker/tts-fish-speech/Dockerfile
    <<: *nvidia
    volumes:
      - ${TTS_MODEL_LOCAL_DIR:-./models/tts}:${TTS_MODEL_DIR:-/app/checkpoints}
      - ${TTS_REFERENCE_LOCAL_DIR:-./references/tts}:${TTS_REFERENCE_DIR:-/app/references}
    environment:
      - API_SERVER_PORT=${TTS_PORT:-7007}
      - BACKEND=${TTS_BACKEND:-cuda}
    command: bash -lc "${TTS_COMMAND:-/app/start_server.sh}"
    ports:
      - "${TTS_PORT:-7007}:${TTS_PORT:-7007}"

  embedding:
    image: ${EMBEDDING_IMAGE:-local/llama-embedding:cuda}
    build:
      context: .
      dockerfile: docker/embedding-llama/Dockerfile
    <<: *nvidia
    environment:
      - LLAMA_MODEL=${EMBEDDING_MODEL:-/models/embd-model.gguf}
      - LLAMA_PORT=${EMBEDDING_PORT:-9000}
      - LLAMA_PARALLEL=${EMBEDDING_PARALLEL:-4}
      - LLAMA_UBATCH=${EMBEDDING_UBATCH:-1024}
      - LLAMA_NGPU=${EMBEDDING_NGPU:-999}
      - LLAMA_POOLING=${EMBEDDING_POOLING:-mean}
    ports:
      - "${EMBEDDING_PORT:-9000}:${EMBEDDING_PORT:-9000}"
    volumes:
      - ${EMBEDDING_MODEL_LOCAL_DIR:-./models/embedding}:${EMBEDDING_MODEL_DIR:-/models}
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:${EMBEDDING_PORT:-9000}/health || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 5

  postgres:
    image: postgres:16-alpine
    environment:
      - POSTGRES_USER=${POSTGRES_USER:-vrm}
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-vrm_password}
      - POSTGRES_DB=${POSTGRES_DB:-vrm}
    ports:
      - "${POSTGRES_PORT:-5432}:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-vrm}"]
      interval: 10s
      timeout: 5s
      retries: 5

  llm-mock:
    image: docker.io/ealen/echo-server:latest
    profiles: [mock]
    environment:
      - PORT=${LLM_PORT:-8000}
    networks:
      default:
        aliases: [llm]
    ports:
      - "${LLM_PORT:-8000}:${LLM_PORT:-8000}"

  stt-mock:
    image: docker.io/ealen/echo-server:latest
    profiles: [mock]
    environment:
      - PORT=${STT_PORT:-6006}
    networks:
      default:
        aliases: [stt]
    ports:
      - "${STT_PORT:-6006}:${STT_PORT:-6006}"

  tts-mock:
    image: docker.io/ealen/echo-server:latest
    profiles: [mock]
    environment:
      - PORT=${TTS_PORT:-7007}
    networks:
      default:
        aliases: [tts]
    ports:
      - "${TTS_PORT:-7007}:${TTS_PORT:-7007}"

  embedding-mock:
    image: docker.io/ealen/echo-server:latest
    profiles: [mock]
    environment:
      - PORT=${EMBEDDING_PORT:-9000}
    networks:
      default:
        aliases: [embedding]
    ports:
      - "${EMBEDDING_PORT:-9000}:${EMBEDDING_PORT:-9000}"

volumes:
  frontend_node_modules:
  postgres_data:
```

> モデルを `./models` 配下に配置し、`.env` のパラメータ（NGC_API_KEY, *_MODEL, *_PORT, *_PLATFORM など）を埋めたうえで `docker compose up -d`。モックでの疎通確認は `docker compose --profile mock up -d` を利用する。

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

   * STT（whisper.cpp CUDA）& TTS（Open Audio S1 / Fish Speech）を追加
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
