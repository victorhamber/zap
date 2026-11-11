import type { FastifyInstance } from "fastify";
import { prisma } from "../prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { contactToJson } from "../services/contacts.js";
import { FUNNEL_STAGES, FUNNEL_LABELS } from "../services/contactStage.js";
import { parseFollowUpSteps } from "../services/coldFollowUp.js";

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
    if (!prisma) return { steps: [], flows: [] };
    const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
    const flows = await prisma.flow.findMany({
      where: { enabled: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" }
    });
    return {
      steps: parseFollowUpSteps(settings?.followUpSteps, {
        hours: settings?.followUpHours,
        flowId: settings?.followUpFlowId
      }),
      flows
    };
  });

  app.put("/api/crm/follow-up", async (req, reply) => {
    if (!prisma) return reply.status(503).send({ error: "Banco indisponível" });
    const body = req.body as { steps?: unknown };
    const steps = parseFollowUpSteps(body.steps);
    const first = steps[0];
    await prisma.appSettings.update({
      where: { id: "default" },
      data: {
        followUpSteps: steps,
        followUpHours: first?.hours ?? 0,
        followUpFlowId: first?.flowId ?? null
      }
    });
    return { ok: true, steps };
  });
}
