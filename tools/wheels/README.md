# aarch64 CUDA wheel ビルド手順 (DGX Spark 用)

DGX Spark（aarch64）で CUDA を使うため、PyPI にない aarch64 + CUDA の wheel をローカルで用意します。`cibuildwheel` を使い、成果物は `wheels/` 配下に置いて Docker ビルド時に参照します。

## 事前準備
- CUDA Toolkits: `/usr/local/cuda`（cu126/ cu128 を利用）
- Python 3.12 系
- `python -m pip install cibuildwheel`
- buildx/barn/binfmt は不要（ホストが aarch64 ネイティブのため）
- ディレクトリ構成（例）:
  ```
  fullstack-vrm-assistant/
    wheels/
      torch/          # torch 2.8.0+cu126 wheel をここに出力
      sherpa-onnx/    # sherpa-onnx 1.12.18 wheel をここに出力
  ```
