# syntax=docker/dockerfile:1
FROM node:20-alpine

RUN apk add --no-cache libc6-compat python3 make g++

WORKDIR /app

COPY package*.json ./

RUN npm config set registry https://registry.npmjs.org/

RUN --mount=type=cache,target=/root/.npm \
    npm install --no-audit --fund=false --loglevel=info

COPY . .

RUN npm run build

EXPOSE 3000

CMD ["npm", "run", "start"]
