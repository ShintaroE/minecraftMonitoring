import path from "node:path";
import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { ZipArchive } from "archiver";
import { db } from "../db/client.js";
import { modEvents } from "../db/schema.js";
import { env } from "../env.js";
import { getServerById } from "../services/serverLookup.js";
import { dataRootFor, resolveServerPath, assertRealPathWithinRoot, PathViolationError } from "../services/fsSafe.js";

const MODS_PATH = "mods";
const TRASH_DIR_NAME = ".trash";
const DISABLED_SUFFIX = ".disabled";

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });

function backupPathFor(serverId: number, eventId: number): string {
  return path.join(env.MOD_BACKUP_ROOT, String(serverId), `${eventId}.jar`);
}

export async function modRoutes(app: FastifyInstance) {
  app.post("/api/servers/:id/mods/upload", async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: "invalid_id" });
    }

    const server = await getServerById(params.data.id);
    if (!server) {
      return reply.code(404).send({ error: "server_not_found" });
    }

    const root = dataRootFor(server.dataPath);
    let modsDir: string;
    try {
      modsDir = resolveServerPath(server.dataPath, MODS_PATH);
      await assertRealPathWithinRoot(modsDir, root);
    } catch (err) {
      if (err instanceof PathViolationError) {
        return reply.code(400).send({ error: "invalid_path" });
      }
      throw err;
    }

    const dirStat = await fs.stat(modsDir).catch(() => null);
    if (!dirStat || !dirStat.isDirectory()) {
      return reply.code(400).send({ error: "not_a_directory" });
    }

    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ error: "no_file" });
    }

    const safeName = path.basename(data.filename);
    if (!safeName.toLowerCase().endsWith(".jar")) {
      return reply.code(400).send({ error: "not_a_jar" });
    }

    const destPath = path.join(modsDir, safeName);
    await pipeline(data.file, createWriteStream(destPath));

    if (data.file.truncated) {
      await fs.unlink(destPath).catch(() => {});
      return reply.code(413).send({ error: "file_too_large" });
    }

    const stat = await fs.stat(destPath);

    const [row] = await db
      .insert(modEvents)
      .values({
        serverId: server.id,
        eventType: "added",
        fileName: safeName,
        fileSize: stat.size,
      })
      .returning();

    if (row) {
      const backupPath = backupPathFor(server.id, row.id);
      await fs.mkdir(path.dirname(backupPath), { recursive: true });
      await fs.copyFile(destPath, backupPath);
    }

    return { ok: true, name: safeName };
  });

  app.delete("/api/servers/:id/mods/:fileName", async (request, reply) => {
    const params = paramsSchema
      .extend({ fileName: z.string().min(1) })
      .safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    const server = await getServerById(params.data.id);
    if (!server) {
      return reply.code(404).send({ error: "server_not_found" });
    }

    const root = dataRootFor(server.dataPath);
    let target: string;
    try {
      target = resolveServerPath(server.dataPath, `${MODS_PATH}/${params.data.fileName}`);
      await assertRealPathWithinRoot(target, root);
    } catch (err) {
      if (err instanceof PathViolationError) {
        return reply.code(400).send({ error: "invalid_path" });
      }
      throw err;
    }

    const stat = await fs.stat(target).catch(() => null);
    if (!stat || !stat.isFile()) {
      return reply.code(404).send({ error: "not_found" });
    }

    const actualName = path.basename(target);
    const canonicalName = actualName.endsWith(DISABLED_SUFFIX)
      ? actualName.slice(0, -DISABLED_SUFFIX.length)
      : actualName;

    const trashDir = path.join(root, TRASH_DIR_NAME);
    await fs.mkdir(trashDir, { recursive: true });
    await fs.rename(target, path.join(trashDir, `${Date.now()}-${actualName}`));

    await db.insert(modEvents).values({
      serverId: server.id,
      eventType: "deleted",
      fileName: canonicalName,
      fileSize: stat.size,
    });

    return { ok: true };
  });

  app.get("/api/servers/:id/mods/history", async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: "invalid_id" });
    }

    const server = await getServerById(params.data.id);
    if (!server) {
      return reply.code(404).send({ error: "server_not_found" });
    }

    return db
      .select()
      .from(modEvents)
      .where(eq(modEvents.serverId, server.id))
      .orderBy(desc(modEvents.createdAt));
  });

  app.get("/api/servers/:id/mods/history/download-zip", async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    const query = z.object({ eventIds: z.string().min(1) }).safeParse(request.query);
    if (!params.success || !query.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    const server = await getServerById(params.data.id);
    if (!server) {
      return reply.code(404).send({ error: "server_not_found" });
    }

    const ids = query.data.eventIds
      .split(",")
      .map((s) => Number.parseInt(s, 10))
      .filter((n) => Number.isInteger(n) && n > 0);
    if (ids.length === 0) {
      return reply.code(400).send({ error: "invalid_event_ids" });
    }

    const rows = await db
      .select()
      .from(modEvents)
      .where(and(eq(modEvents.serverId, server.id), eq(modEvents.eventType, "added"), inArray(modEvents.id, ids)));

    reply.header("Content-Disposition", `attachment; filename="mods-${Date.now()}.zip"`);
    reply.type("application/zip");

    const archive = new ZipArchive({ zlib: { level: 6 } });
    archive.on("error", (err) => request.log.error(err, "mod history zip failed"));

    for (const row of rows) {
      const backupPath = backupPathFor(server.id, row.id);
      const exists = await fs
        .stat(backupPath)
        .then(() => true)
        .catch(() => false);
      if (exists) {
        archive.file(backupPath, { name: row.fileName });
      }
    }
    void archive.finalize();

    return reply.send(archive);
  });

  app.get("/api/servers/:id/mods/history/:eventId/download", async (request, reply) => {
    const params = paramsSchema
      .extend({ eventId: z.coerce.number().int().positive() })
      .safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    const server = await getServerById(params.data.id);
    if (!server) {
      return reply.code(404).send({ error: "server_not_found" });
    }

    const [row] = await db
      .select()
      .from(modEvents)
      .where(
        and(
          eq(modEvents.id, params.data.eventId),
          eq(modEvents.serverId, server.id),
          eq(modEvents.eventType, "added"),
        ),
      )
      .limit(1);

    if (!row) {
      return reply.code(404).send({ error: "not_found" });
    }

    const backupPath = backupPathFor(server.id, row.id);
    const stat = await fs.stat(backupPath).catch(() => null);
    if (!stat) {
      return reply.code(404).send({ error: "backup_missing" });
    }

    reply.header("Content-Disposition", `attachment; filename="${encodeURIComponent(row.fileName)}"`);
    reply.header("Content-Length", stat.size);
    reply.type("application/octet-stream");
    return reply.send(createReadStream(backupPath));
  });
}
