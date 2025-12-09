# SnapMoGen モーション統合計画（2025年12月09日）

## ゴールとスコープ
- SnapMoGen を GPU モーション生成マイクロサービスとして切り出し、FastAPI backend から HTTP 経由で呼び出し、生成物を `/data/animations` 配下に保存して frontend (three-vrm) で再生できる状態にする。
- 既存の Provider 抽象（LLM/STT/TTS/Embedding/RAG）と同等の扱いで、`.env` と `config/providers.yaml` に motion 設定を統合する。
- 最初の出力フォーマットは VRM 再生しやすい「ボーン Quaternion キー列 JSON」。VRMA/BVH は将来拡張とし、ファイルは `job_id` 単位で残す。

## 成果物
- `docker/motion-snapmogen/Dockerfile` と `motion_service/`（FastAPI ラッパ: `/health`, `POST /v1/motion/generate`）。
- `docker-compose.yml` への `motion` サービス追加（GPU `x-nvidia` アンカー利用、モデル/データ共有ボリューム、ヘルスチェック）。
- `.env.default` の MOTION_* 追加、`config/providers.yaml` に `motion:` セクション追加。
- backend: ProvidersConfig/Registry 拡張、`MotionClient` 実装、`POST /api/v1/motion/generate` と WS `assistant_motion` イベント追加。
- frontend: motion キー列 JSON の取得・再生ロジック（三身体ボーンのみ適用）、UI トリガ追加。
- テスト: motion_service の最小ユニットテスト（変換/入出力）、backend API/WS のモック統合テスト、手動検証手順の追記。

## 最新進捗（2025年12月09日）
- motion_service を FastAPI スタブとして追加し、`/v1/motion/generate` がプレースホルダーの VRM JSON を `/data/animations` に保存。Dockerfile を新設し compose に GPU プロファイル付き motion サービスを追加。
- `.env.default` / `config/providers.yaml` に MOTION_* と DATA_* を追加し、backend StaticFiles で `/data` を配信。
- backend に MotionProviderConfig/Client、`POST /api/v1/motion/generate`、Diagnostics `/diagnostics/motion`、WS `assistant_motion` イベントを実装。
- frontend Diagnostics Drawer に Motion カードを追加し、WS `assistant_motion` を受信して表示（再生ロジックは未着手）。
- 次ステップ: SnapMoGen 推論コードの呼び出しと VRM アバター再生処理、motion_prompt 抽出/同期再生の導線を実装する。

## 調査メモ（2025年12月09日）
- フロントの再生経路は normalized ボーンでのリターゲット＆AnimationMixer 再生が動作。VRMA ファイルを「VRMA → Motion」で JSON に変換し、Motion 経路経由でも正しく再生できることを確認。
- motion_service のプレースホルダー JSON（左右腕・胴体など 7 トラック）は、最大でも ~10 度程度の回転で見た目がほぼ T ポーズのまま。生成側で振幅を大きくしても改善せず、出力内容が根本的に不足している可能性が高い。
- 現状、Motion 経路の実装・リターゲットは正常と判断。改善は motion_service（SnapMoGen 出力）でのスケール/生成ロジックの見直しが必要。

## 前提・非スコープ
- 環境: DGX Spark (CUDA 13.0, SM 12.1)、Docker Compose GPU プロファイル利用。Node 20系、Python 3.12 系。
- SnapMoGen README 推奨: Python 3.8.20、`prepare/download_models.sh` でチェックポイント取得。モデル格納はボリューム `/checkpoint_dir` で永続化する。
- 非スコープ: VRMA/BVH の提供は後続、完全自動リターゲット精度は最小限（A/T-Pose差分補正を初期対応）。

## 全体アーキテクチャ
- motion_service（別コンテナ）が GPU 上で SnapMoGen を実行し、生成物を `/data/animations/<job_id>.json`（将来 `.vrma`/`.bvh` 並存）に保存。ホスト `./data` を共有して frontend からも参照可能にする。
- backend は ProviderRegistry 経由で motion_service を HTTP 呼び出しし、`job_id` と保存パス/URL を返す。会話 WS で `assistant_motion` イベントを流し、再生指示を front に通知。
- frontend は REST/WS で取得した JSON を three.js `AnimationMixer` + `QuaternionKeyframeTrack` で再生。顔表情/口パクとは別レイヤーにし、身体ボーンのみ適用。

