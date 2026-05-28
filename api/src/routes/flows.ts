import type { FastifyInstance } from "fastify";
import { prisma } from "../prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { defaultHotmartGraph } from "../engine/graph.js";
import { startFlowRun } from "../engine/executor.js";
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
      return await prisma.flow.update({
        where: { id },
        data: {
          name: body.name,
          graphJson: body.graphJson as object | undefined,
          enabled: body.enabled
        }
      });
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
      login: "user",
      password: "pass",
      accessLink: "https://exemplo.com",
      ...(body.variables ?? {})
    };

    const flow = await prisma.flow.findUnique({ where: { id } });
    if (!flow) return reply.status(404).send({ error: "Fluxo não encontrado" });
    const graph = parseGraph(flow.graphJson);
    const triggerType = graph.nodes.some((n) => n.type === "trigger_manual")
      ? "trigger_manual"
      : graph.nodes.some((n) => n.type === "trigger_hotmart")
        ? "trigger_hotmart"
        : graph.nodes[0]?.type ?? "trigger_manual";

    const result = await startFlowRun({
      flowId: id,
      triggerType,
      contactPhone: phone,
      variables: vars,
      externalId: `manual_${Date.now()}`
    });

    return result;
  });
}
