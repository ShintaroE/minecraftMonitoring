import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { env } from "./env.js";
import { metricsRoutes } from "./routes/metrics.js";

const app = Fastify({ logger: true });

await app.register(websocket);
await app.register(metricsRoutes);

app.get("/api/health", async () => ({ ok: true }));

app
  .listen({ host: "0.0.0.0", port: env.PORT })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