## 会話フロー/統合方針（検討とデフォルト案）
- LLM 出力と同時に「モーション用プロンプト」を生成する: System Prompt に「応答テキスト＋モーション記述（例: `motion_prompt`: 5秒で腕を振る、歩行など）」を追加するガイドラインを組み込み、LLM から motion 用短文を抽出する。最初は System Prompt を拡張し、LLM 応答のメタ情報として `motion_prompt` を返す形を目指す。
- 呼び出しタイミング: LLM テキストが確定したタイミングで motion_service を非同期発火し、TTS と並列で進める（同一ジョブIDで管理）。TTS 完了を待たずに motion を生成・先行ロードし、WS で `assistant_motion` を送る。パイプライン: STT → LLM(テキスト＋motion_prompt) → [並列] TTS と motion/generate → フロントが音声とモーションを同期再生（開始タイミングを合わせるロジックは別途）。
- フォールバック: LLM から `motion_prompt` が得られない場合は UI ボタンで手動生成を許容する。初期段階では「LLM 応答確定後に motion_prompt があれば自動生成、なければスキップ」をデフォルトとし、後から UI で再生成を追加。
- WS/REST: backend が `assistant_motion` イベントでモーション URL とメタを送る。REST の `/api/v1/motion/generate` はテスト/手動用としても利用する。

## 実装タスク
### 1. motion_service（SnapMoGen ラッパ）
- Dockerfile: `nvidia/cuda:13.0.2-devel-ubuntu24.04` をベースに（`docker/tts-fish-speech/Dockerfile` と同系）、Python 3.12 + pip を導入。SnapMoGen を clone し、requirements から `torch*` を除外しつつ、CUDA 対応 PyTorch（例: torch==2.9.0 + cu130）を Dockerfile 内で明示インストールする。`fastapi`, `uvicorn[standard]`, `pydantic` を追加。
- エンドポイント:
  - `GET /health` → 200
  - `POST /v1/motion/generate`: 入力 `{prompt, seed?, steps?, guidance?, format? ("vrm-json" default)}`。内部で SnapMoGen 推論 (`gen_momask_plus.py`) を実行し、`job_id` 生成。
  - 出力: `{job_id, format, output_path, duration_sec, fps, tracks, rootPosition?}`。`output_path` は `/data/animations/<job_id>.json` を返す。
- 変換: SnapMoGen 出力（npy/npz 等）を VRM Humanoid ボーンへマッピングし、Quaternion キー列 JSON へ変換。A/T-Pose差分は README の `rest_pose_retarget` 相当の補正処理フックを用意（簡易で可）。
- 環境変数: `MOTION_PORT`, `CHECKPOINT_DIR`, `DATA_ROOT`（入力/キャッシュ）, `OUTPUT_DIR`（書き出し先 `/data/animations`）。モデルDLは `prepare/download_models.sh` を手動/ジョブ初回で実行できるよう README 追記。

### 2. Compose/環境変数
- `docker-compose.yml`:
  - `motion` サービス追加（`profiles: ["prod","dev"]`、`<<: *nvidia`、`ports: 7100`）。ボリューム: `./models/motion:/checkpoint_dir`, `./data/motion:/data/motion`, `./data:/data`。
  - `backend`/`backend-dev` に `depends_on.motion.condition: service_healthy` を追加（起動順確保）。
- `.env.default` 追記:
  - `MOTION_IMAGE`, `MOTION_PORT`, `MOTION_PROVIDER=snapmogen`, `MOTION_ENDPOINT=http://motion:${MOTION_PORT}/v1/motion/generate`, `MOTION_TIMEOUT_SEC`, `MOTION_OUTPUT_FORMAT=vrm-json`, `MOTION_MODEL_LOCAL_DIR`, `MOTION_MODEL_DIR`, `MOTION_DATA_LOCAL_DIR`, `MOTION_DATA_DIR`.
- `config/providers.yaml` に `motion:` セクションを追加（provider/endpoint/timeout/output_format）。

