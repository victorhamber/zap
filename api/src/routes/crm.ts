import type { FastifyInstance } from "fastify";
import { prisma } from "../prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { contactToJson } from "../services/contacts.js";
import { FUNNEL_STAGES, FUNNEL_LABELS } from "../services/contactStage.js";

export async function crmRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get("/api/crm/board", async () => {
    if (!prisma) return { stages: [], contacts: [] };
    const contacts = await prisma.contact.findMany({
      include: { tags: { include: { tag: true } } },
      orderBy: { updatedAt: "desc" }
    });
    return {
      stages: FUNNEL_STAGES.map((id) => ({ id, label: FUNNEL_LABELS[id] })),
      contacts: contacts.map((c) => contactToJson(c))
    };
  });

  app.get("/api/crm/follow-up", async () => {
    if (!prisma) return { hours: 24, flowId: "" };
    const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
    const flows = await prisma.flow.findMany({
      where: { enabled: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" }
    });
    return {
      hours: settings?.followUpHours ?? 24,
      flowId: settings?.followUpFlowId ?? "",
      flows
    };
  });

  app.put("/api/crm/follow-up", async (req, reply) => {
    if (!prisma) return reply.status(503).send({ error: "Banco indisponível" });
    const body = req.body as { hours?: number; flowId?: string };
    const hours = Math.max(0, Math.min(24 * 30, Math.floor(Number(body.hours ?? 24))));
    const flowId = (body.flowId ?? "").trim();
    await prisma.appSettings.update({
      where: { id: "default" },
      data: { followUpHours: hours, followUpFlowId: flowId || null }
    });
    return { ok: true, hours, flowId };
  });
}
