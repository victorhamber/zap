import type { FastifyReply, FastifyRequest } from "fastify";
import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../env.js";
import { prisma } from "../prisma.js";

export type JwtUser = { userId: string; email: string };

type JwtPayload = JwtUser & { tv?: number };

export function signToken(user: JwtUser & { tokenVersion: number }): string {
  return jwt.sign(
    { userId: user.userId, email: user.email, tv: user.tokenVersion },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN } as SignOptions
  );
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, env.JWT_SECRET) as JwtPayload;
}

export async function assertTokenValid(token: string): Promise<JwtUser> {
  const payload = verifyToken(token);
  if (!prisma) throw new Error("Banco indisponível");

  const user = await prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, email: true, tokenVersion: true }
  });
  if (!user) throw new Error("Usuário não encontrado");

  const tokenVersion = payload.tv ?? 0;
  if (tokenVersion !== user.tokenVersion) {
    throw new Error("Sessão expirada");
  }

  return { userId: user.id, email: user.email };
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return reply.status(401).send({ error: "Não autorizado" });
  }

  try {
    (req as FastifyRequest & { user: JwtUser }).user = await assertTokenValid(token);
  } catch {
    return reply.status(401).send({ error: "Sessão expirada" });
  }
}
