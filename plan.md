# minecraftMonitoring 設計書

## 0. 前提（ヒアリング結果）

- 公開範囲: VPN経由のみ（インターネット直接公開なし）
- 利用者: 複数人（友人など）。ただし **VPNで接続者が限定されているため、アプリ内でのログイン機能・ユーザー管理・監査ログは設けない**（実装時に決定。詳細は5章）
- 技術スタック: おまかせ
- デプロイ: 既存 `../minecraft` と同様に Docker Compose で管理
- サーバー制御: RCONではなく **dockerコマンド優先**（既存 `minecraft` コンテナは itzg/minecraft-server イメージで、`docker stop`=SIGTERM時にentrypoint側でgraceful stop処理されるため、docker操作だけで十分安全に止められる）
- 将来的に **複数のMinecraftサーバーを追加**する前提で、管理対象をアプリ側からすぐ切り替え・追加できる設計にする（＝設定ファイルを都度書き換えず拡張できる、という意味の「冗長化」と解釈。アプリ自体のレプリカ/HA構成は対象外）
- DB: **PostgreSQL**
- リバースプロキシ: **Caddy**（nginxでも技術的には代替可。VPN内単一アプリ+WebSocket用途ではCaddyの方が設定量が少ないため引き続き推奨）

> **実装状況（随時更新）**: Phase 1〜6（ダッシュボード、サーバー自動検出+切替UI、start/stop/restart、ファイル一覧/DL/アップロード、rename/move/delete+ゴミ箱運用+フォルダZIP DL、RCON連携）実装・動作確認済み。認証は要件から外れたため未実装（5章参照）。次はPhase 7（2台目サーバー追加検証）。

---

## 1. 全体アーキテクチャ

```
                         [ VPN内クライアント ]
                                 │ HTTP（VPN内限定のためTLS終端は必須ではない）
                                 ▼
                     ┌─────────────────────┐
                     │  Caddy (reverse proxy) │  ← 静的配信 / WS proxy
                     └─────────────────────┘
                                 │
                                 ▼
                     ┌─────────────────────┐
                     │   app-backend (Node)  │
                     │  Fastify + TypeScript │
                     │  - REST API            │
                     │  - WebSocket (metrics) │
                     │  - サーバーレジストリ    │
                     └───┬───────┬───────┬───┘
                          │       │       │
              ┌───────────┘       │       └───────────┐
              ▼                   ▼                   ▼
┌───────────────────────┐  ┌────────────┐   ┌──────────────────────────┐
│ docker-socket-proxy    │  │ PostgreSQL │   │ RCON（server毎、任意機能）  │
│ (list/start/stop/      │  │ servers    │   │ - list（オンラインプレイヤー）│
│  restart/stats のみ許可) │  └────────────┘   │ 　（停止は docker で行う）  │
└──────────┬─────────────┘                   └───────────┬──────────────┘
           ▼                                              │ mcmonitor-net
   /var/run/docker.sock (host)                            │ （external Dockerネットワーク、
           │                                              │  RCONポートはホストに非公開）
   ┌───────┼──────────────────────────────────────────────┘
   ▼       ▼                 ▼
 minecraft  minecraft2  ...  minecraftN   ← 各サーバーは独立したdocker-composeスタック
 (既存)     (将来追加)         (将来追加)     label: mcmonitor.enable=true で自動検出
                                             ＋ mcmonitor-net に参加でRCON疎通

   app-backend からのマウント:
   - /home/maki/docker  (rw, 親ディレクトリを丸ごとマウント → 新サーバー追加時にmount追記不要)
```

フロントエンドは静的ビルドしてCaddyコンテナに焼き込み配信（別途「frontend」コンテナは立てない）。

ホストCPU/メモリの取得について: Dockerコンテナは特別なマウントなしでも `/proc/meminfo` 等がホスト全体の値を返すことを実機確認済み（cgroup制限を掛けてもホスト値が見える）。そのため当初想定していた `/proc`,`/sys` の追加bind mountは不要と判明し、実装では省略した。

---

## 2. コンポーネント構成