### 3. Backend 変更
- `ProvidersConfig` に `MotionProviderConfig` を追加し、`ProviderRegistry` に `motion` クライアントを登録。`motion.py` クライアントで `POST /v1/motion/generate` を呼び出し、`job_id`/`output_path` を返却。
- API: `POST /api/v1/motion/generate`（prompt/seed 等受け取り、`job_id` と `url` を返す）。`/data` 配下を FastAPI `StaticFiles` で公開または署名付き URL を生成して返す。
- WS: `/ws/session/{id}` に `assistant_motion` イベントを追加（payload: `job_id`, `url`, `format`, `fps`, `tracks`, `rootPosition`）。LLM 応答完了時に trigger する導線を用意。
- Diagnostics: motion ping を追加し、`/ready` で motion status も含めるか、Diagnostics API に項目追加。

### 4. Frontend 変更
- 型定義: motion payload（`fps`, `tracks`, `rootPosition`, `format`, `url`）を `types/app.ts` に追加。
- 取得フロー: REST `POST /api/v1/motion/generate` → `job_id`/`url` 取得、または WS `assistant_motion` 受信で自動再生。`url` が未指定の場合は `/data/animations/<job_id>.json` をフェッチ。
- 再生: three.js `AnimationMixer` + `QuaternionKeyframeTrack` で Humanoid 身体ボーンのみ適用。既存リップシンク/表情とは別の AnimationAction レイヤーで混在可にする（ウェイト調整）。
- UI: DiagnosticsDrawer などに「モーション生成」ボタンとステータス表示を追加（失敗時のトースト/ログ出力）。再生中/再生完了のフィードバックを表示。

### 5. データ仕様（初期案）
```json
{
  "format": "vrm-json",
  "fps": 30,
  "duration_sec": 5.0,
  "tracks": {
    "hips": [{"t":0.0,"x":0,"y":0,"z":0,"w":1}, ...],
    "spine": [...],
    "leftUpperArm": [...],
    "rightUpperArm": [...]
  },
  "rootPosition": [
    {"t":0.0,"x":0,"y":0,"z":0},
    {"t":0.033,"x":0.01,"y":0,"z":0}
  ]
}
```
- Humanoid ボーン名は three-vrm の HumanBoneName に合わせる。`rootPosition` はオプション。

### 6. テスト/検証
- motion_service: `/health` の HC、モック入力に対する JSON 生成テスト（変換関数を分離して単体テスト）。実機では短尺プロンプトで e2e 生成し、`/data/animations` にファイルが落ちることを確認。
- backend: `MotionClient` の httpx モックテスト、`POST /api/v1/motion/generate` の FastAPI テスト、WS `assistant_motion` のイベント送出を `AsyncClient` + `WebSocketTestSession` で検証。
- frontend: JSON モックを使った AnimationMixer 再生の単体テスト（ロジック関数を分離）、WS イベント受信時の状態遷移テスト。手動で UI ボタン→生成→再生を確認。

### 7. マイルストーン
1. Compose/Docker: motion サービス追加＋ビルド確認（モック応答でも可）。
2. motion_service: `/health` と `/v1/motion/generate` スタブ実装（固定JSON返却）→ VRM JSON 変換ユーティリティ実装。
3. Backend: ProviderConfig/Registry/Client 追加、API/WS スタブで JSON を返し front から再生できるまで確認。
4. Frontend: JSON 再生ロジックと UI 組み込み。WS イベントでの自動再生まで通す。
5. 実機生成: SnapMoGen モデルDL・推論実行、A/T-Pose補正の最小実装、出力の実データでフロント再生確認。
6. ドキュメント反映と手動検証手順追記（production_runtime への追加も含む）。

### 8. リスクと対策
- Pose 差異で腕が貫通/破綻する: A/T-Pose補正とボーンマッピングを設定化し、VRM別にオフセットを持てるようにする。
- 出力サイズ/ロード遅延: `fps` を 30 などに抑え、圧縮（gzip or binary）を検討。短尺生成をデフォルトにする。
- GPU 使用衝突: Compose で専用 GPU を予約し、負荷計測を行う。timeout/リトライを backend 側で設定。
- 依存ビルド失敗: torch 付きベースイメージを固定し、requirements から torch 系を除外。モデルDLは初回起動時に分離して実行。
