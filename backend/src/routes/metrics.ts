import type { FastifyInstance } from "fastify";
import { getSessionUser } from "../services/auth.js";
import { getMetricsSnapshot } from "../services/metricsCollector.js";

const POLL_INTERVAL_MS = 2000;

export async function metricsRoutes(app: FastifyInstance) {
  app.get("/ws/metrics", { websocket: true }, async (socket, request) => {
    const sessionId = request.cookies.session;
    const user = sessionId ? await getSessionUser(sessionId) : null;
    if (!user) {
      socket.close(4401, "unauthorized");
      return;
    }

    const timer = setInterval(async () => {
      try {
        const snapshot = await getMetricsSnapshot();
        socket.send(JSON.stringify(snapshot));
      } catch (err) {
        app.log.error(err, "failed to collect metrics");
      }
    }, POLL_INTERVAL_MS);

    socket.on("close", () => clearInterval(timer));
  });
}
