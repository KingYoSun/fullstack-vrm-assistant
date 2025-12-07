# syntax=docker/dockerfile:1

ARG UBUNTU_VERSION=24.04
ARG CUDA_VERSION=13.0.2
ARG BASE_CUDA_DEV_CONTAINER=nvidia/cuda:${CUDA_VERSION}-devel-ubuntu${UBUNTU_VERSION}
ARG BASE_CUDA_RUN_CONTAINER=nvidia/cuda:${CUDA_VERSION}-runtime-ubuntu${UBUNTU_VERSION}

# ---- build ----
FROM ${BASE_CUDA_DEV_CONTAINER} AS build

# DGX Spark (GB10) は compute capability 12.1 = sm_121
ARG CUDA_DOCKER_ARCH=121

# 任意: ビルドしたい llama.cpp の ref（空ならデフォルトブランチ）
ARG LLAMA_CPP_REPO=https://github.com/ggml-org/llama.cpp.git
ARG LLAMA_CPP_REF=""

# GB10 向け: compat ライブラリを優先（ビルド時のリンク問題を避ける）
ENV LD_LIBRARY_PATH=/usr/local/cuda-13/compat:${LD_LIBRARY_PATH}

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake git ca-certificates \
    python3 python3-pip \
    libcurl4-openssl-dev libgomp1 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /src
RUN git clone ${LLAMA_CPP_REPO} llama.cpp
WORKDIR /src/llama.cpp
RUN if [ -n "${LLAMA_CPP_REF}" ]; then git checkout "${LLAMA_CPP_REF}"; fi

RUN cmake -B build \
      -DGGML_CUDA=ON \
      -DLLAMA_CURL=ON \
      -DCMAKE_BUILD_TYPE=Release \
      -DCMAKE_CUDA_ARCHITECTURES=${CUDA_DOCKER_ARCH} \
  && cmake --build build -j"$(nproc)"

# runtime に必要なものだけコピー
RUN mkdir -p /out \
  && cp build/bin/llama-server /out/ \
  && find build -name "*.so*" -exec cp -P {} /out/ \;

# ---- server runtime ----
FROM ${BASE_CUDA_RUN_CONTAINER} AS server

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgomp1 curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /out/ /app/

# 共有ライブラリを確実に見つける & compat も入れておく
ENV LD_LIBRARY_PATH=/app:/usr/local/cuda-13/compat:${LD_LIBRARY_PATH}
ENV LLAMA_ARG_HOST=0.0.0.0

EXPOSE 8080
HEALTHCHECK CMD ["curl", "-f", "http://localhost:8080/health"]
ENTRYPOINT ["/app/llama-server"]