| コンポーネント | 技術 | 役割 |
|---|---|---|
| フロントエンド | React + TypeScript + Vite | 監視ダッシュボード、（Phase以降）ファイラーUI・操作パネル・サーバー切替UI |
| バックエンド | Node.js + TypeScript + Fastify | REST API、WebSocket配信、Docker/RCON制御、サーバーレジストリ管理 |
| DB | **PostgreSQL**（Drizzle ORM） | サーバーメタデータ（`servers`テーブル） |
| リバースプロキシ | Caddy（nginx代替可） | 静的配信、WebSocket proxy |
| Docker制御（Phase2以降） | docker-socket-proxy (tecnativa/docker-socket-proxy) | app-backend に直接 docker.sock を渡さず、許可するAPI（list/start/stop/restart/stats/logs）だけを中継 |
| Minecraft制御(主・Phase3以降) | Docker (dockerode 経由 docker-socket-proxy) | start/stop/restart。itzgイメージはSIGTERMでgraceful stopするためこれが主手段 |
| Minecraft制御(副・任意) | RCON (rcon-client npm) | オンラインプレイヤー一覧を取得しダッシュボードに表示（実装済み・Phase 6）。TPS/chat broadcast/手動save-allは未実装（今後の検討事項） |
| ホストメトリクス | systeminformation (npm) | CPU使用率、メモリ使用率を取得しWSで配信（実装済み） |

---

## 3. マルチサーバー管理設計（次フェーズの中心）

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
- 既存の `../minecraft/docker-compose.yml` には Phase 2実装時にこのラベルを追加し、`docker compose up -d`で反映済み（コンテナの再作成を伴うため実施可否をユーザーに確認の上で実施）。実際に `mcmonitor.enable=true` で自動検出され、`/api/servers`経由で取得できることを確認済み。

### 3.2 PostgreSQL側で持つ付加メタデータ
自動検出できない情報（表示名・並び順・RCON接続情報・無効化フラグなど）は `servers` テーブルで管理し、コンテナ名をキーに突き合わせる。

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

（実装済み。ただし現状は空テーブルで、自動検出ロジックは未実装＝Phase 2の作業）

### 3.3 ファイル管理の共有ルート化
- 個別サーバーごとに bind mount を都度追加すると compose 変更・再起動が必要になるため、**app-backendには `/home/maki/docker` を1つだけマウント**し、その配下のどのサブフォルダ（`minecraft/data`, `minecraft2/data`, ...）を触るかは `servers.data_path` で制御する。
- ファイルAPIは常に「選択中サーバーの `data_path` 配下」にpathを正規化・prefixチェックする（サーバーをまたいだ越境アクセスを防止）。

### 3.4 UI
- 画面上部/サイドバーに **サーバー切替セレクタ**を常設。選択中サーバーがダッシュボード・ファイラー・制御パネルすべてに反映される。
- ダッシュボードは「全サーバー横断のサマリ（起動中/停止中一覧、ホスト全体CPU/メモリ）」と「選択中サーバーの詳細」の2段構成にすると扱いやすい。

---

## 4. ディレクトリ構成（現状）

```
minecraftMonitoring/
├── docker-compose.yml
├── .env.example                 # POSTGRES_PASSWORD のみ
├── caddy/
│   └── Caddyfile
├── backend/
│   ├── src/
│   │   ├── routes/
│   │   │   ├── metrics.ts       # WS: ホストCPU/Mem配信
│   │   │   ├── servers.ts       # GET /api/servers、POST /api/servers/:id/{start,stop,restart}
│   │   │   └── files.ts         # GET一覧/download、POST upload
│   │   ├── services/
│   │   │   ├── metricsCollector.ts
│   │   │   ├── dockerClient.ts     # dockerode（docker-socket-proxy経由）
│   │   │   ├── serverDiscovery.ts  # label検出 + servers upsert
│   │   │   ├── dockerControl.ts    # start/stop/restart
│   │   │   ├── serverLookup.ts     # id→serversレコード取得の共通ヘルパー
│   │   │   ├── fsSafe.ts           # パストラバーサル対策込みパス解決
│   │   │   └── rcon.ts             # .rcon-cli.env読み取り + RCON接続 + list解析
│   │   ├── db/
│   │   │   ├── schema.ts       # servers のみ
│   │   │   └── migrations/
│   │   ├── env.ts
│   │   └── server.ts
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Dashboard.tsx
│   │   │   └── Files.tsx           # ファイルブラウザ（一覧/DL/アップロード）
│   │   ├── components/
│   │   │   ├── ServerSwitcher.tsx
│   │   │   └── ServerControls.tsx  # 起動/停止/再起動ボタン
│   │   ├── api/ (servers.ts, files.ts, rcon.ts)
│   │   ├── lib/format.ts           # formatBytes / formatDateTime
│   │   ├── hooks/ (useMetricsSocket.ts, useServers.ts, useRconPlayers.ts)
│   │   └── App.tsx                 # ヘッダー（サーバー切替+操作+タブ）を集約するレイアウト
│   └── package.json
└── (DBデータは postgres コンテナの named volume `pgdata` で永続化)
```

