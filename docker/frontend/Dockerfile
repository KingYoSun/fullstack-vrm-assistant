FROM node:20-bullseye

ENV PNPM_HOME="/root/.local/share/pnpm" \
    PATH="${PNPM_HOME}:${PATH}"

WORKDIR /workspace/frontend

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm build

CMD ["sh", "-c", "pnpm preview --host --port ${FRONTEND_PORT:-5173}"]
