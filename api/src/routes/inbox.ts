import type { FastifyInstance } from "fastify";
import { prisma } from "../prisma.js";
import { requireAuth } from "../middleware/auth.js";
import * as inbox from "../services/inbox.js";
import {
  contactToJson,
  listContactsWithTags,
  upsertContact
} from "../services/contacts.js";
import { startFlowRun } from "../engine/executor.js";
import { parseGraph } from "../engine/graph.js";

export async function inboxRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get("/api/inbox/chats", async () => {
    try {
      const chats = await inbox.fetchChats();
      const contacts = await listContactsWithTags();
      const byPhone = new Map(contacts.map((c) => [c.phone, contactToJson(c)]));

      return {
        ok: true,
        chats: chats.map((ch) => ({
          ...ch,
          contact: byPhone.get(ch.phone) ?? null
        }))
      };
    } catch (e: any) {
      return { ok: false, message: e?.message ?? String(e), chats: [] };
    }
  });

  app.get("/api/inbox/chats/:phone/messages", async (req) => {
    const phone = decodeURIComponent((req.params as { phone: string }).phone);
    const q = req.query as { chatId?: string; isGroup?: string };
    const chatId = q.chatId ? decodeURIComponent(q.chatId) : phone;
    const isGroup = q.isGroup === "1" || q.isGroup === "true" || chatId.includes("@g.us");
    try {
      const { messages, hint } = await inbox.fetchMessages(phone, {
        chatId,
        isGroup
      });
      return { ok: true, messages, hint };
    } catch (e: any) {
      return { ok: false, message: e?.message ?? String(e), messages: [] };
    }
  });

  app.post("/api/inbox/chats/:phone/send", async (req) => {
    const phone = decodeURIComponent((req.params as { phone: string }).phone);
    const body = req.body as { message?: string; isGroup?: boolean };
    const message = (body.message ?? "").trim();
    if (!message) return { ok: false, message: "Mensagem vazia" };

    try {
      await inbox.sendChatMessage(phone, message, body.isGroup === true);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, message: e?.message ?? String(e) };
    }
  });

  app.post("/api/inbox/chats/:phone/start-flow", async (req, reply) => {
    if (!prisma) return reply.status(503).send({ error: "Banco indisponível" });
    const phone = decodeURIComponent((req.params as { phone: string }).phone);
    const body = req.body as { flowId?: string; name?: string };
    if (!body.flowId) return reply.status(400).send({ error: "flowId obrigatório" });

    const contact = await upsertContact(phone, { name: body.name });
    const result = await startFlowRun({
      flowId: body.flowId,
      triggerType: "trigger_manual",
      contactPhone: contact!.phone,
      variables: {
        phone: contact!.phone,
        name: contact!.name ?? body.name ?? contact!.phone,
        message: ""
      },
      externalId: `manual_${contact!.phone}_${Date.now()}`
    });

    return { ok: true, result };
  });

  app.get("/api/tags", async () => {
    if (!prisma) return { tags: [] };
    const tags = await prisma.tag.findMany({ orderBy: { name: "asc" } });
    return { tags };
  });

  app.post("/api/tags", async (req, reply) => {
    if (!prisma) return reply.status(503).send({ error: "Banco indisponível" });
    const body = req.body as { name?: string; color?: string };
    const name = (body.name ?? "").trim();
    if (!name) return reply.status(400).send({ error: "Nome da tag obrigatório" });

    const tag = await prisma.tag.upsert({
      where: { name },
      update: { color: body.color ?? "#25D366" },
      create: { name, color: body.color ?? "#25D366" }
    });
    return { ok: true, tag };
  });

  app.delete("/api/tags/:id", async (req, reply) => {
    if (!prisma) return reply.status(503).send({ error: "Banco indisponível" });
    await prisma.tag.delete({ where: { id: (req.params as { id: string }).id } });
    return { ok: true };
  });

  app.put("/api/contacts/:phone", async (req, reply) => {
    const phone = decodeURIComponent((req.params as { phone: string }).phone);
    const body = req.body as { name?: string; notes?: string; tagIds?: string[] };
    try {
      const contact = await upsertContact(phone, body);
      return { ok: true, contact: contact ? contactToJson(contact) : null };
    } catch (e: any) {
      return reply.status(400).send({ ok: false, error: e?.message ?? String(e) });
    }
  });

  app.get("/api/flows/enabled", async () => {
    if (!prisma) return { flows: [] };
    const flows = await prisma.flow.findMany({
      where: { enabled: true },
      select: { id: true, name: true, graphJson: true }
    });
    return {
      flows: flows.map((f) => {
        const graph = parseGraph(f.graphJson);
        const inbound = graph.nodes.find((n) => n.type === "trigger_inbound");
        const tags = inbound
          ? ((inbound.data as { tags?: string[] }).tags ?? [])
          : [];
        return { id: f.id, name: f.name, inboundTags: tags };
      })
    };
  });
}
