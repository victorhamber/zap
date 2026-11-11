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
import { importKnowledgeForSession, parseKnowledgeImport } from "../services/ai/knowledgeImport.js";
import { queueHistoryLearning } from "../services/ai/historyLearn.js";
import { logAiEvent } from "../services/ai/chatState.js";
import { getAiStats } from "../services/ai/stats.js";

export async function aiRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get("/api/ai/settings", async () => {
    const session = await getActiveSessionName();
    return getAiSettings(session);
  });

  app.put("/api/ai/settings", async (req, reply) => {
    const session = await getActiveSessionName();
    const body = req.body as Partial<AiSettingsDto> & {
      openaiApiKey?: string | null;
      clearOpenaiApiKey?: boolean;
    };
    try {
      return await saveAiSettings(session, body);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return reply.status(400).send({ error: message });
    }
  });

  app.get("/api/ai/stats", async () => {
    const session = await getActiveSessionName();
    return getAiStats(session);
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

  app.get("/api/ai/knowledge/export", async (req, reply) => {
    if (!prisma) throw new Error("Banco indisponível");
    const session = await getActiveSessionName();
    const q = req.query as { format?: string };
    const format = q.format === "csv" ? "csv" : "json";

    const items = await prisma.instanceAiKnowledge.findMany({
      where: { session },
      orderBy: { createdAt: "asc" }
    });

    const stamp = new Date().toISOString().slice(0, 10);
    const safeSession = session.replace(/[^\w.-]+/g, "_");

    if (format === "csv") {
      const header = ["id", "kind", "topic", "content", "chatId", "modality", "sourceMsgId", "createdAt"];
      const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
      const rows = items.map((k) =>
        [
          k.id,
          k.kind,
          k.topic ?? "",
          k.content,
          k.chatId,
          k.modality,
          k.sourceMsgId ?? "",
          k.createdAt.toISOString()
        ]
          .map((v) => escape(String(v)))
          .join(",")
      );
      const csv = [header.join(","), ...rows].join("\n");
      return reply
        .header("Content-Type", "text/csv; charset=utf-8")
        .header(
          "Content-Disposition",
          `attachment; filename="aprendizagem-${safeSession}-${stamp}.csv"`
        )
        .send(`\uFEFF${csv}`);
    }

    const payload = {
      session,
      exportedAt: new Date().toISOString(),
      total: items.length,
      items
    };

    return reply
      .header("Content-Type", "application/json; charset=utf-8")
      .header(
        "Content-Disposition",
        `attachment; filename="aprendizagem-${safeSession}-${stamp}.json"`
      )
      .send(JSON.stringify(payload, null, 2));
  });

  app.post("/api/ai/knowledge/import", async (req, reply) => {
    if (!prisma) throw new Error("Banco indisponível");

    const session = await getActiveSessionName();
    const body = req.body as {
      content?: string;
      format?: string;
      mode?: string;
    };

    const content = body.content?.trim();
    if (!content) {
      return reply.status(400).send({ error: "content obrigatório" });
    }

    const format = body.format === "csv" ? "csv" : "json";
    const mode = body.mode === "replace" ? "replace" : "merge";

    try {
      const rows = parseKnowledgeImport(content, format);
      if (rows.length === 0) {
        return reply.status(400).send({ error: "Nenhum item válido encontrado no arquivo" });
      }

      const result = await importKnowledgeForSession({ session, rows, mode });

      await logAiEvent({
        session,
        event: "imported",
        detail: `${result.imported} importados, ${result.skipped} ignorados (${format}, ${mode})`
      });

      return { ok: true, session, ...result };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return reply.status(400).send({ error: message });
    }
  });

  app.post("/api/ai/knowledge/backfill", async (req, reply) => {
    if (!prisma) throw new Error("Banco indisponível");

    const session = await getActiveSessionName();
    const body = (req.body ?? {}) as { limit?: number };

    try {
      const result = await queueHistoryLearning({
        session,
        limit: body.limit
      });
      return { ok: true, session, ...result };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return reply.status(400).send({ error: message });
    }
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

  app.post("/api/ai/draft", async (req, reply) => {
    const session = await getActiveSessionName();
    const body = req.body as {
      channel?: string;
      audience?: string;
      goal?: string;
      brief?: string;
      mediaUrl?: string;
    };
    try {
      const { draftCopy } = await import("../services/ai/draftCopy.js");
      const draft = await draftCopy({
        session,
        channel: body.channel === "email" ? "email" : "whatsapp",
        audience: body.audience === "person" ? "person" : "group",
        goal: body.goal ?? "",
        brief: body.brief ?? "",
        mediaUrl: body.mediaUrl
      });
      return { ok: true, ...draft };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return reply.status(400).send({ ok: false, error: message });
    }
  });
}
