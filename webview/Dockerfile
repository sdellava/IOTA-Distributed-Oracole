# syntax=docker/dockerfile:1
FROM node:20-alpine

RUN apk add --no-cache libc6-compat python3 make g++

WORKDIR /workspace

COPY webview/package*.json ./webview/
COPY webview/.env ./webview/.env
COPY client/package*.json ./client/

RUN npm config set registry https://registry.npmjs.org/

RUN --mount=type=cache,target=/root/.npm \
    cd /workspace/webview && \
    npm install --no-audit --fund=false --loglevel=info && \
    cd /workspace/client && \
    npm install --no-audit --fund=false --loglevel=info

COPY webview ./webview
COPY client ./client

WORKDIR /workspace/webview

RUN npm run build

ENV ORACLE_CLIENT_DIR=/workspace/client
ENV ORACLE_EXAMPLES_DIR=/workspace/webview/examples

EXPOSE 3000

CMD ["npm", "run", "start"]
