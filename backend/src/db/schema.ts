import { pgTable, serial, text, integer, boolean, timestamp, pgEnum } from "drizzle-orm/pg-core";

// Phase 2+ で自動検出結果とマージして使う想定のサーバーメタデータ。
export const servers = pgTable("servers", {
  id: serial("id").primaryKey(),
  containerName: text("container_name").notNull().unique(),
  displayName: text("display_name").notNull(),
  dataPath: text("data_path").notNull(),
  rconHost: text("rcon_host"),
  rconPort: integer("rcon_port"),
  sortOrder: integer("sort_order").notNull().default(0),
  isArchived: boolean("is_archived").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const modEventType = pgEnum("mod_event_type", ["added", "deleted"]);

// MODタブ経由のアップロード/削除のみを記録する（有効/無効切り替えは対象外）。
export const modEvents = pgTable("mod_events", {
  id: serial("id").primaryKey(),
  serverId: integer("server_id")
    .notNull()
    .references(() => servers.id, { onDelete: "cascade" }),
  eventType: modEventType("event_type").notNull(),
  fileName: text("file_name").notNull(),
  fileSize: integer("file_size").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
