FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY src/db/migrations ./dist/db/migrations

# 共有ホストディレクトリ（/home/maki/docker）に書き込むファイルがroot所有にならないよう、
# node:24-slim に組み込みの `node` ユーザー（uid/gid 1000、ホストの実運用ユーザーと一致）で実行する。
USER node

EXPOSE 3000
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/server.js"]
