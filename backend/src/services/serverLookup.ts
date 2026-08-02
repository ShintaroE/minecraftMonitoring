import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { servers } from "../db/schema.js";

export async function getServerById(id: number) {
  const rows = await db.select().from(servers).where(eq(servers.id, id)).limit(1);
  return rows[0] ?? null;
}
