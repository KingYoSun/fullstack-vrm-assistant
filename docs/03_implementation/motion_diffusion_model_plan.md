# Motion Diffusion Model 統合計画（2025年12月13日）

## 公式実装インプット（/home/kingyosun/motion-diffusion-model）
- 推論エントリは `python -m sample.generate`。`--model_path` 必須、`--text_prompt|--input_text` でテキスト指定、`--guidance_param` (デフォルト 2.5)、`--motion_length` (秒, humanml 最大 9.8s)、`--seed`/`--device`あり。出力は `samples_<model>_<iter>_seed<seed>/` に `results.npy`（motion: [N, 22, 6, T], text, lengths）、`sample##_rep##.mp4`、`samples_*.mp4` を生成。
- DiP（10 diffusion steps, autoregressive）は `python -m sample.generate --model_path save/target_10steps_context20_predict40/model000200000.pt --autoregressive --guidance_param 7.5 --text_prompt "..."` が公式手順。2 秒×繰り返しで伸長し、`--dynamic_text_path` で逐次プロンプト変更可能。
- 必須アセット: `prepare/download_smpl_files.sh` で SMPL、`prepare/download_glove.sh` / `prepare/download_t2m_evaluators.sh`、`dataset/HumanML3D`（texts/new_joint_vecs/meta/test.txt などフル構成）、`python -m spacy download en_core_web_sm`、`git+https://github.com/openai/CLIP.git`。データセットが無いと DataLoader 初期化で即エラー。
- チェックポイント: `save/humanml_trans_dec_512_bert-50steps/model000200000.pt`（推奨 50 steps/BERT, 20fps, ~0.4s/サンプル）、`save/humanml-encoder-512-50steps/model000200000.pt`（encoder版）、DiP `save/target_10steps_context20_predict40/model000200000.pt`（HuggingFace 配布）。`opt.txt`/`meta/mean.npy`/`meta/std.npy` を同梱。
- JSON 出力例は `sample/predict.py`（Replicate 用）が参照可能。`motions2hik` で SMPL 22 関節を HumanIK 名付き `joint_map`、`thetas`（Euler deg, [reps, frames, joints, 3]）、`root_translation`（[reps, frames, 3]）に変換している。

## ランタイム/コンテナ方針
- GPU: sm_121 / CUDA 13.0 前提。ベースイメージは CUDA 13.0 系（例: `nvidia/cuda:13.0.x`）で Python 3.10 または 3.12 を利用する。PyTorch は DGX Spark で動作確認済みの `torch==2.9.0 torchvision==0.24.0 torchaudio==2.9.0 --index-url https://download.pytorch.org/whl/cu130` を固定する。
- 追加インストール: ffmpeg、spacy 3.3.1、smplx 0.1.28、moviepy 1.0.3、gdown 4.5.x、wandb 0.15.x、`git+https://github.com/openai/CLIP.git`。ビルド時に `python -m spacy download en_core_web_sm` を実行。`requirements.txt` を motion_service とは分離して `docker/motion-mdm/requirements.txt` にピン留め。
- Compose の Volume 方針は現状維持: `MOTION_MODEL_DIR=/checkpoint_dir`（チェックポイント+opt/meta）、`MOTION_DATA_DIR=/data/motion`（HumanML3D 等）、`OUTPUT_DIR=/data/animations`。`./data` 全体も読み書きできるよう現行のバインドを残す。
- prod/dev で同一イメージを使い、dev は `motion_service` を bind mount してホットリロードしつつ、推論コードは `/workspace/motion_service/mdm_adapter.py` などローカルファイルを参照する。
- PyTorch 導入は `docker/tts-fish-speech/Dockerfile` 同様に Dockerfile 内で完結させ、CPU 版インストール → 上記バージョンを `--index-url https://download.pytorch.org/whl/cu130` で上書きする手順を採用する。

## モデル/データ配置計画
- モデル配置（ローカル `./models/motion` → コンテナ `/checkpoint_dir`）:
  - `mdm/humanml_trans_dec_512_bert-50steps/model000200000.pt`（推奨本線）
  - `mdm/humanml-encoder-512-50steps/model000200000.pt`（比較用）
  - `dip/target_10steps_context20_predict40/model000200000.pt`（超高速オプション）
  - 各ディレクトリに `opt.txt` と `meta/{mean.npy,std.npy}` を保持。
- データ配置（ローカル `./data/motion` → `/data/motion`）:
  - `dataset/HumanML3D/` 一式（texts/new_joint_vecs/meta/test.txt など）。最低限 test split が必要だが、prefix completion/DiP で全体を読むのでフルで置く。
  - `body_models/smpl/`（`prepare/download_smpl_files.sh` の展開先）。`SMPL_MODEL_DIR` を環境変数かパス解決で参照。
