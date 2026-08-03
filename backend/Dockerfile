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

# MODバックアップ保存用ディレクトリを node ユーザー所有で事前作成しておく。
# こうしておくと、docker-composeの named volume (mod_backups) が初回マウント時に
# このディレクトリの内容（＝所有者情報）をコピーするため、root所有のvolumeが
# 作られず、非rootユーザーからも書き込める（EACCES対策）。
RUN mkdir -p /app/data/mod-backups && chown -R node:node /app/data

# 共有ホストディレクトリ（/home/maki/docker）に書き込むファイルがroot所有にならないよう、
# node:24-slim に組み込みの `node` ユーザー（uid/gid 1000、ホストの実運用ユーザーと一致）で実行する。
USER node

EXPOSE 3000
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/server.js"]
