# minecraftMonitoring 設計書

## 0. 前提（ヒアリング結果）

- 公開範囲: VPN経由のみ（インターネット直接公開なし）
- 利用者: 複数人（友人など）→ ロールベースの権限管理が必要
- 技術スタック: おまかせ
- デプロイ: 既存 `../minecraft` と同様に Docker Compose で管理
- サーバー制御: RCONではなく **dockerコマンド優先**（既存 `minecraft` コンテナは itzg/minecraft-server イメージで、`docker stop`=SIGTERM時にentrypoint側でgraceful stop処理されるため、docker操作だけで十分安全に止められる）
- 将来的に **複数のMinecraftサーバーを追加**する前提で、管理対象をアプリ側からすぐ切り替え・追加できる設計にする（＝設定ファイルを都度書き換えず拡張できる、という意味の「冗長化」と解釈。アプリ自体のレプリカ/HA構成は対象外）
- DB: **PostgreSQL**
- リバースプロキシ: **Caddy**（nginxでも技術的には代替可。VPN内単一アプリ+WebSocket用途ではCaddyの方が設定量が少ないため引き続き推奨）

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
                     │  - REST API            │
                     │  - WebSocket (metrics) │
                     │  - Auth / RBAC         │
                     │  - サーバーレジストリ    │
                     └───┬───────┬───────┬───┘
                          │       │       │
              ┌───────────┘       │       └───────────┐
              ▼                   ▼                   ▼
┌───────────────────────┐  ┌────────────┐   ┌──────────────────────────┐
│ docker-socket-proxy    │  │ PostgreSQL │   │ RCON（任意・server毎）      │
│ (list/start/stop/      │  │ users      │   │ - list/save-all/TPSなど   │
│  restart/stats のみ許可) │  │ servers    │   │ 　（停止は docker で行う）  │
└──────────┬─────────────┘  │ audit_log  │   └──────────────────────────┘
           ▼                 └────────────┘
   /var/run/docker.sock (host)
           │
   ┌───────┼─────────────────┐
   ▼       ▼                 ▼
 minecraft  minecraft2  ...  minecraftN   ← 各サーバーは独立したdocker-composeスタック
 (既存)     (将来追加)         (将来追加)     label: mcmonitor.enable=true で自動検出

   app-backend からのマウント:
   - /home/maki/docker  (rw, 親ディレクトリを丸ごとマウント → 新サーバー追加時にmount追記不要)
   - /proc, /sys (ro)   (ホストCPU/メモリ取得用)
```

フロントエンドは静的ビルドして Caddy or app-backend から配信（SPA）。

---

## 2. コンポーネント構成

| コンポーネント | 技術 | 役割 |
|---|---|---|
| フロントエンド | React + TypeScript + Vite、UIは shadcn/ui または Mantine | ファイラーUI、操作パネル、監視ダッシュボード、サーバー切替UI |
| バックエンド | Node.js + TypeScript + Fastify | REST API、WebSocket配信、認証、Docker/RCON制御、サーバーレジストリ管理 |
| DB | **PostgreSQL** | ユーザー・ロール・監査ログ・サーバーメタデータ |
| リバースプロキシ | Caddy（nginx代替可） | TLS終端、gzip、WebSocket proxy |
| Docker制御 | docker-socket-proxy (tecnativa/docker-socket-proxy) | app-backend に直接 docker.sock を渡さず、許可するAPI（list/start/stop/restart/stats/logs）だけを中継。対象コンテナはラベルで絞り込み可能 |
| Minecraft制御(主) | Docker (dockerode 経由 docker-socket-proxy) | start/stop/restart。itzgイメージはSIGTERMでgraceful stopするためこれが主手段 |
| Minecraft制御(副・任意) | RCON (rcon-client npm、サーバー毎に接続先を切替) | プレイヤー一覧、TPS、chat broadcast、手動save-allなど「あると便利」機能用 |
| ホストメトリクス | systeminformation (npm) | CPU使用率、メモリ使用率、ディスク使用量を取得しWSで配信 |

---

## 3. マルチサーバー管理設計（今回の要望の核）

将来Minecraftサーバーを増やしても、**このアプリのコード/インフラ設定を変更せずに追加・切替できる**ことを目標にする。

### 3.1 サーバーの自動検出（推奨）
- 各Minecraftサーバーの `docker-compose.yml` に共通ラベルを付与する運用ルールを導入:
  ```yaml
  services:
    minecraft:
      labels:
        mcmonitor.enable: "true"
        mcmonitor.data_path: "minecraft/data"   # 共有マウント配下の相対パス
  ```
- app-backend は起動時 & 定期的に docker-socket-proxy 経由で `mcmonitor.enable=true` ラベルを持つコンテナを一覧取得し、**サーバー一覧を自動生成**する。
- 新しいMinecraftサーバーを `../minecraft2/docker-compose.yml` として建てて起動するだけで、アプリ側は再デプロイ・再設定なしに一覧へ反映される。

### 3.2 PostgreSQL側で持つ付加メタデータ
自動検出できない情報（表示名・並び順・RCONパスワード・説明文・無効化フラグなど）は `servers` テーブルで管理し、コンテナ名（またはlabelで持たせた`server_id`）をキーに突き合わせる。

```
servers
  id (PK)
  container_name      -- docker上の識別子
  display_name         -- UI表示名（例: "サバイバル鯖", "検証鯖"）
  data_path            -- 共有マウント配下の相対パス
  rcon_host, rcon_port -- 任意
  sort_order
  is_archived
