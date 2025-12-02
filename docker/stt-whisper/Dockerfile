# whisper-stt/Dockerfile
FROM nvidia/cuda:13.0.2-devel-ubuntu24.04

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
      git build-essential cmake ca-certificates ffmpeg libcurl4-openssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/whisper.cpp

# whisper.cpp を CUDA 対応でビルド
RUN git clone --depth=1 https://github.com/ggml-org/whisper.cpp . \
 && cmake -B build -S . -DGGML_CUDA=ON -DGGML_CUDA_NO_VMM=ON \
 && cmake --build build --config Release -j

# strip は別 RUN にして、ここだけ失敗してもスルー
RUN strip build/bin/* || true

RUN mkdir -p /models

COPY ./docker/stt-whisper/run-stt.sh /usr/local/bin/run-stt.sh
RUN chmod +x /usr/local/bin/run-stt.sh

EXPOSE 6006

ENTRYPOINT ["/usr/local/bin/run-stt.sh"]
