import path from "node:path";
import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { ZipArchive } from "archiver";
import { getServerById } from "../services/serverLookup.js";
import { dataRootFor, resolveServerPath, assertRealPathWithinRoot, PathViolationError } from "../services/fsSafe.js";

const TRASH_DIR_NAME = ".trash";

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

  app.get("/api/servers/:id/files/download-zip", async (request, reply) => {
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
    if (!stat.isDirectory()) {
      return reply.code(400).send({ error: "not_a_directory" });
    }

    const zipName = `${path.basename(resolved.target) || "root"}.zip`;
    reply.header("Content-Disposition", `attachment; filename="${encodeURIComponent(zipName)}"`);
    reply.type("application/zip");

    const archive = new ZipArchive({ zlib: { level: 6 } });
    archive.on("error", (err) => request.log.error(err, "zip archive failed"));
    archive.directory(resolved.target, false);
    void archive.finalize();

    return reply.send(archive);
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

  const renameBodySchema = z.object({ from: z.string().min(1), to: z.string().min(1) });

  app.post("/api/servers/:id/files/rename", async (request, reply) => {
    const params = paramsSchema.safeParse(request.params);
    const body = renameBodySchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    const server = await getServerById(params.data.id);
    if (!server) {
      return reply.code(404).send({ error: "server_not_found" });
    }

    const root = dataRootFor(server.dataPath);
    let fromTarget: string;
    let toTarget: string;
    try {
      fromTarget = resolveServerPath(server.dataPath, body.data.from);
      toTarget = resolveServerPath(server.dataPath, body.data.to);
      await assertRealPathWithinRoot(fromTarget, root);
    } catch (err) {
      if (err instanceof PathViolationError) {
        return reply.code(400).send({ error: "invalid_path" });
      }
      throw err;
    }

    if (toTarget === root) {
      return reply.code(400).send({ error: "invalid_path" });
    }

    const destExists = await fs.stat(toTarget).catch(() => null);
    if (destExists) {
      return reply.code(409).send({ error: "destination_exists" });
    }

    try {
      await fs.rename(fromTarget, toTarget);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return reply.code(404).send({ error: "not_found" });
      }
      throw err;
    }

    return { ok: true };
  });

  app.delete("/api/servers/:id/files", async (request, reply) => {
    const resolved = await resolveRequestTarget(request, reply);
    if (!resolved) return;

    if (resolved.target === resolved.root) {
      return reply.code(400).send({ error: "cannot_delete_root" });
    }

    const stat = await fs.stat(resolved.target).catch(() => null);
    if (!stat) {
      return reply.code(404).send({ error: "not_found" });
    }

    const trashDir = path.join(resolved.root, TRASH_DIR_NAME);

    // 既に .trash 配下にあるものを削除する場合は、再度 .trash へ退避しても
    // 見た目上その場に残り続けて「削除できない」ように見えてしまうため、物理削除する。
    if (resolved.target === trashDir || resolved.target.startsWith(trashDir + path.sep)) {
      await fs.rm(resolved.target, { recursive: true, force: true });
      return { ok: true, permanentlyDeleted: true };
    }

    // 通常の削除は即時物理削除ではなく、共有ルート直下の .trash/ へ退避する（誤削除対策）。
    await fs.mkdir(trashDir, { recursive: true });
    const trashName = `${Date.now()}-${path.basename(resolved.target)}`;
    await fs.rename(resolved.target, path.join(trashDir, trashName));

    return { ok: true, trashedAs: trashName };
  });
}