---

## 5. 認証・権限について（変更あり）

**当初案（セッション認証 + admin/memberロール + 監査ログ）は実装せず、削除した。**

- **理由**: VPNで接続者自体が既に限定されているため、アプリ内に追加のログイン層を設ける必要がないと判断（ユーザー判断）。
- **影響**:
  - ログイン画面なし。VPNに繋がっていれば誰でもダッシュボード・今後実装するファイル操作/サーバー制御にフルアクセス可能。
  - `users` / `sessions` / `audit_log` テーブルは削除済み。「誰が操作したか」は記録されない。
  - Phase 4以降のファイル削除やPhase 3のサーバー停止操作も、確認ダイアログ（フロント側のUXとして）はあっても、個人の特定・操作履歴の追跡はできない前提で設計する。
- 将来的に外部公開や利用者拡大などでこの前提が崩れる場合は、この章を再設計すること。

---

## 6. ファイル管理機能

### API（すべて `server_id` でスコープ）
| メソッド | パス | 説明 | 状態 |
|---|---|---|---|
| GET | `/api/servers/:id/files?path=` | ディレクトリ一覧 | 実装済み（Phase 4） |
| GET | `/api/servers/:id/files/download?path=` | 単一ファイルDL（ストリーム） | 実装済み（Phase 4） |
| POST | `/api/servers/:id/files/upload?path=` | アップロード（multipart, ストリーム保存） | 実装済み（Phase 4） |
| GET | `/api/servers/:id/files/download-zip?path=` | フォルダをzip化してストリームDL | 実装済み（Phase 5.1） |
| POST | `/api/servers/:id/files/rename` | `{from, to}`。同一ディレクトリ内の名前変更にも、別ディレクトリへの移動（＝「移動」機能）にも使う（`fs.rename`ベースのため） | 実装済み（Phase 5） |
| DELETE | `/api/servers/:id/files?path=` | 削除。`.trash/`外のものは`.trash/`へ退避、`.trash/`内のものは物理削除（フロントで確認ダイアログ必須） | 実装済み（Phase 5、Phase 5.1でバグ修正） |

**Phase 4実装メモ**:
- 共有ルートは`/home/maki/docker`をapp-backendに`rw`マウント（`SHARED_ROOT=/mnt/docker-root`）。3.3章の設計通り、新サーバー追加時もmount追記不要。
- シンボリックリンクは一覧から除外し、`fs.realpath`で解決した実体パスが共有ルート外を指す場合も拒否（`services/fsSafe.ts`）。パストラバーサル（`../`や`%2e%2e`等）は実機で400になることを確認済み。
- アップロードのファイル名は`path.basename()`のみ使用し、ファイル名経由のディレクトリトラバーサルを防止。アップロード上限は2GB（`@fastify/multipart`の`limits.fileSize`）。
- 稼働中サーバーへの書き込み（アップロード）に制限は設けていない（下記セキュリティ設計の「稼働中は制限」は未実装のまま）。実際にworldフォルダ稼働中に書き込むとどうなるかは未検証。運用上は「アップロードはサーバー停止中に行う」を当面のルールとして推奨。

**Phase 5実装メモ**:
- `move`は独立エンドポイントにせず`rename`に統合（どちらも`fs.rename(from, to)`で同じ処理のため）。
- `rename`は移動先(`to`)に既存ファイル/フォルダがある場合`409 destination_exists`を返し、暗黙の上書きを防止。
- 削除は物理削除ではなく`{data_path}/.trash/{timestamp}-{元のファイル名}`へ`fs.rename`で退避するのみ。定期パージ（保持期間経過後の自動物理削除）は未実装 — `.trash`は放置すると増え続ける。`.trash`自体はファイルブラウザ上に通常のフォルダとして表示されるため、専用の復元UIがなくても中身を見て手動で「名前変更」すれば元の場所に戻せる。
- **実装中に発見した問題と対応（1）**: `.trash`ディレクトリをbackendコンテナ（root権限で実行）が新規作成すると、ホスト側でroot所有になり、実運用ユーザー（`maki`）がsudoなしで削除できなくなることが実機検証で判明した。`backend/Dockerfile`に`USER node`を追加し、`node:24-slim`ベースイメージに標準で入っている`node`ユーザー（uid/gid 1000）で実行するよう修正。ホストの`maki`ユーザーも uid 1000 のため、以後アプリが共有マウント上に作成するファイル/フォルダはすべて`maki`所有になり、sudo不要で管理できる。

