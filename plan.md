# minecraftMonitoring 設計書

## 0. 前提（ヒアリング結果）

- 公開範囲: VPN経由のみ（インターネット直接公開なし）
- 利用者: 複数人（友人など）→ ロールベースの権限管理が必要
- 技術スタック: おまかせ
- デプロイ: 既存 `../minecraft` と同様に Docker Compose で管理

VPN内とはいえ複数人がアクセスし、かつ「ファイル削除」「サーバー停止」という**取り返しのつきにくい操作**を扱うため、認証・権限・監査ログは省略せずきちんと設計する。

---

## 1. 全体アーキテクチャ

```
                         [ VPN内クライアント ]
                                 │ HTTPS
                                 ▼
                     ┌─────────────────────┐
                     │  Caddy (reverse proxy) │  ← TLS終端 / 静的配信 / WS proxy
                     └─────────────────────┘
                                 │
                                 ▼
                     ┌─────────────────────┐
                     │   app-backend (Node)  │
                     │  Fastify + TypeScript │
                     │  - REST API           │
                     │  - WebSocket (metrics)│
                     │  - Auth / RBAC        │
                     └───────┬───────┬───────┘
                              │       │
                 ┌────────────┘       └────────────┐
                 ▼                                  ▼
   ┌───────────────────────┐          ┌──────────────────────────┐
   │ docker-socket-proxy    │          │ RCON (25575, minecraft内)  │
   │ (start/stop/restart/   │          │ - stop/save-all/list等    │
   │  stats のみ許可)        │          └──────────────────────────┘
   └──────────┬─────────────┘
              ▼
      /var/run/docker.sock (host)
              │
              ▼
      minecraft コンテナ (既存)

   app-backend からのマウント:
   - ../minecraft/data   (rw, ファイル管理用)
   - /proc, /sys (ro)    (ホストCPU/メモリ取得用)
```

フロントエンドは静的ビルドして Caddy or app-backend から配信（SPA）。

---

## 2. コンポーネント構成

| コンポーネント | 技術 | 役割 |
|---|---|---|
| フロントエンド | React + TypeScript + Vite、UIは shadcn/ui または Mantine | ファイラーUI、操作パネル、監視ダッシュボード |
| バックエンド | Node.js + TypeScript + Fastify | REST API、WebSocket配信、認証、Docker/RCON制御 |
| DB | SQLite（better-sqlite3 or Prisma） | ユーザー・ロール・監査ログ（超小規模なのでSQLiteで十分） |
| リバースプロキシ | Caddy | TLS終端（VPN内でも盗聴対策として推奨）、gzip、WebSocket proxy |
| Docker制御 | docker-socket-proxy (tecnativa/docker-socket-proxy) | app-backend に直接 docker.sock を渡さず、許可するAPI（start/stop/restart/stats/logs）だけを中継 |
| Minecraft制御 | RCON (rcon-client npm) | graceful stop、save-all、プレイヤー一覧、TPS取得などゲーム内コマンド |
| ホストメトリクス | systeminformation (npm) | CPU使用率、メモリ使用率、ディスク使用量を取得しWSで配信 |

Node.js統一（Fastify）を選んだ理由: フロント/バックともTS共有可能、ファイルストリーミング（アップロード/ダウンロード/zip圧縮）やWebSocketの扱いがエコシステム的に成熟している。Pythonでも実現可能だが、フロントとの型共有・単一言語運用のメリットを優先。

---

## 3. ディレクトリ構成案

```
minecraftMonitoring/
├── docker-compose.yml
├── caddy/
│   └── Caddyfile
├── backend/
│   ├── src/
│   │   ├── routes/
│   │   │   ├── files.ts        # 一覧/アップロード/DL/rename/move/delete
│   │   │   ├── server.ts       # start/stop/restart/status
│   │   │   ├── metrics.ts      # WS: CPU/Mem/Minecraft状態
│   │   │   └── auth.ts         # login/logout/session
│   │   ├── services/
│   │   │   ├── dockerControl.ts
│   │   │   ├── rcon.ts
│   │   │   ├── fsSafe.ts       # パストラバーサル対策込みFS操作
│   │   │   └── metricsCollector.ts
│   │   ├── middleware/
│   │   │   ├── requireAuth.ts
│   │   │   └── requireRole.ts
│   │   ├── db/
│   │   │   └── schema.ts       # users, sessions, audit_log
│   │   └── server.ts
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── pages/ (Files, Dashboard, ServerControl, Login, Users)
│   │   └── components/
│   └── package.json
└── data/
    └── app.db                  # SQLite（bind mount, 永続化）
```

---

## 4. 認証・権限設計

- セッションベース認証（httpOnly + Secure + SameSite=Strict cookie）。VPN内限定でもクッキー窃取対策として必須。
- パスワードは argon2 でハッシュ化。
- 状態変更系エンドポイント（POST/PUT/DELETE）には CSRF トークン（double-submit cookie）を必須化。
- ロールは2種類で開始:
  - **admin**: ファイル全操作（アップロード/DL/rename/削除）、サーバー start/stop/restart、ユーザー管理
  - **member**: サーバー状態閲覧、restart のみ可、ファイルは閲覧・ダウンロードのみ（削除/アップロード不可）
- 初期ユーザーは環境変数 or 初回セットアップ画面で作成。招待制（自己登録なし）。
- 監査ログ（audit_log テーブル）: 誰が・いつ・何を（delete/rename/upload/stop/restart）実行したかを記録し、管理画面で閲覧可能に。友人間の「誰が消した/止めた」問題を防ぐために重要。