```

### 3.3 ファイル管理の共有ルート化
- 個別サーバーごとに bind mount を都度追加すると compose 変更・再起動が必要になるため、**app-backendには `/home/maki/docker` を1つだけマウント**し、その配下のどのサブフォルダ（`minecraft/data`, `minecraft2/data`, ...）を触るかは `servers.data_path` で制御する。
- ファイルAPIは常に「選択中サーバーの `data_path` 配下」にpathを正規化・prefixチェックする（サーバーをまたいだ越境アクセスを防止）。

### 3.4 UI
- 画面上部/サイドバーに **サーバー切替セレクタ**を常設。選択中サーバーがダッシュボード・ファイラー・制御パネルすべてに反映される。
- ダッシュボードは「全サーバー横断のサマリ（起動中/停止中一覧、ホスト全体CPU/メモリ）」と「選択中サーバーの詳細」の2段構成にすると扱いやすい。

---

## 4. ディレクトリ構成案

```
minecraftMonitoring/
├── docker-compose.yml
├── caddy/
│   └── Caddyfile
├── backend/
│   ├── src/
│   │   ├── routes/
│   │   │   ├── servers.ts      # サーバー一覧/登録/メタデータ
│   │   │   ├── files.ts        # 一覧/アップロード/DL/rename/move/delete（server_idスコープ）
│   │   │   ├── control.ts      # start/stop/restart/status（server_idスコープ）
│   │   │   ├── metrics.ts      # WS: CPU/Mem/各サーバー状態
│   │   │   └── auth.ts         # login/logout/session
│   │   ├── services/
│   │   │   ├── dockerControl.ts
│   │   │   ├── serverDiscovery.ts  # label検出 + DBメタデータのマージ
│   │   │   ├── rcon.ts
│   │   │   ├── fsSafe.ts           # パストラバーサル対策込みFS操作
│   │   │   └── metricsCollector.ts
│   │   ├── middleware/
│   │   │   ├── requireAuth.ts
│   │   │   └── requireRole.ts
│   │   ├── db/
│   │   │   ├── schema.ts       # users, sessions, servers, audit_log
│   │   │   └── migrations/
│   │   └── server.ts
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── pages/ (Dashboard, Files, ServerControl, Servers, Login, Users)
│   │   └── components/
│   └── package.json
└── (DBデータは postgres コンテナの named volume で永続化)
```

---

## 5. 認証・権限設計

- セッションベース認証（httpOnly + Secure + SameSite=Strict cookie）。VPN内限定でもクッキー窃取対策として必須。
- パスワードは argon2 でハッシュ化。
- 状態変更系エンドポイント（POST/PUT/DELETE）には CSRF トークン（double-submit cookie）を必須化。
- ロールは2種類で開始:
  - **admin**: ファイル全操作（アップロード/DL/rename/削除）、サーバー start/stop/restart、サーバー登録・編集、ユーザー管理
  - **member**: サーバー状態閲覧、restart のみ可、ファイルは閲覧・ダウンロードのみ（削除/アップロード不可）
- 初期ユーザーは環境変数 or 初回セットアップ画面で作成。招待制（自己登録なし）。
- 監査ログ（`audit_log` テーブル）: 誰が・いつ・どのサーバーに対し・何を（delete/rename/upload/stop/restart/サーバー登録変更）実行したかを記録し、管理画面で閲覧可能に。複数人利用のため必須。

---

## 6. ファイル管理機能

### API例（すべて `server_id` でスコープ）
| メソッド | パス | 説明 |
|---|---|---|
| GET | `/api/servers/:id/files?path=` | ディレクトリ一覧 |
| GET | `/api/servers/:id/files/download?path=` | 単一ファイルDL（ストリーム） |
| GET | `/api/servers/:id/files/download-zip?path=` | フォルダをzip化してストリームDL |
| POST | `/api/servers/:id/files/upload?path=` | アップロード（multipart, ストリーム保存） |
| POST | `/api/servers/:id/files/rename` | `{from, to}` |
| POST | `/api/servers/:id/files/move` | `{from, to}` |
| DELETE | `/api/servers/:id/files?path=` | 削除（確認ダイアログ必須・監査ログ必須） |

### セキュリティ設計（最重要）
- 操作対象パスは常に「共有ルート(`/home/maki/docker`) + 対象サーバーの `data_path`」配下に**正規化(path.resolve)した上で prefix チェック**し、`..` によるパストラバーサルおよびサーバー間の越境アクセスを遮断。
- シンボリックリンクは辿らない（`fs.realpath` で検証、外部を指すリンクは拒否）。
- アップロードはサイズ上限・拡張子/内容チェック。
- `world/` 等の稼働中データへの書き込み系操作は、対象サーバー稼働中は警告 or 制限（ワールド破損防止のため、書き込みはサーバー停止中のみ許可、という運用ルールを検討）。
- 削除は即時ではなく、まずゴミ箱的な一時退避（`.trash/` へmove）→ 一定期間後に物理削除、のワンクッション運用を推奨（誤削除対策）。

---

## 7. Minecraftサーバー制御

- **停止**: docker-socket-proxy 経由で対象コンテナに `docker stop`（SIGTERM）。itzgイメージのentrypointがgraceful stop（save-all等）を内部処理するため、これが主手段。
- **起動**: docker-socket-proxy 経由で `docker start`。
- **再起動**: `docker restart`、または停止→起動を内部で連結。
- **状態取得**: コンテナのHealth/Running状態（docker API）。RCONが設定されているサーバーは追加でオンラインプレイヤー数・TPSなども取得。
- 実行前に確認ダイアログ + 監査ログ記録（誰が・どのサーバーを停止/再起動したか）。
- RCONは必須要件から外し、**設定されていれば追加情報が見える任意機能**として位置づける（サーバーごとにRCON未設定でも起動/停止/再起動は問題なく行える）。

---

## 8. CPU / メモリ可視化

- `app-backend` コンテナに **ホストの `/proc`, `/sys` を read-only でマウント**し、`systeminformation` ライブラリでホスト全体のCPU/メモリ/ディスク使用率を取得（コンテナ自身のcgroup値ではなくPC全体の値を見るため）。
- 数秒間隔でポーリングし、WebSocketでフロントにpush → フロントは直近の時系列を折れ線グラフ表示（Recharts等）。
- 合わせて各Minecraftコンテナ単体のCPU/メモリ（`docker stats` 相当、socket-proxy経由）も取得し、サーバーごとの負荷比較ができるようにする（複数サーバー運用時に特に有用）。
- ダッシュボードに載せると良い情報: ホストCPU%、ホストメモリ%、ディスク空き容量、サーバー別の稼働状態・CPU/メモリ・オンラインプレイヤー数。

---

## 9. docker-compose.yml 構成イメージ（サービス一覧のみ、コード実装はしない）

```yaml
services:
  caddy:
    # 80/443 を公開、app-backend へリバースプロキシ

  app-backend:
    build: ./backend
    volumes:
      - /home/maki/docker:/mnt/docker-root         # 共有ルート（新サーバー追加時にmount追記不要）
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
    environment:
      - DOCKER_HOST=tcp://docker-socket-proxy:2375
      - DATABASE_URL=postgres://app:xxxx@postgres:5432/mcmonitor

  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: mcmonitor
      POSTGRES_USER: app
      POSTGRES_PASSWORD: xxxx
    volumes:
      - pgdata:/var/lib/postgresql/data

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

