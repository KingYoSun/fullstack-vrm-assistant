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

## sherpa-onnx (cu128) のビルド
1. ソース取得:
   ```bash
   git clone https://github.com/k2-fsa/sherpa-onnx.git /tmp/sherpa-onnx
   ```
2. ビルド:
   ```bash
   cd /tmp/sherpa-onnx
   CIBW_ARCHS_LINUX=aarch64 \
   CIBW_PLATFORM=linux \
   CIBW_ENVIRONMENT='CUDA_HOME=/usr/local/cuda CUDACXX=/usr/local/cuda/bin/nvcc CXXFLAGS="-include cstdint"' \
   cibuildwheel --output-dir ~/fullstack-vrm-assistant/wheels/sherpa-onnx
   ```
3. 成果物: `wheels/sherpa-onnx/sherpa_onnx-1.12.18-*.whl`

## torch 2.8.0+cu126 (aarch64) のビルド
PyPI に aarch64+cu126 wheel が無いため、ソースビルドが必要です。`cibuildwheel` を使って aarch64 向け wheel を生成します（ビルドに時間がかかります）。

1. ソース取得:
   ```bash
   git clone --branch v2.8.0 https://github.com/pytorch/pytorch.git /tmp/pytorch
   cd /tmp/pytorch
   git submodule update --init --recursive
   ```
2. ビルド（cu126, aarch64）: SVE/bf16 パスで GCC が ICE を出すため、必ず NEON 固定 + SVE 無効を CMake に渡すこと。PyTorch は `CMAKE_ARGS` ではなく `PYTORCH_CMAKE_ARGS` を見る点に注意。
   ```bash
   export USE_CUDA=1
   export CUDA_HOME=/usr/local/cuda
   export TORCH_CUDA_ARCH_LIST="12.1"   # 実機に合わせて指定
   export USE_NCCL=1
   export USE_XNNPACK=0
   export CFLAGS="-march=armv8.2-a+fp16"
   export CXXFLAGS="-march=armv8.2-a+fp16"
   export SKBUILD_CMAKE_ARGS="-DCPU_CAPABILITY=NEON -DATEN_CPU_CAPABILITY=NEON -DUSE_SVE=OFF -DUSE_SVE2=OFF -DUSE_BF16=OFF"
   export CIBW_ENVIRONMENT="USE_CUDA=1 USE_XNNPACK=0 CUDA_HOME=/usr/local/cuda TORCH_CUDA_ARCH_LIST=12.1 USE_NCCL=1 CFLAGS='${CFLAGS}' CXXFLAGS='${CXXFLAGS}' SKBUILD_CMAKE_ARGS='${SKBUILD_CMAKE_ARGS}'"
   CIBW_ARCHS_LINUX=aarch64 \
   CIBW_PLATFORM=linux \
   CIBW_ENVIRONMENT="USE_CUDA=1 USE_XNNPACK=0 CUDA_HOME=/usr/local/cuda TORCH_CUDA_ARCH_LIST=12.1 USE_NCCL=1 CFLAGS='${CFLAGS}' CXXFLAGS='${CXXFLAGS}' SKBUILD_CMAKE_ARGS='${SKBUILD_CMAKE_ARGS}'" \
   cibuildwheel --output-dir ~/fullstack-vrm-assistant/wheels/torch
   ```
3. 成果物: `wheels/torch/torch-2.8.0+cu126-*.whl`

## Docker ビルドで wheel を使う
- `docker/tts-openvoice/Dockerfile` と `docker/stt-sherpa/Dockerfile` は `/wheels` を参照する前提で書き換えてください（例: `COPY wheels /wheels` とし、`pip install /wheels/torch/torch-*.whl`）。
- `docker-compose.yml` の `tts`/`stt` ビルドコンテキストはリポジトリルートにし、`wheels` ディレクトリが含まれるようにします。
- wheel が無い場合はビルドが失敗する設定にしておくと、誤って CPU 版や不正な wheel を拾うリスクを避けられます。

## 注意
- torch のソースビルドは数時間かかります。十分なディスク/GPU メモリを確保してください。
- `TORCH_CUDA_ARCH_LIST` は実機の SM に合わせて設定してください（DGX Sparkは12.1）。
- ビルド後、`wheels/` ディレクトリは `.dockerignore` に含めないでください（Docker ビルドで参照するため）。
