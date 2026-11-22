# Stage 1: Build do Monorepo (Contracts, WhatsApp, Daemon e Cockpit Web)
FROM node:22-bookworm-slim AS builder

WORKDIR /app
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/whatsapp/package.json ./packages/whatsapp/
COPY apps/daemon/package.json ./apps/daemon/
COPY apps/web/package.json ./apps/web/

RUN npm install

COPY packages ./packages
COPY apps ./apps

RUN npm run build:all && test -f apps/web/dist/index.html

# Stage 2: Runtime enxuto com FFmpeg e Chromium para Remotion e Browser Automation
FROM node:22-bookworm-slim AS runtime

RUN apt-get update -y && apt-get install -y --no-install-recommends \
    ffmpeg \
    chromium \
    ca-certificates \
    curl \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    CRIATIVO_DB_PATH=/data/criativo.db \
    CRIATIVO_SOCKET_PATH=/tmp/criativo-control.sock \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app
COPY --from=builder /app/package.json /app/tsconfig.base.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps ./apps
COPY scripts ./scripts

RUN test -f apps/web/dist/index.html && mkdir -p /data && useradd --system --create-home criativo && chown -R criativo:criativo /data /app
USER criativo

EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/health || exit 1

CMD ["node", "apps/daemon/dist/server/daemon-server.js"]
