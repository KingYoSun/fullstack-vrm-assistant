# 進行中タスク

- 調査/対応: docker compose ヘルスチェック失敗（backend/embedding/llm/stt/tts の health/restart 確認と対策案整理）
  - backend: apt-get install 行を 1 行に修正し再起動、`vrm-backend` は healthy を確認。
  - llm: command を entrypoint (`vllm serve`) 前提に修正済みだが、`/models/gpt-oss-120b` に config.json 等が無く起動失敗。モデル配置 or マウントが必要。
  - embedding: Candle backend が runtime compute cap 121 / compile cap 120 で不整合。GB10 対応の tei-cuda-arm64 を再ビルドするか、CPU fallback イメージに差し替えて health を通すタスクが残。
  - stt: エントリーポイントを CLI 実行に切替（環境変数で `sherpa-onnx-offline-websocket-server` を呼び出す＋LD_LIBRARY_PATH 設定）。モデルファイル `/models/*.onnx`/tokens.txt が未配置で起動失敗中。モデル配置後に再確認。
  - tts: NGC PyTorch 25.08 (torch 2.8 nightly) が GB10 未対応で `torch.hash_tensor` AttributeError。GB10 対応 torch/cu イメージへ入れ替えるか CPU fallback に切替えるタスクが残。
- 動作確認: partial STT レイテンシ (p95 < 0.5s)
  - dev/prod compose を起動しブラウザから 10〜20 回短文を発話。WS `partial` イベントの `latency_ms` もしくは受信時刻から p95 を算出し 500ms 未満を記録（ログ/スクリーンショット添付）。
- 動作確認: 発話停止→LLM/TTS 再生開始レイテンシ (p95 < 2s)
  - 同一セッションで 10〜20 回の発話を行い、end-of-speech から最初の TTS チャンク受信までの `latency_ms` またはログを計測。p95 が 2s 未満であることを確認し証跡を残す。
- 動作確認: three-vrm 表示とリップシンク
  - フロントの VRM が読み込まれ、TTS 再生中に `avatar_event`/音量に応じて口パクが動くことを画面録画で確認（任意の VRM 切替も含める）。
- 動作確認: RAG 応答の正答性
  - サンプル文書を ingest し、文書由来の問いを複数投げて LLM 応答に引用/文脈が含まれることを確認（ログに request_id と出典断片を残す）。
- 動作確認: `docker compose up` 一発起動（dev/prod）
  - dev/prod 用 compose それぞれで `docker compose up` が通り、環境変数/エンドポイントが `config/providers.yaml` から正しく解決されることを確認（起動ログと ready/health の応答を保存）。
