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

RUN printf "registry=https://registry.npmjs.org/\n" > /root/.npmrc \
 && npm config set registry https://registry.npmjs.org/ \
 && npm config set fetch-retries 5 \
 && npm config set fetch-retry-mintimeout 20000 \
 && npm config set fetch-retry-maxtimeout 120000 \
 && env -u NPM_CONFIG_REGISTRY -u npm_config_registry npm ci --no-audit --fund=false --loglevel=verbose --foreground-scripts --progress=false

COPY . .

RUN mkdir -p /app/storage /app/keys

ENV NODE_ENV=production
ENV STORAGE_DIR=/app/storage
ENV NODE_OPTIONS=--dns-result-order=ipv4first

CMD ["npm", "run", "daemon", "--", "--node", "1"]
