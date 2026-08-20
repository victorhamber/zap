import type { FastifyInstance } from "fastify";
import { prisma } from "../prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { defaultHotmartGraph } from "../engine/graph.js";
import { resolveFlowTriggerType } from "../engine/executor.js";
import { queueFlowRunStart } from "../services/flowDispatch.js";
import { parseGraph } from "../engine/graph.js";
import type { FlowGraph } from "../types/flow.js";

export async function flowRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get("/api/flows", async () => {
    if (!prisma) return [];
    return prisma.flow.findMany({ orderBy: { updatedAt: "desc" } });
  });

  app.get("/api/flows/:id", async (req, reply) => {
    if (!prisma) return reply.status(503).send({ error: "Banco indisponível" });
    const id = (req.params as { id: string }).id;
    const flow = await prisma.flow.findUnique({ where: { id } });
    if (!flow) return reply.status(404).send({ error: "Não encontrado" });
    return flow;
  });

  /** Sample + paths achatados do webhook personalizado (para mapear name/phone/email). */
  app.get("/api/flows/:id/custom-webhook", async (req, reply) => {
    if (!prisma) return reply.status(503).send({ error: "Banco indisponível" });
    const id = (req.params as { id: string }).id;
    const flow = await prisma.flow.findUnique({ where: { id } });
    if (!flow) return reply.status(404).send({ error: "Não encontrado" });

    const { flattenJsonPaths, suggestWebhookFieldPath } = await import(
      "../utils/flattenJsonPaths.js"
    );
    const { getCustomWebhookTriggerFromGraph, getCustomWebhookConfigFromGraph } = await import(
      "../engine/executor.js"
    );

    let mapping = {
      phonePath: "",
      namePath: "",
      emailPath: "",
      externalIdPath: ""
    };
    let secret = "";
    try {
      const graph = parseGraph(flow.graphJson);
      if (getCustomWebhookTriggerFromGraph(graph)) {
        const cfg = getCustomWebhookConfigFromGraph(graph);
        mapping = {
          phonePath: cfg.mapping.phonePath ?? "",
          namePath: cfg.mapping.namePath ?? "",
          emailPath: cfg.mapping.emailPath ?? "",
          externalIdPath: cfg.mapping.externalIdPath ?? ""
        };
        secret = cfg.secret ?? "";
      }
    } catch {
      /* grafo inválido */
    }

    const sample = flow.webhookSample ?? null;
    const paths = sample != null ? flattenJsonPaths(sample) : [];
    const suggestions = {
      phonePath: suggestWebhookFieldPath(paths, "phone"),
      namePath: suggestWebhookFieldPath(paths, "name"),
      emailPath: suggestWebhookFieldPath(paths, "email"),
      externalIdPath: suggestWebhookFieldPath(paths, "externalId")
    };

    const origin = (
      process.env.APP_PUBLIC_URL ??
      `${req.protocol}://${req.hostname}`
    ).replace(/\/$/, "");

    return {
      ok: true,
      url: `${origin}/api/webhooks/custom/${id}`,
      secret,
      mapping,
      suggestions,
      sample,
      sampleAt: flow.webhookSampleAt,
      paths
    };
  });

  app.post("/api/flows", async (req) => {
    if (!prisma) throw new Error("Banco indisponível");
    const body = req.body as { name?: string; graphJson?: FlowGraph; enabled?: boolean };
    return prisma.flow.create({
      data: {
        name: body.name ?? "Novo fluxo",
        enabled: body.enabled ?? false,
        graphJson: (body.graphJson ?? defaultHotmartGraph()) as object,
        schemaVersion: 1
      }
    });
  });

  app.put("/api/flows/:id", async (req, reply) => {
    if (!prisma) return reply.status(503).send({ error: "Banco indisponível" });
    const id = (req.params as { id: string }).id;
    const body = req.body as { name?: string; graphJson?: FlowGraph; enabled?: boolean };
    try {
      const before = await prisma.flow.findUnique({ where: { id } });
      if (!before) return reply.status(404).send({ error: "Não encontrado" });

      const updated = await prisma.flow.update({
        where: { id },
        data: {
          name: body.name,
          graphJson: body.graphJson as object | undefined,
          enabled: body.enabled
        }
      });

      const justPublished = body.enabled === true && before.enabled !== true;
      let groupsAutoStart: Awaited<
        ReturnType<
          typeof import("../services/groupsFlowTrigger.js").ensureGroupsFlowRunning
        >
      > | null = null;

      if (justPublished) {
        try {
          const graph = parseGraph(updated.graphJson);
          if (graph.nodes.some((n) => n.type === "trigger_groups")) {
            const { ensureGroupsFlowRunning } = await import(
              "../services/groupsFlowTrigger.js"
            );
            groupsAutoStart = await ensureGroupsFlowRunning(id, "auto_publish");
            console.log(
              `[flows] Publicação iniciou grupos flow=${id}:`,
              groupsAutoStart
            );
          }
        } catch (err) {
          console.warn(
            `[flows] Auto-start grupos falhou flow=${id}:`,
            err instanceof Error ? err.message : err
          );
        }
      }

      return {
        ...updated,
        ...(groupsAutoStart
          ? {
              groupsAutoStart: {
                started: groupsAutoStart.started,
                scheduled: groupsAutoStart.scheduled ?? 0,
                skipped: groupsAutoStart.skipped ?? 0,
                total: groupsAutoStart.total ?? 0,
                reason: groupsAutoStart.reason
              }
            }
          : {})
      };
    } catch {
      return reply.status(404).send({ error: "Não encontrado" });
    }
  });

  app.delete("/api/flows/:id", async (req, reply) => {
    if (!prisma) return reply.status(503).send({ error: "Banco indisponível" });
    const id = (req.params as { id: string }).id;
    try {
      await prisma.flow.delete({ where: { id } });
      return { ok: true };
    } catch {
      return reply.status(404).send({ error: "Não encontrado" });
    }
  });

  app.post("/api/flows/:id/test", async (req, reply) => {
    if (!prisma) return reply.status(503).send({ error: "Banco indisponível" });
    const id = (req.params as { id: string }).id;
    const body = req.body as {
      phone?: string;
      variables?: Record<string, unknown>;
    };

    const phone = body.phone;
    if (!phone) return reply.status(400).send({ error: "phone obrigatório" });

    const vars = {
      phone,
      name: "Teste",
      email: "teste@email.com",
      productName: "Produto Teste",
      purchaseId: `test_${Date.now()}`,
      offerCode: "",
      offerName: "Oferta Teste",
      login: "user",
      password: "pass",
      accessLink: "https://exemplo.com",
      ...(body.variables ?? {})
    };

    const flow = await prisma.flow.findUnique({ where: { id } });
    if (!flow) return reply.status(404).send({ error: "Fluxo não encontrado" });
    const graph = parseGraph(flow.graphJson);
    const triggerType = resolveFlowTriggerType(graph);

    const result = await queueFlowRunStart({
      flowId: id,
      triggerType,
      contactPhone: phone,
      variables: vars,
      externalId: `manual_${Date.now()}`,
      manualStart: true
    });

    return result;
  });

  /** Dispara broadcast para todos os contatos (filtros ficam nas condições do fluxo). */
  app.post("/api/flows/:id/dispatch-broadcast", async (req, reply) => {
    if (!prisma) return reply.status(503).send({ error: "Banco indisponível" });
    const id = (req.params as { id: string }).id;

    try {
      const { dispatchBroadcastFlow } = await import("../services/broadcastFlowTrigger.js");
      const result = await dispatchBroadcastFlow(id);
      return { ok: true, ...result };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return reply.status(400).send({ error: message });
    }
  });

  /** Dispara o gatilho de grupos agora (um run por grupo). */
  app.post("/api/flows/:id/dispatch-groups", async (req, reply) => {
    if (!prisma) return reply.status(503).send({ error: "Banco indisponível" });
    const id = (req.params as { id: string }).id;
    const body = (req.body ?? {}) as { restart?: boolean };

    try {
      if (body.restart) {
        const { restartGroupsFlow } = await import("../services/groupsFlowTrigger.js");
        const result = await restartGroupsFlow(id);
        return { ok: true, ...result };
      }
      const { ensureGroupsFlowRunning } = await import("../services/groupsFlowTrigger.js");
      const ensured = await ensureGroupsFlowRunning(id, "manual");
      if (ensured.started || ensured.reason === "already_active") {
        return {
          ok: true,
          scheduled: ensured.scheduled ?? 0,
          skipped: ensured.skipped ?? 0,
          total: ensured.total ?? 0,
          alreadyActive: ensured.reason === "already_active"
        };
      }
      const { dispatchGroupsFlow } = await import("../services/groupsFlowTrigger.js");
      const result = await dispatchGroupsFlow(id, { reason: "manual" });
      return { ok: true, ...result };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return reply.status(400).send({ error: message });
    }
  });

  /** Dispara o fluxo para contatos que já têm as tags do gatilho (não só quando a tag é adicionada). */
  app.post("/api/flows/:id/dispatch-tag-existing", async (req, reply) => {
    if (!prisma) return reply.status(503).send({ error: "Banco indisponível" });
    const id = (req.params as { id: string }).id;

    try {
      const { dispatchTagFlowToExistingContacts } = await import("../services/tagFlowTrigger.js");
      const result = await dispatchTagFlowToExistingContacts(id);
      return { ok: true, ...result };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return reply.status(400).send({ error: message });
    }
  });

  /** Dispara o fluxo (gatilho tag) para todos os contatos que já têm a tag, com cadência humanizada. */
  app.post("/api/flows/:id/dispatch-tag", async (req, reply) => {
    if (!prisma) return reply.status(503).send({ error: "Banco indisponível" });
    const id = (req.params as { id: string }).id;
    const body = req.body as { tagName?: string };
    const tagName = body.tagName?.trim();
    if (!tagName) return reply.status(400).send({ error: "tagName obrigatório" });

    try {
      const { dispatchTagFlowToContactsWithTag } = await import("../services/tagFlowTrigger.js");
      const result = await dispatchTagFlowToContactsWithTag(id, tagName);
      return { ok: true, ...result };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return reply.status(400).send({ error: message });
    }
  });
}
