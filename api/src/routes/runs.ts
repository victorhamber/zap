import type { FastifyInstance } from "fastify";
import { prisma } from "../prisma.js";
import { requireAuth } from "../middleware/auth.js";

export async function runRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get("/api/runs", async (req) => {
    if (!prisma) return [];
    const q = req.query as { flowId?: string; limit?: string };
    const limit = Math.min(Number(q.limit ?? 50), 200);
    return prisma.flowRun.findMany({
      where: q.flowId ? { flowId: q.flowId } : undefined,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { flow: { select: { name: true } } }
    });
  });

  app.get("/api/runs/:id", async (req, reply) => {
    if (!prisma) return reply.status(503).send({ error: "Banco indisponível" });
    const id = (req.params as { id: string }).id;
    const run = await prisma.flowRun.findUnique({
      where: { id },
      include: { steps: { orderBy: { createdAt: "asc" } }, flow: true }
    });
    if (!run) return reply.status(404).send({ error: "Não encontrado" });
    return run;
  });
}
