import type { FastifyInstance } from "fastify";
import bcrypt from "bcrypt";
import { prisma } from "../prisma.js";
import { env } from "../env.js";
import { assertTokenValid, signToken } from "../middleware/auth.js";

/** Janela e teto de tentativas de login por IP. */
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

const loginAttempts = new Map<string, { count: number; resetAt: number }>();

function loginThrottle(ip: string): { blocked: boolean; retryAfterSec: number } {
  const now = Date.now();
  const entry = loginAttempts.get(ip);

  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 0, resetAt: now + LOGIN_WINDOW_MS });
    return { blocked: false, retryAfterSec: 0 };
  }
  if (entry.count >= LOGIN_MAX_ATTEMPTS) {
    return { blocked: true, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) };
  }
  return { blocked: false, retryAfterSec: 0 };
}

function registerFailedLogin(ip: string): void {
  const entry = loginAttempts.get(ip);
  if (entry) entry.count++;

  // poda preguiçosa para o Map não crescer sem limite
  if (loginAttempts.size > 5000) {
    const now = Date.now();
    for (const [key, value] of loginAttempts) {
      if (now > value.resetAt) loginAttempts.delete(key);
    }
  }
}

export async function authRoutes(app: FastifyInstance) {
  app.post("/api/auth/login", async (req, reply) => {
    if (!prisma) return reply.status(503).send({ error: "Banco indisponível" });

    const ip = req.ip;
    const throttle = loginThrottle(ip);
    if (throttle.blocked) {
      return reply
        .status(429)
        .header("retry-after", String(throttle.retryAfterSec))
        .send({
          error: `Muitas tentativas de login. Tente de novo em ${Math.ceil(
            throttle.retryAfterSec / 60
          )} min.`
        });
    }

    const body = req.body as { email?: string; password?: string };
    const email = body.email ?? env.ADMIN_EMAIL;
    const password = body.password ?? "";

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      registerFailedLogin(ip);
      return reply.status(401).send({ error: "Credenciais inválidas" });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      registerFailedLogin(ip);
      return reply.status(401).send({ error: "Credenciais inválidas" });
    }

    loginAttempts.delete(ip);

    const token = signToken({
      userId: user.id,
      email: user.email,
      tokenVersion: user.tokenVersion
    });
    return { token, email: user.email };
  });

  app.get("/api/auth/me", async (req, reply) => {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return reply.status(401).send({ error: "Não autorizado" });
    try {
      const user = await assertTokenValid(token);
      return { email: user.email };
    } catch {
      return reply.status(401).send({ error: "Sessão expirada" });
    }
  });
}
