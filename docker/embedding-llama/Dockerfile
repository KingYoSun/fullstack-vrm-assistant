# llama-embd/Dockerfile
FROM nvidia/cuda:13.0.2-devel-ubuntu24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      git build-essential cmake ca-certificates libcurl4-openssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/llama.cpp

# 最新の llama.cpp を取得して CUDA 対応でビルド
RUN git clone --depth=1 https://github.com/ggml-org/llama.cpp . \
 && cmake -B build -S . -DGGML_CUDA=ON -DGGML_CUDA_NO_VMM=ON \
 && cmake --build build --config Release -j

# strip は別 RUN にして、ここだけ失敗してもスルー
RUN strip /opt/llama.cpp/build/bin/* || true

# モデルをマウントするディレクトリ
RUN mkdir -p /models

# 起動スクリプトをコピー
COPY ./docker/embedding-llama/run-embed.sh /usr/local/bin/run-embd.sh
RUN chmod +x /usr/local/bin/run-embd.sh

EXPOSE 9000

ENTRYPOINT ["/usr/local/bin/run-embd.sh"]
