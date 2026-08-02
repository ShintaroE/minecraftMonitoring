import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

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
