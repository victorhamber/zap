import type { FastifyInstance } from "fastify";
import bcrypt from "bcrypt";
import { prisma } from "../prisma.js";
import { env } from "../env.js";
import { signToken } from "../middleware/auth.js";

export async function authRoutes(app: FastifyInstance) {
  app.post("/api/auth/login", async (req, reply) => {
    if (!prisma) return reply.status(503).send({ error: "Banco indisponível" });

    const body = req.body as { email?: string; password?: string };
    const email = body.email ?? env.ADMIN_EMAIL;
    const password = body.password ?? "";

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) return reply.status(401).send({ error: "Credenciais inválidas" });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return reply.status(401).send({ error: "Credenciais inválidas" });

    const token = signToken({ userId: user.id, email: user.email });
    return { token, email: user.email };
  });

  app.get("/api/auth/me", async (req, reply) => {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return reply.status(401).send({ error: "Não autorizado" });
    try {
      const { verifyToken } = await import("../middleware/auth.js");
      const user = verifyToken(token);
      return { email: user.email };
    } catch {
      return reply.status(401).send({ error: "Token inválido" });
    }
  });
}
