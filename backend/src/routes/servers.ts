import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/client.js";
import { servers } from "../db/schema.js";
import { discoverAndSyncServers } from "../services/serverDiscovery.js";
import { startContainer, stopContainer, restartContainer } from "../services/dockerControl.js";

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });

async function resolveContainerName(id: number): Promise<string | null> {
  const rows = await db.select().from(servers).where(eq(servers.id, id)).limit(1);
  return rows[0]?.containerName ?? null;
}

function controlHandler(action: (containerName: string) => Promise<void>) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_id" });
    }

    const containerName = await resolveContainerName(parsed.data.id);
    if (!containerName) {
      return reply.code(404).send({ error: "server_not_found" });
    }

    try {
      await action(containerName);
    } catch (err) {
      // 304 = 既に目的の状態（例: 起動済みコンテナへのstart）。エラー扱いしない。
      if ((err as { statusCode?: number }).statusCode !== 304) {
        request.log.error(err, "docker control action failed");
        return reply.code(502).send({ error: "docker_action_failed" });
      }
    }

    return { ok: true };
  };
}

export async function serverRoutes(app: FastifyInstance) {
  app.get("/api/servers", async () => {
    return discoverAndSyncServers();
  });

  app.post("/api/servers/:id/start", controlHandler(startContainer));
  app.post("/api/servers/:id/stop", controlHandler(stopContainer));
  app.post("/api/servers/:id/restart", controlHandler(restartContainer));
}
