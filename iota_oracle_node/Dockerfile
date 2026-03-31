# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    dnsutils \
    poppler-utils \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

RUN --mount=type=cache,target=/root/.npm \
    npm ci --registry=https://registry.npmjs.org/ --no-audit --fund=false --loglevel=info

COPY . .

RUN mkdir -p /app/storage /app/keys

ENV NODE_ENV=production
ENV STORAGE_DIR=/app/storage
ENV NODE_OPTIONS=--dns-result-order=ipv4first

CMD ["npm", "run", "daemon", "--", "--node", "1"]
