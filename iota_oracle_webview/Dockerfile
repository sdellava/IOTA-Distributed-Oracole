# syntax=docker/dockerfile:1
FROM node:20-alpine

RUN apk add --no-cache libc6-compat python3 make g++

WORKDIR /workspace

COPY iota_oracle_webview/package*.json ./iota_oracle_webview/
COPY iota_oracle_webview/.env ./iota_oracle_webview/.env
COPY iota_oracle_client/package*.json ./iota_oracle_client/

RUN npm config set registry https://registry.npmjs.org/

RUN --mount=type=cache,target=/root/.npm \
    cd /workspace/iota_oracle_webview && \
    npm install --no-audit --fund=false --loglevel=info && \
    cd /workspace/iota_oracle_client && \
    npm install --no-audit --fund=false --loglevel=info

COPY iota_oracle_webview ./iota_oracle_webview
COPY iota_oracle_client ./iota_oracle_client

WORKDIR /workspace/iota_oracle_webview

RUN npm run build

ENV ORACLE_CLIENT_DIR=/workspace/iota_oracle_client
ENV ORACLE_EXAMPLES_DIR=/workspace/iota_oracle_webview/examples

EXPOSE 3000

CMD ["npm", "run", "start"]
