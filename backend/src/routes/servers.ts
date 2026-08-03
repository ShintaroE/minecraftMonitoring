import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { getServerById } from "../services/serverLookup.js";
import { discoverAndSyncServers } from "../services/serverDiscovery.js";
import { startContainer, stopContainer, restartContainer } from "../services/dockerControl.js";
import { fetchPlayerList } from "../services/rcon.js";
import { getContainerStats } from "../services/containerStats.js";

const paramsSchema = z.object({ id: z.coerce.number().int().positive() });

function controlHandler(action: (containerName: string) => Promise<void>) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_id" });
    }

    const server = await getServerById(parsed.data.id);
    if (!server) {
      return reply.code(404).send({ error: "server_not_found" });
    }
    const containerName = server.containerName;

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

  app.get("/api/servers/:id/rcon/players", async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_id" });
    }

    const server = await getServerById(parsed.data.id);
    if (!server) {
      return reply.code(404).send({ error: "server_not_found" });
    }

    const result = await fetchPlayerList(server.containerName, server.dataPath);
    if (!result) {
      return { available: false };
    }

    return { available: true, ...result };
  });

  app.get("/api/servers/:id/stats", async (request, reply) => {
    const parsed = paramsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_id" });
    }

    const server = await getServerById(parsed.data.id);
    if (!server) {
      return reply.code(404).send({ error: "server_not_found" });
    }

    const result = await getContainerStats(server.containerName);
    if (!result) {
      return { available: false };
    }

    return { available: true, ...result };
  });
}
