FROM node:20-bullseye

ENV PNPM_HOME="/root/.local/share/pnpm" \
    PATH="${PNPM_HOME}:${PATH}"

WORKDIR /workspace/frontend

ARG VITE_WS_BASE_URL
ARG VITE_BACKEND_HOST
ARG VITE_BACKEND_PORT
ARG VITE_WS_PATH=/ws/session

ENV VITE_WS_BASE_URL=${VITE_WS_BASE_URL} \
    VITE_BACKEND_HOST=${VITE_BACKEND_HOST} \
    VITE_BACKEND_PORT=${VITE_BACKEND_PORT} \
    VITE_WS_PATH=${VITE_WS_PATH}

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm build

CMD ["sh", "-c", "pnpm preview --host --port ${FRONTEND_PORT:-5173}"]
