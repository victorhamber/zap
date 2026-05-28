import type { FastifyReply, FastifyRequest } from "fastify";
import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../env.js";

export type JwtUser = { userId: string; email: string };

export function signToken(user: JwtUser): string {
  return jwt.sign(user, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN
  } as SignOptions);
}

export function verifyToken(token: string): JwtUser {
  return jwt.verify(token, env.JWT_SECRET) as JwtUser;
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return reply.status(401).send({ error: "Não autorizado" });
  }

  try {
    (req as any).user = verifyToken(token);
  } catch {
    return reply.status(401).send({ error: "Token inválido" });
  }
}
