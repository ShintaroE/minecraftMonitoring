import Fastify from "fastify";
import cookie from "@fastify/cookie";
import websocket from "@fastify/websocket";
import { env } from "./env.js";
import { authRoutes } from "./routes/auth.js";
import { metricsRoutes } from "./routes/metrics.js";

const app = Fastify({ logger: true });

await app.register(cookie);
await app.register(websocket);

await app.register(authRoutes);
await app.register(metricsRoutes);

app.get("/api/health", async () => ({ ok: true }));

app
  .listen({ host: "0.0.0.0", port: env.PORT })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
