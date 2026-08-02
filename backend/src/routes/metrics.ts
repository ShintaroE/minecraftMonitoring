import type { FastifyInstance } from "fastify";
import { getMetricsSnapshot } from "../services/metricsCollector.js";

const POLL_INTERVAL_MS = 2000;

export async function metricsRoutes(app: FastifyInstance) {
  app.get("/ws/metrics", { websocket: true }, (socket) => {
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