volumes:
  pgdata:
```

`docker-socket-proxy` を挟むのが最大のポイント。app-backendに直接 `docker.sock` を渡すとコンテナ内から実質ホストroot権限が取れてしまうため、複数人がアクセスするアプリでは特に避けたい。

`/home/maki/docker` を丸ごとマウントする設計は利便性（新サーバー追加が自動反映）とのトレードオフとして、アプリ側の相対パス検証（6章）を厳格に実装することが前提になる。ここが崩れると全サーバー横断でアクセスできてしまうため、実装フェーズでのセキュリティレビューを重視すること。

---

## 10. 実装フェーズ案（段階的に進める場合）

1. **Phase 1**: 認証基盤 + PostgreSQLスキーマ + ダッシュボード（ホストCPU/メモリ表示のみ）
2. **Phase 2**: サーバー自動検出（label検出）+ サーバー切替UI（1台構成でも土台を先に作る）
3. **Phase 3**: Minecraft start/stop/restart（docker-socket-proxy経由）
4. **Phase 4**: ファイル管理（一覧・DL・アップロード。まずは閲覧系から）
5. **Phase 5**: rename/move/delete（破壊的操作、ゴミ箱運用込み）
6. **Phase 6**: RCON連携（プレイヤー一覧・TPSなど任意機能）、監査ログ画面、ユーザー管理画面
7. **Phase 7**: 2台目のMinecraftサーバーを実際に追加し、追加コード変更なしで検出・管理できるか検証

---

## 11. 今後の検討事項

- TLS証明書: VPN内なので自己署名 or Caddyの内部CAで十分。将来的な外部公開時はLet's Encrypt検討。
- バックアップ: worldフォルダの定期バックアップ（cron + tar）は本アプリのスコープ外だが、ダッシュボード上に「最終バックアップ日時」を表示する連携は有用。
- 通知: サーバーダウン検知やCPU高負荷アラートをDiscord Webhookに飛ばす拡張。
- テキストファイル編集: `server.properties` や `config/*` の中身をブラウザ上で直接編集できるエディタ機能はファイル管理の自然な拡張（要望あれば追加設計）。
- nginxへの切替: 採用する場合は Caddyfile 相当の設定を nginx.conf + WebSocket用ヘッダー追記で置き換えるのみで、他コンポーネントへの影響はなし。
