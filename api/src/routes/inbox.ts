import type { FastifyInstance } from "fastify";
import { isGenericSelfChatName } from "../services/waJid.js";
import { prisma } from "../prisma.js";
import { requireAuth } from "../middleware/auth.js";
import * as inbox from "../services/inbox.js";
import { fetchInboxMessageMedia } from "../services/inboxStore.js";
import { getContactAvatarUrl } from "../services/contactAvatar.js";
import { saveUploadFromData } from "../services/uploads.js";
import {
  contactToJson,
  listContactsWithTags,
  upsertContact
} from "../services/contacts.js";
import { startFlowRun } from "../engine/executor.js";
import { parseGraph } from "../engine/graph.js";
import * as wpp from "../services/whatsapp/index.js";

type QuickReplyKind = "text" | "image" | "video" | "audio" | "document";

type QuickReply = {
  id: string;
  title: string;
  color: string;
  kind: QuickReplyKind;
  text: string;
  mediaUrl: string;
  filename: string;
  useCount: number;
  lastUsedAt: number;
};

function sortQuickReplies(list: QuickReply[]): QuickReply[] {
  return [...list].sort((a, b) => {
    if (b.useCount !== a.useCount) return b.useCount - a.useCount;
    return b.lastUsedAt - a.lastUsedAt;
  });
}

function normalizeQuickReply(raw: Record<string, unknown>): QuickReply | null {
  const title = String(raw.title ?? "").trim();
  if (!title) return null;

  const id = String(raw.id ?? title).trim() || title;
  const color = String(raw.color ?? "#25D366").trim() || "#25D366";
  const text = String(raw.text ?? "").trim();
  const mediaUrl = String(raw.mediaUrl ?? "").trim();
  const filename = String(raw.filename ?? "").trim();
  let kind = String(raw.kind ?? "").trim() as QuickReplyKind;

  if (!kind || kind === "text") {
    if (mediaUrl) {
      const fn = filename.toLowerCase();
      if (/\.(mp4|webm|mov|mkv)/.test(fn)) kind = "video";
      else if (/\.(jpe?g|png|gif|webp)/.test(fn)) kind = "image";
      else if (/\.(ogg|mp3|m4a|wav|webm)/.test(fn)) kind = "audio";
      else kind = "document";
    } else {
      kind = "text";
    }
  }

  return {
    id,
    title,
    color,
    kind,
    text,
    mediaUrl,
    filename,
    useCount: Math.max(0, Number(raw.useCount) || 0),
    lastUsedAt: Math.max(0, Number(raw.lastUsedAt) || 0)
  };
}

function parseQuickReplies(raw: unknown): QuickReply[] {
  if (!Array.isArray(raw)) return [];
  const out: QuickReply[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const normalized = normalizeQuickReply(item as Record<string, unknown>);
    if (normalized) out.push(normalized);
  }
  return sortQuickReplies(out);
}

function sanitizeQuickRepliesForSave(list: QuickReply[]): QuickReply[] {
  return list
    .map((r) => ({
      id: r.id.trim(),
      title: r.title.trim(),
      color: r.color.trim() || "#25D366",
      kind: r.kind,
      text: r.text.trim(),
      mediaUrl: r.mediaUrl.trim(),
      filename: r.filename.trim(),
      useCount: Math.max(0, r.useCount || 0),
      lastUsedAt: Math.max(0, r.lastUsedAt || 0)
    }))
    .filter((r) => r.id && r.title);
}