- 取得導線:
  - `tools/motion/download_mdm_assets.sh` を新設し、HumanML3D/SMPL/各 checkpoint をダウンロード → SHA256/サイズを出力 → `./models/motion/.gitignore` で大容量を除外。
  - `.env.default` の `MOTION_MODEL_DIR`/`MOTION_DATA_DIR` 説明に HumanML3D/SMPL 必須である旨を追記予定。
  - 再ダウンロードを避けるため、モデル/データは必ずホストの `./models/motion` / `./data/motion` にキャッシュし、コンテナはバインドマウントで参照する（CI では optional）。
  - 大容量のダウンロード処理は Dockerfile では行わず、`./scripts/motion/` 配下のスクリプトで実行する（Docker ビルド時間短縮）。

## 推論フロー/統合案
- FastAPI (`motion_service.main`) からの呼び出しで `mdm_adapter` を初期化し、GPU 上にモデルを常駐させる。リクエスト → テキスト正規化 → `generate` 呼び出し → VRM JSON 化 → `OUTPUT_DIR/job_id.json` へ保存。
- API を 2 系統用意する: `POST /v1/motion/generate` は通常（50steps/BERT）を使うデフォルト、`POST /v1/motion/generate/dip` は DiP オートレグレッシブモデルを利用（ガイダンス/長さ固定 2s×繰り返し）。クライアントはプロバイダ指定 or エンドポイントで明示的に切替。
- `MotionGenerateRequest` → MDM 引数対応:
  - `prompt` → `--text_prompt`
  - `seed` → `--seed`
  - `steps` → DiP は固定 10、通常は `--diffusion_steps` を opt から読むか `skip_timesteps` で調整（検証時に決定）
  - `guidance` → `--guidance_param`（デフォルト 2.5 / DiP は 7.5）
  - `duration_sec` → `--motion_length`（デフォルト 5.0s、HumanML3D 最大 9.8s）
  - `fps` → MDM 実体は 20fps 固定なので、レスポンスも 20fps で返すか、補間して要求 fps に合わせるオプションをメタデータで切り替え（初期は 20fps 固定で実装し、Diagnostics で確認）。
- 出力変換:
  - `sample.generate` 結果の `results.npy`（[bs, 22, 6, T]）を直接扱い、`motions2hik` 相当の変換を motion_service 内に組み込み、Euler deg → quaternion に変換して `tracks`（VRM Humanoid 名: hips, spine, chest, neck, head, leftUpperLeg, …, rightToeBase）と `root_position` を組み立てる。
  - リターゲット時にボーン順を `JOINT_MAP` から VRM にマップする表を定義し、欠損ボーンはスキップ or 恒等回転。root は Hips の並進を使用。
  - `metadata` に `generator=mdm|dip`, `checkpoint`, `seed`, `guidance_param`, `fps=20`, `motion_length`, `prompt` を保存。デバッグ用に `results.npy`/`sample00_rep00.mp4` も同ディレクトリに出力（UI には URL のみ返す）。
- フロント/Diagnostics: 生成ファイルパス (`url`) とメタデータを返し、VRM 再生は 20fps 前提で実装。プレースホルダ利用時は既存の警告ログを流用。

## 実装タスク
1. **motion-mdm イメージ整備**: 新規 Dockerfile で PyTorch(CUDA 対応, torch==2.9.0/cu130) + 依存をインストールし、`download_mdm_assets.sh` を実行可能にし、`MOTION_MODEL_DIR`/`MOTION_DATA_DIR` を ENV で受け取る。
2. **mdm_adapter 実装**: `motion_service` に推論ラッパを追加し、モデルロード・推論（generate/predict 相当）・VRM JSON 化・メタデータ整備を行う。失敗時は現行プレースホルダを継続。通常版/DiP 版 API を分岐実装する。
3. **Backend/Frontend 接続**: backend MotionClient を MDM に接続し、Diagnostics API/WS で `metadata.url` と fps を返却。frontend Diagnostics/再生で 20fps を前提に再生し、プレースホルダ時は警告表示。
4. **モデル/データ導線ドキュメント化**: README/.env.default に HumanML3D/SMPL の配置とダウンロード手順を追記し、`models/motion`/`data/motion` の ignore 設定を整理。`./scripts/motion/` にダウンロードスクリプトを配置し、Dockerfile では大容量取得を行わない方針を明記。

## メトリクス/検証
- 5s テキストプロンプトでの推論時間（GPU 1 枚, 50-steps モデル vs DiP 10-steps）を実測し、Diagnostics に記録。
- 出力 `tracks/root_position` が VRM 再生できることを手動確認（20fps, 30fps 補間 ON/OFF）。
- 例外時に placeholder へフェールオーバーし、`metadata.generator` が `placeholder` になることを確認。
- 生成ファイル（json/mp4/npy）が `OUTPUT_DIR` に保存され、`url` がホストから参照できることを確認。
