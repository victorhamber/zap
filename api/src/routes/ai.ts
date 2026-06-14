import type { FastifyInstance } from "fastify";
import { prisma } from "../prisma.js";
import { requireAuth } from "../middleware/auth.js";
import {
  getAiSettings,
  getActiveSessionName,
  saveAiSettings,
  type AiSettingsDto
} from "../services/ai/settings.js";
import { simulateReply } from "../services/ai/replyService.js";

export async function aiRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get("/api/ai/settings", async () => {
    const session = await getActiveSessionName();
    return getAiSettings(session);
  });

  app.put("/api/ai/settings", async (req) => {
    const session = await getActiveSessionName();
    const body = req.body as Partial<AiSettingsDto> & {
      openaiApiKey?: string | null;
      clearOpenaiApiKey?: boolean;
    };
    return saveAiSettings(session, body);
  });

  app.get("/api/ai/knowledge", async (req) => {
    if (!prisma) return { items: [], total: 0 };
    const session = await getActiveSessionName();
    const q = req.query as { page?: string; limit?: string };
    const page = Math.max(1, Number(q.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(q.limit ?? 30)));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      prisma.instanceAiKnowledge.findMany({
        where: { session },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit
      }),
      prisma.instanceAiKnowledge.count({ where: { session } })
    ]);

    return { items, total, page, limit };
  });

  app.delete("/api/ai/knowledge", async () => {
    if (!prisma) throw new Error("Banco indisponível");
    const session = await getActiveSessionName();
    const result = await prisma.instanceAiKnowledge.deleteMany({ where: { session } });
    return { ok: true, deleted: result.count };
  });

  app.get("/api/ai/events", async (req) => {
    if (!prisma) return { items: [], total: 0 };
    const session = await getActiveSessionName();
    const q = req.query as { page?: string; limit?: string };
    const page = Math.max(1, Number(q.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(q.limit ?? 50)));
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      prisma.instanceAiEvent.findMany({
        where: { session },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit
      }),
      prisma.instanceAiEvent.count({ where: { session } })
    ]);

    return { items, total, page, limit };
  });

  app.post("/api/ai/test-reply", async (req, reply) => {
    const session = await getActiveSessionName();
    const body = req.body as { chatId?: string; inboundText?: string };
    const inboundText = body.inboundText?.trim();
    if (!inboundText) {
      return reply.status(400).send({ error: "inboundText obrigatório" });
    }
    try {
      const result = await simulateReply({
        session,
        chatId: body.chatId?.trim() || "test",
        inboundText
      });
      return { ok: true, ...result };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return reply.status(400).send({ error: message });
    }
  });
}
