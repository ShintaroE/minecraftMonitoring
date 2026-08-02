import type { FastifyReply, FastifyRequest } from "fastify";
import { getSessionUser } from "../services/auth.js";

export interface AuthUser {
  id: number;
  username: string;
  role: "admin" | "member";
}

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

export async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
  const sessionId = request.cookies.session;
  const user = sessionId ? await getSessionUser(sessionId) : null;
  if (!user) {
    reply.code(401).send({ error: "unauthorized" });
    return;
  }
  request.user = user;
}

export function requireRole(role: AuthUser["role"]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      reply.code(401).send({ error: "unauthorized" });
      return;
    }
    if (request.user.role !== role && request.user.role !== "admin") {
      reply.code(403).send({ error: "forbidden" });
    }
  };
}
