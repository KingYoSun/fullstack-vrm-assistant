ARG BACKEND=cpu
ARG CUDA_VER=12.8.0
ARG PYTHON_VERSION=3.12

FROM nvidia/cuda:${CUDA_VER}-cudnn-runtime-ubuntu22.04 AS base-cuda
ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1
ARG PYTHON_VERSION
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      software-properties-common ca-certificates curl gnupg ffmpeg libgomp1 \
    && add-apt-repository -y ppa:deadsnakes/ppa \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
      python${PYTHON_VERSION} python${PYTHON_VERSION}-venv \
    && update-alternatives --install /usr/bin/python3 python3 /usr/bin/python${PYTHON_VERSION} 1 \
    && python3 -m ensurepip --upgrade \
    && python3 -m pip install --upgrade pip setuptools wheel \
    && rm -rf /var/lib/apt/lists/*

FROM python:3.12-slim AS base-cpu
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg libgomp1 ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

FROM base-${BACKEND} AS runtime
ARG BACKEND
ARG CUDA_VER

COPY wheels /wheels

WORKDIR /app

RUN python3 -m pip install -U pip setuptools wheel
RUN python3 -m pip install --no-cache-dir websockets
RUN python3 -m pip install --no-deps "/wheels/sherpa-onnx/sherpa_onnx-1.12.18-cp312-cp312-manylinux_2_27_aarch64.manylinux_2_28_aarch64.whl"

COPY docker/stt-sherpa/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 6006
ENTRYPOINT ["/entrypoint.sh"]
