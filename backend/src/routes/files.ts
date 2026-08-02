import path from "node:path";
import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { getServerById } from "../services/serverLookup.js";
import { dataRootFor, resolveServerPath, assertRealPathWithinRoot, PathViolationError } from "../services/fsSafe.js";

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });
const pathQuerySchema = z.object({ path: z.string().optional().default("") });

async function resolveRequestTarget(request: FastifyRequest, reply: FastifyReply) {
  const params = paramsSchema.safeParse(request.params);
  const query = pathQuerySchema.safeParse(request.query);
  if (!params.success || !query.success) {
    reply.code(400).send({ error: "invalid_request" });
    return null;
  }

  const server = await getServerById(params.data.id);
  if (!server) {
    reply.code(404).send({ error: "server_not_found" });
    return null;
  }

  const root = dataRootFor(server.dataPath);
  try {
    const target = resolveServerPath(server.dataPath, query.data.path);
    await assertRealPathWithinRoot(target, root);
    return { server, root, target, requestedPath: query.data.path };
  } catch (err) {
    if (err instanceof PathViolationError) {
      reply.code(400).send({ error: "invalid_path" });
      return null;
    }
    throw err;
  }
}

export async function fileRoutes(app: FastifyInstance) {
  app.get("/api/servers/:id/files", async (request, reply) => {
    const resolved = await resolveRequestTarget(request, reply);
    if (!resolved) return;

    let dirents;
    try {
      dirents = await fs.readdir(resolved.target, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return reply.code(404).send({ error: "not_found" });
      }
      if ((err as NodeJS.ErrnoException).code === "ENOTDIR") {
        return reply.code(400).send({ error: "not_a_directory" });
      }
      throw err;
    }

    const entries = [];
    for (const dirent of dirents) {
      // シンボリックリンクは共有ルート外を指す可能性があるため一覧から除外する
      if (dirent.isSymbolicLink()) continue;
      const stat = await fs.stat(path.join(resolved.target, dirent.name));
      entries.push({
        name: dirent.name,
        type: dirent.isDirectory() ? "directory" : "file",
        size: stat.size,
        mtime: stat.mtimeMs,
      });
    }

    entries.sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type === "directory" ? -1 : 1,
    );

    return entries;
  });

  app.get("/api/servers/:id/files/download", async (request, reply) => {
    const resolved = await resolveRequestTarget(request, reply);
    if (!resolved) return;

    let stat;
    try {
      stat = await fs.stat(resolved.target);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return reply.code(404).send({ error: "not_found" });
      }
      throw err;
    }
    if (!stat.isFile()) {
      return reply.code(400).send({ error: "not_a_file" });
    }

    reply.header(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(path.basename(resolved.target))}"`,
    );
    reply.header("Content-Length", stat.size);
    reply.type("application/octet-stream");
    return reply.send(createReadStream(resolved.target));
  });

  app.post("/api/servers/:id/files/upload", async (request, reply) => {
    const resolved = await resolveRequestTarget(request, reply);
    if (!resolved) return;

    const dirStat = await fs.stat(resolved.target).catch(() => null);
    if (!dirStat || !dirStat.isDirectory()) {
      return reply.code(400).send({ error: "not_a_directory" });
    }

    const data = await request.file();
    if (!data) {
      return reply.code(400).send({ error: "no_file" });
    }

    // アップロード先ファイル名はディレクトリトラバーサル防止のためbasenameのみ使用する
    const safeName = path.basename(data.filename);
    const destPath = path.join(resolved.target, safeName);

    await pipeline(data.file, createWriteStream(destPath));

    if (data.file.truncated) {
      await fs.unlink(destPath).catch(() => {});
      return reply.code(413).send({ error: "file_too_large" });
    }

    return { ok: true, name: safeName };
  });
}
