import Fastify from "fastify";
import websocket from "@fastify/websocket";
import multipart from "@fastify/multipart";
import { env } from "./env.js";
import { metricsRoutes } from "./routes/metrics.js";
import { serverRoutes } from "./routes/servers.js";
import { fileRoutes } from "./routes/files.js";
import { modRoutes } from "./routes/mods.js";

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2GB

const app = Fastify({ logger: true });

await app.register(websocket);
await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES } });
await app.register(metricsRoutes);
await app.register(serverRoutes);
await app.register(fileRoutes);
await app.register(modRoutes);

app.get("/api/health", async () => ({ ok: true }));

app
  .listen({ host: "0.0.0.0", port: env.PORT })
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
