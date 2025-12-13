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
      software-properties-common ca-certificates curl git python3.12 python3.12-dev python3-pip ffmpeg build-essential \
      pkg-config libfreetype6-dev libpng-dev libjpeg-dev libhdf5-dev python3-h5py \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace/motion_service

COPY motion_service/requirements.txt /workspace/motion_service/requirements.txt
RUN python3.12 -m pip install --no-cache-dir -r requirements.txt \
    && python3.12 -m pip install --no-cache-dir torch==2.9.0 torchvision==0.24.0 torchaudio==2.9.0 --index-url https://download.pytorch.org/whl/cu130 \
    && python3.12 -m pip install --no-cache-dir \
        spacy==3.7.4 smplx==0.1.28 chumpy==0.70 ftfy==6.1.1 regex==2022.9.13 \
        imageio==2.22.2 moviepy==1.0.3 tqdm==4.66.5 gdown==4.5.1 joblib==1.3.2 \
        matplotlib==3.8.3 transformers==4.38.2 \
    && python3.12 -m spacy download en_core_web_sm --direct \
    && python3.12 -m pip install --no-cache-dir --no-deps git+https://github.com/openai/CLIP.git

# Python 3.12 で chumpy が期待する inspect.getargspec を復元する sitecustomize を配置する。
# /usr/lib/python3.12/sitecustomize.py が先に読まれるため、PYTHONPATH=/workspace で上書きする。
COPY docker/motion-mdm/sitecustomize.py /workspace/sitecustomize.py

RUN git clone --depth=1 https://github.com/GuyTevet/motion-diffusion-model.git /workspace/motion-diffusion-model

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
