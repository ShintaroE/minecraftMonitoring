import type { FastifyInstance } from "fastify";
import { discoverAndSyncServers } from "../services/serverDiscovery.js";

export async function serverRoutes(app: FastifyInstance) {
  app.get("/api/servers", async () => {
    return discoverAndSyncServers();
  });
}
