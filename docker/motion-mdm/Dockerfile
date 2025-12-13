# Motion Diffusion Model motion service (stub) with CUDA 13.0 base

FROM nvidia/cuda:13.0.2-devel-ubuntu24.04

ENV DEBIAN_FRONTEND=noninteractive \
    PIP_NO_CACHE_DIR=1 \
    PIP_DEFAULT_TIMEOUT=100 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_BREAK_SYSTEM_PACKAGES=1 \
    PIP_INDEX_URL=https://pypi.org/simple

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      software-properties-common ca-certificates curl git python3.12 python3.12-dev python3-pip ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace/motion_service

COPY motion_service/requirements.txt /workspace/motion_service/requirements.txt
RUN python3.12 -m pip install --no-cache-dir -r requirements.txt \
    && python3.12 -m pip install --no-cache-dir torch==2.9.0 torchvision==0.24.0 --index-url https://download.pytorch.org/whl/cu130

COPY motion_service /workspace/motion_service

ENV MOTION_PORT=7100 \
    DATA_ROOT=/data \
    OUTPUT_DIR=/data/animations \
    DATA_MOUNT_PATH=/data \
    CHECKPOINT_DIR=/checkpoint_dir \
    PYTHONUNBUFFERED=1 \
    PYTHONPATH=/workspace

EXPOSE 7100

CMD ["python3.12", "-m", "motion_service.main"]