**Phase 5.1（ユーザー指摘による追加修正）**:
- **バグ修正**: `.trash`内のファイルを削除しようとすると、`.trash`へ再度退避するだけで同じ場所に残り続け「削除できない」ように見える不具合があった。削除対象が既に`.trash`配下にある場合は`fs.rm(recursive:true, force:true)`で物理削除するよう修正（`routes/files.ts`）。
- **移動機能を追加**: 各行に「移動」ボタンを追加。`window.prompt`でフルパス（ディレクトリ込み）を編集させ、`rename`エンドポイント（`{from, to}`）を呼ぶことで実現。ドラッグ&ドロップやディレクトリピッカーは実装していない。
- **フォルダのZIPダウンロードを追加**: `archiver`パッケージ（v8、クラスベースAPI: `new ZipArchive()` → `.directory()` → `.finalize()`）で`GET /api/servers/:id/files/download-zip?path=`を実装。フォルダ行に「ZIP DL」ボタン、ツールバーに「このフォルダをZIPでDL」ボタンを追加。ストリーミングでバッファに溜めずに返す。

### セキュリティ設計（最重要）
- 操作対象パスは常に「共有ルート(`/home/maki/docker`) + 対象サーバーの `data_path`」配下に**正規化(path.resolve)した上で prefix チェック**し、`..` によるパストラバーサルおよびサーバー間の越境アクセスを遮断。
- シンボリックリンクは辿らない（`fs.realpath` で検証、外部を指すリンクは拒否）。
- アップロードはサイズ上限・拡張子/内容チェック。
- `world/` 等の稼働中データへの書き込み系操作は、対象サーバー稼働中は警告 or 制限（ワールド破損防止のため、書き込みはサーバー停止中のみ許可、という運用ルールを検討）。
- 削除は即時ではなく、まずゴミ箱的な一時退避（`.trash/` へmove）→ 一定期間後に物理削除、のワンクッション運用を推奨（誤削除対策。認証がない分、この安全弁は特に重要）。

---

## 7. Minecraftサーバー制御（Phase 3・6で実装済み）

- **停止**: docker-socket-proxy 経由で対象コンテナに `docker stop`（SIGTERM）。itzgイメージのentrypointがgraceful stop（save-all等）を内部処理するため、これが主手段。
- **起動**: docker-socket-proxy 経由で `docker start`。
- **再起動**: `docker restart`、または停止→起動を内部で連結。
- **状態取得**: コンテナのHealth/Running状態（docker API）。RCONが設定されているサーバーは追加でオンラインプレイヤー数・TPSなども取得（RCON連携自体はPhase6で実装予定、現状は未実装）。
- 実行前にフロントで確認ダイアログを必須にする（誰でも押せるため誤操作防止が唯一の歯止め）。
- RCONは必須要件から外し、**設定されていれば追加情報が見える任意機能**として位置づける（サーバーごとにRCON未設定でも起動/停止/再起動は問題なく行える）。