export async function inboxRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get("/api/inbox/chats", async () => {
    try {
      const { chats, sourcesOk, errors } = await inbox.fetchChats();
      const contacts = await listContactsWithTags();
      const byKey = new Map<string, ReturnType<typeof contactToJson>>();
      for (const c of contacts) {
        const j = contactToJson(c);
        byKey.set(c.phone, j);
        if (c.phone.includes("@")) byKey.set(c.phone.split("@")[0], j);
      }

      const message =
        chats.length === 0
          ? errors.length > 0
            ? `Nenhuma conversa retornada. ${errors[0]}`
            : "Nenhuma conversa no WPP. Confira Conexão/QR em Configurações."
          : undefined;

      return {
        ok: chats.length > 0,
        chats: chats.map((ch) => {
          const contact = byKey.get(ch.id) ?? byKey.get(ch.phone) ?? null;
          const contactName = contact?.name?.trim();
          const looksLikePhone =
            !ch.name ||
            ch.name === ch.phone ||
            isGenericSelfChatName(ch.name) ||
            /^\d{8,}$/.test(ch.name.replace(/\D/g, ""));
          const name =
            contactName && contactName !== contact?.phone
              ? contactName
              : looksLikePhone && contactName
                ? contactName
                : ch.name;
          return {
            ...ch,
            name,
            contact
          };
        }),
        sourcesOk,
        errors,
        message
      };
    } catch (e: any) {
      return { ok: false, message: e?.message ?? String(e), chats: [], errors: [] };
    }
  });

  app.get("/api/inbox/session-profile", async () => {
    try {
      const profile = await wpp.getConnectedInstanceProfile();
      return { ok: true, profile };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return { ok: false, profile: null, message };
    }
  });

  app.get("/api/inbox/avatar", async (req, reply) => {
    const q = req.query as { chatId?: string; isGroup?: string };
    const chatId = (q.chatId ?? "").trim();
    if (!chatId) return reply.status(400).send({ ok: false, url: null });
    const isGroup = q.isGroup === "1" || q.isGroup === "true" || chatId.includes("@g.us");
    try {
      const url = await getContactAvatarUrl(chatId, isGroup);
      return { ok: true, url };
    } catch {
      return { ok: true, url: null };
    }
  });

  app.get("/api/inbox/messages", async (req) => {
    const q = req.query as { chatId?: string; isGroup?: string };
    const chatId = (q.chatId ?? "").trim();
    if (!chatId) {
      return { ok: false, message: "chatId obrigatório", messages: [] };
    }
    const isGroup = q.isGroup === "1" || q.isGroup === "true" || chatId.includes("@g.us");
    try {
      const { messages, hint, captureSince } = await inbox.fetchMessages(chatId, {
        chatId,
        isGroup
      });
      return { ok: true, messages, hint, captureSince, localOnly: true };
    } catch (e: any) {
      return { ok: false, message: e?.message ?? String(e), messages: [] };
    }
  });

  app.post("/api/inbox/messages/:id/fetch-media", async (req, reply) => {
    const id = (req.params as { id: string }).id;
    const result = await fetchInboxMessageMedia(id);
    if (!result.ok) {
      return reply.status(400).send({ ok: false, message: result.message });
    }
    return { ok: true, url: result.url };
  });

  app.post("/api/inbox/upload", async (req, reply) => {
    const body = req.body as { data?: string; mime?: string };
    const data = (body.data ?? "").trim();
    if (!data) return reply.status(400).send({ ok: false, message: "data obrigatório" });
    try {
      const { url } = await saveUploadFromData(data, body.mime);
      return { ok: true, url };
    } catch (e: any) {
      return reply.status(400).send({ ok: false, message: e?.message ?? String(e) });
    }
  });

  app.post("/api/inbox/send", async (req) => {
    const body = req.body as {
      chatId?: string;
      message?: string;
      isGroup?: boolean;
    };
    const chatId = (body.chatId ?? "").trim();
    const message = (body.message ?? "").trim();
    if (!chatId || !message) return { ok: false, message: "chatId e mensagem obrigatórios" };

    try {
      await inbox.sendChatMessage(chatId, message, body.isGroup === true);
      return { ok: true };
    } catch (e: any) {
      return { ok: false, message: e?.message ?? String(e) };
    }
  });

  app.post("/api/inbox/send-media", async (req) => {
    const body = req.body as {
      chatId?: string;
      type?: "image" | "video" | "audio" | "document";
      url?: string;
      caption?: string;
      filename?: string;
      isGroup?: boolean;
    };
    const chatId = (body.chatId ?? "").trim();
    const url = (body.url ?? "").trim();
    if (!chatId || !url || !body.type) {
      return { ok: false, message: "chatId, type e url são obrigatórios" };
    }

    try {
      await inbox.sendChatMedia(chatId, body.type, url, {
        caption: body.caption,
        filename: body.filename,
        isGroup: body.isGroup
      });
      return { ok: true };
    } catch (e: any) {
      return { ok: false, message: e?.message ?? String(e) };
    }
  });

  app.post("/api/inbox/start-flow", async (req, reply) => {
    if (!prisma) return reply.status(503).send({ error: "Banco indisponível" });
    const body = req.body as { chatId?: string; flowId?: string; name?: string; isGroup?: boolean };
    if (!body.flowId || !body.chatId) {
      return reply.status(400).send({ error: "flowId e chatId obrigatórios" });
    }

    const contact = await upsertContact(body.chatId, { name: body.name });
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

  app.get("/api/inbox/quick-replies", async () => {
    if (!prisma) return { replies: [] };
    const s = await prisma.appSettings.findUnique({ where: { id: "default" } });
    return { replies: parseQuickReplies(s?.quickReplies) };
  });

  app.put("/api/inbox/quick-replies", async (req, reply) => {
    if (!prisma) return reply.status(503).send({ error: "Banco indisponível" });
    const body = req.body as { replies?: QuickReply[] };
    const replies = sanitizeQuickRepliesForSave(body.replies ?? []);
    await prisma.appSettings.update({
      where: { id: "default" },
      data: { quickReplies: replies }
    });
    return { ok: true, replies: sortQuickReplies(replies) };
  });

  app.post("/api/inbox/quick-replies/:id/use", async (req, reply) => {
    if (!prisma) return reply.status(503).send({ error: "Banco indisponível" });
    const id = (req.params as { id: string }).id;
    const s = await prisma.appSettings.findUnique({ where: { id: "default" } });
    const replies = parseQuickReplies(s?.quickReplies);
    const now = Date.now();
    let found = false;
    const updated = replies.map((r) => {
      if (r.id !== id) return r;
      found = true;
      return { ...r, useCount: r.useCount + 1, lastUsedAt: now };
    });
    if (!found) return reply.status(404).send({ ok: false, message: "Resposta não encontrada" });
    await prisma.appSettings.update({
      where: { id: "default" },
      data: { quickReplies: updated }
    });
    return { ok: true, replies: sortQuickReplies(updated) };
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

  app.put("/api/tags/:id", async (req, reply) => {
    if (!prisma) return reply.status(503).send({ error: "Banco indisponível" });
    const id = (req.params as { id: string }).id;
    const body = req.body as { name?: string; color?: string };
    const name = (body.name ?? "").trim();
    if (!name) return reply.status(400).send({ error: "Nome da tag obrigatório" });

    try {
      const tag = await prisma.tag.update({
        where: { id },
        data: { name, color: body.color ?? "#25D366" }
      });
      return { ok: true, tag };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return reply.status(400).send({ ok: false, error: message });
    }
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