---

## 5. ファイル管理機能

### API例
| メソッド | パス | 説明 |
|---|---|---|
| GET | `/api/files?path=` | ディレクトリ一覧（ツリー or 単階層） |
| GET | `/api/files/download?path=` | 単一ファイルDL（ストリーム） |
| GET | `/api/files/download-zip?path=` | フォルダをzip化してストリームDL |
| POST | `/api/files/upload?path=` | アップロード（multipart, ストリーム保存） |
| POST | `/api/files/rename` | `{from, to}` |
| POST | `/api/files/move` | `{from, to}` |
| DELETE | `/api/files?path=` | 削除（確認ダイアログ必須・監査ログ必須） |

### セキュリティ設計（最重要）
- 操作対象パスは常に `../minecraft/data` 配下に**正規化(path.resolve)した上で prefix チェック**し、`..` によるパストラバーサルを遮断。
- シンボリックリンクは辿らない（`fs.realpath` で検証、外部を指すリンクは拒否）。
- アップロードはサイズ上限・拡張子/内容チェック（実行ファイル系は許可しないなど）。
- `world/`, `world_old/` のような稼働中データを扱う操作は、サーバー稼働中は警告表示（ワールド破損防止のため、書き込み系操作はサーバー停止中のみ許可、という運用ルールを検討）。
- 削除は即時ではなく、まずゴミ箱的な一時退避（`.trash/` へmove）→ 一定期間後に物理削除、のワンクッション運用を推奨（誤削除対策）。

---

## 6. Minecraftサーバー制御

- **停止**: RCON経由で `save-all` → `stop` を送る（itzgイメージのgraceful stop相当）。RCON接続不可時は docker-socket-proxy 経由で `docker stop`（SIGTERM、イメージ側でgraceful処理される）にフォールバック。
- **起動**: docker-socket-proxy 経由で `docker start`。
- **再起動**: 停止シーケンス→起動、を内部で連結。
- **状態取得**: コンテナのHealth/Running状態 + RCONで `list`（オンラインプレイヤー） + 可能であれば TPS。
- 実行前に確認ダイアログ + 監査ログ記録（誰が停止/再起動したか）。

---

## 7. CPU / メモリ可視化

- `app-backend` コンテナに **ホストの `/proc`, `/sys` を read-only でマウント**し、`systeminformation` ライブラリでホスト全体のCPU/メモリ/ディスク使用率を取得（コンテナ自身のcgroup値ではなくPC全体の値を見るため）。
- 数秒間隔でポーリングし、WebSocketでフロントにpush → フロントは直近の時系列を折れ線グラフ表示（Recharts等）。
- 合わせて minecraftコンテナ単体のCPU/メモリ（`docker stats` 相当、socket-proxy経由）も出せると「Minecraftがどれだけ食ってるか」が分かり実用的（オプション機能として提案）。
- ダッシュボードに載せると良い情報: ホストCPU%、ホストメモリ%、ディスク空き容量（world肥大化の監視）、Minecraftコンテナ状態、オンラインプレイヤー数。

---

## 8. docker-compose.yml 構成イメージ（サービス一覧のみ、コード実装はしない）

```yaml
services:
  caddy:
    # 80/443 を公開、app-backend へリバースプロキシ

  app-backend:
    build: ./backend
    volumes:
      - ../minecraft/data:/mnt/minecraft-data     # ファイル管理対象
      - ./data:/app/data                          # SQLite永続化
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
    environment:
      - DOCKER_HOST=tcp://docker-socket-proxy:2375
      - RCON_HOST=minecraft
      - RCON_PORT=25575

  docker-socket-proxy:
    image: tecnativa/docker-socket-proxy
    environment:
      CONTAINERS: 1
      START: 1
      STOP: 1
      RESTART: 1
      POST: 1     # start/stop/restartに必要な範囲のみ
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
```

`docker-socket-proxy` を挟むのが最大のポイント。app-backendに直接 `docker.sock` を渡すとコンテナ内から実質ホストroot権限が取れてしまうため、複数人がアクセスするアプリでは特に避けたい。

---

## 9. 実装フェーズ案（段階的に進める場合）

1. **Phase 1**: 認証基盤 + ダッシュボード（CPU/メモリ表示のみ）
2. **Phase 2**: Minecraft start/stop/restart（RCON + docker-socket-proxy）
3. **Phase 3**: ファイル管理（一覧・DL・アップロード。まずは閲覧系から）
4. **Phase 4**: rename/move/delete（破壊的操作、ゴミ箱運用込み）
5. **Phase 5**: 監査ログ画面、ユーザー管理画面、通知（Discord Webhook等でサーバー状態変化を通知すると便利）

---

## 10. 今後の検討事項

- TLS証明書: VPN内なので自己署名 or Caddyの内部CAで十分。将来的な外部公開時はLet's Encrypt検討。
- バックアップ: worldフォルダの定期バックアップ（cron + tar）は本アプリのスコープ外だが、ダッシュボード上に「最終バックアップ日時」を表示する連携は有用。
- 通知: サーバーダウン検知やCPU高負荷アラートをDiscord Webhookに飛ばす拡張。
- テキストファイル編集: `server.properties` や `config/*` の中身をブラウザ上で直接編集できるエディタ機能はファイル管理の自然な拡張（要望あれば追加設計）。