**（実装済み・Phase 3）**
- `POST /api/servers/:id/{start,stop,restart}` を実装。`dockerode`経由でdocker-socket-proxyにHTTPで接続し、`getContainer(containerName).start()/.stop()/.restart()`を呼ぶだけのシンプルな実装（RCONは未使用）。
- フロントに起動/停止/再起動ボタンを追加。稼働中は「起動」を無効化、停止中は「停止」「再起動」を無効化。停止・再起動は`window.confirm`で確認必須（起動は非破壊的なので確認なし）。
- 実機（重量級Forgeサーバー、Mod多数）で動作確認済み。フル起動には約70秒かかる（modloadingが重いため）。稼働中の状態からの`stop`はexit code 0でワールドのgraceful saveを確認できたが、**起動途中（modloading中）に`stop`すると exit code 137（SIGKILL）になった**。これはDocker側のデフォルト停止猶予（10秒）内にJVM側のシャットダウンフックが間に合わなかったためと推測される。実運用上は「起動完了（ヘルスチェックがhealthyになるまで）は停止操作を避ける」運用注意が必要（フロント側での警告表示は未実装、今後の検討事項）。
- **docker-socket-proxyの権限に関する重要な注意点**: `tecnativa/docker-socket-proxy:latest`のACLはHTTPメソッドを見ずパス文字列だけで判定するルールが多く、`CONTAINERS=1`と`POST=1`を両方有効にすると`/containers/*`配下の全操作（start/stop/restart/kill/pause/unpauseに加え、コンテナ削除やrenameなど）が技術的には通ってしまう。`ALLOW_START`/`ALLOW_STOP`/`ALLOW_RESTARTS`を個別に設定しても、`CONTAINERS=1`が有効な限りこの広い許可が優先されてしまうため、厳密な最小権限化はこのプロキシでは実現できない。対策として（ユーザー承認済み）: (1) docker-socket-proxyはポートを一切ホスト公開せずapp-backendからのみ到達可能にする、(2) app-backend自身のコードはstart/stop/restart以外のDocker API呼び出しを実装しない、の2点で実質的なリスクを抑える方針とした。より厳密に絞りたくなった場合は、socket-proxyを使わず「特定のdocker CLIコマンドだけを実行できるラップスクリプト+sudo」方式への切替を検討する。

**RCON連携（実装済み・Phase 6）**
- `GET /api/servers/:id/rcon/players` を実装。`rcon-client` npmで各Minecraftコンテナに直接RCON接続し、`list`コマンドでオンラインプレイヤー数・名前を取得。ダッシュボードに「オンラインプレイヤー」カードとして表示（15秒ポーリング）。
- **接続経路**: app-backendとMinecraftコンテナは別々のdocker-composeプロジェクト（別ネットワーク）なので、あらかじめ`docker network create mcmonitor-net`で作成した外部（external）ネットワークに両方を参加させ、コンテナ名で直接疎通させている（ユーザー選定：RCONポートをホストに公開する案ではなく、ネットワーク越しに閉じる案を採用）。詳細は9章。
- **RCONパスワードの取得元**: 環境変数や新規設定ファイルを追加せず、itzgイメージが各サーバーの`data_path`直下に自動生成する`.rcon-cli.env`（`password=...`形式）を共有マウント経由でそのまま読み取っている。サーバー側の追加設定は不要。
- RCON未設定・コンテナ停止中・接続失敗など、あらゆる失敗ケースは例外を投げず`{ available: false }`を返す設計にし、フロントは「取得不可」と表示するのみ（エラー扱いしない＝任意機能としての位置づけを維持）。
- TPS取得・chat broadcast・save-all等の追加コマンドは同じRCON接続を使い回せば実装できるが、今回は未実装（今後の検討事項）。

---

## 8. CPU / メモリ可視化（実装済み）

- `systeminformation` ライブラリでホスト全体のCPU/メモリ使用率を取得（特別なマウント不要、1章参照）。
- 2秒間隔でポーリングし、WebSocket(`/ws/metrics`)でフロントにpush → フロントは直近60ポイントを折れ線グラフ表示（Recharts）。
- 今後（Phase 2以降）: 各Minecraftコンテナ単体のCPU/メモリ（`docker stats` 相当、socket-proxy経由）も取得し、サーバーごとの負荷比較ができるようにする。

---

## 9. docker-compose.yml（現状）

**事前準備（初回のみ）**: RCON疎通用の外部ネットワークを手動で作成しておく必要がある。

```bash
docker network create mcmonitor-net
```

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: mcmonitor
      POSTGRES_USER: app
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data

  docker-socket-proxy:
    image: tecnativa/docker-socket-proxy:latest   # ※ :0.4 タグは存在しないので latest を使用
    environment:
      CONTAINERS: 1       # list/inspect（GET）
      POST: 1             # GET以外のメソッドを許可する元栓
      ALLOW_START: 1
      ALLOW_STOP: 1
      ALLOW_RESTARTS: 1
      # 注意: CONTAINERSとPOSTを両方1にすると、ACLがパスのみで判定されるため
      # start/stop/restart以外（remove等）も技術的には通ってしまう（7章参照）
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro

  app-backend:
    build: ./backend
    environment:
      DATABASE_URL: postgres://app:${POSTGRES_PASSWORD}@postgres:5432/mcmonitor
      DOCKER_PROXY_HOST: docker-socket-proxy
      DOCKER_PROXY_PORT: 2375
      PORT: 3000
      SHARED_ROOT: /mnt/docker-root
    volumes:
      - /home/maki/docker:/mnt/docker-root   # 親ディレクトリを丸ごとマウント（3.3章）
    networks:
      - default
      - mcmonitor-net   # 各MinecraftコンテナへRCON接続するため

  caddy:
    build:
      context: .
      dockerfile: frontend/Dockerfile   # フロントエンドのビルド＋配信を兼ねる
    ports:
      - "80:80"

