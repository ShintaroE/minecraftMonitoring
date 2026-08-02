import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  createSession,
  destroySession,
  findUserByUsername,
  verifyPassword,
} from "../services/auth.js";
import { requireAuth } from "../middleware/requireAuth.js";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const SESSION_COOKIE = "session";

export async function authRoutes(app: FastifyInstance) {
  app.post("/api/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request" });
    }

    const user = await findUserByUsername(parsed.data.username);
    if (!user || !(await verifyPassword(user.passwordHash, parsed.data.password))) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }

    const session = await createSession(user.id);
    reply.setCookie(SESSION_COOKIE, session.id, {
      httpOnly: true,
      sameSite: "strict",
      secure: request.protocol === "https",
      path: "/",
      expires: session.expiresAt,
    });

    return { id: user.id, username: user.username, role: user.role };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const sessionId = request.cookies[SESSION_COOKIE];
    if (sessionId) {
      await destroySession(sessionId);
    }
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { ok: true };
  });

  app.get("/api/auth/me", { preHandler: requireAuth }, async (request) => {
    return request.user;
  });
}