volumes:
  pgdata:

networks:
  default:
  mcmonitor-net:
    external: true   # `docker network create mcmonitor-net` で事前作成したネットワークを利用
```

各Minecraftサーバー側の`docker-compose.yml`にも同様に`networks: [default, mcmonitor-net]`を追加する必要がある（`../minecraft/docker-compose.yml`は追加済み）。新しいサーバーを追加する際はこの一手間を忘れないこと。

`docker-socket-proxy` を挟むのが最大のポイント。app-backendに直接 `docker.sock` を渡すとコンテナ内から実質ホストroot権限が取れてしまうため、認証なしでアクセスできるアプリでは特に避けたい。

---

## 10. 実装フェーズと進捗

1. **Phase 1（完了）**: PostgreSQLスキーマ + ダッシュボード（ホストCPU/メモリ表示）。認証は要件変更により実装せず。
2. **Phase 2（完了）**: docker-socket-proxy導入 + サーバー自動検出（`mcmonitor.enable`/`mcmonitor.data_path` labelをdockerode経由でスキャンし`servers`テーブルにupsert）+ サーバー切替UI（ダッシュボードのヘッダーに実装。既存`../minecraft`にlabelを付与し実際に自動検出されることを確認済み）
3. **Phase 3（完了）**: Minecraft start/stop/restart。`POST /api/servers/:id/{start,stop,restart}` + フロントの操作ボタン（確認ダイアログ付き）を実装し、実機の重量級Forgeサーバーで動作確認済み（7章に権限まわりの注意点と運用上の注意を記載）。
4. **Phase 4（完了）**: ファイル管理（一覧・DL・アップロード）。フロントはタブUI（ダッシュボード/ファイル）に再構成し、`App.tsx`でサーバー切替・操作ボタンを共通ヘッダー化。実機の`minecraft`コンテナに対し一覧・ダウンロード・アップロードとパストラバーサル対策を確認済み。
5. **Phase 5（完了）**: rename/delete（ゴミ箱運用込み）。実機で名前変更・削除・.trash退避・パストラバーサル/上書き防止を確認済み。副産物として、backendコンテナがrootで動いていたため`.trash`がroot所有になりホストユーザーが削除できない問題を発見・修正（`USER node`化）。
   - **Phase 5.1（完了・ユーザーフィードバック対応）**: `.trash`内ファイルが削除できないバグを修正、移動機能（フルパス指定）とフォルダZIPダウンロードを追加。
6. **Phase 6（完了）**: RCON連携。外部Dockerネットワーク`mcmonitor-net`を作成してapp-backendと各Minecraftコンテナを参加させ、`.rcon-cli.env`のパスワードでRCON接続、`list`コマンドでオンラインプレイヤー数・名前を取得しダッシュボードに表示。実機で0人在線を確認済み（TPS等の追加コマンドは未実装）。
7. **Phase 7（次）**: 2台目のMinecraftサーバーを実際に追加し、追加コード変更なしで検出・管理できるか検証（`mcmonitor-net`への参加も含めて手順化する）

（旧Phase 6にあった「監査ログ画面」「ユーザー管理画面」は認証を実装しない方針のため削除）

---

## 11. 今後の検討事項

- TLS証明書: VPN内なので現状は平文HTTPのまま運用。将来的な外部公開時はHTTPS化必須（そのタイミングで5章の認証も再検討）。
- バックアップ: worldフォルダの定期バックアップ（cron + tar）は本アプリのスコープ外だが、ダッシュボード上に「最終バックアップ日時」を表示する連携は有用。
- 通知: サーバーダウン検知やCPU高負荷アラートをDiscord Webhookに飛ばす拡張。
- テキストファイル編集: `server.properties` や `config/*` の中身をブラウザ上で直接編集できるエディタ機能はファイル管理の自然な拡張（要望あれば追加設計）。
- nginxへの切替: 採用する場合は Caddyfile 相当の設定を nginx.conf + WebSocket用ヘッダー追記で置き換えるのみで、他コンポーネントへの影響はなし。
