import type { FastifyInstance } from "fastify";
import { isGenericSelfChatName } from "../services/waJid.js";
import { expandPhoneLookupKeys, canonicalBrazilPhone, phoneDedupeKey, phoneDigits } from "../utils/phone.js";
import { prisma } from "../prisma.js";
import { requireAuth } from "../middleware/auth.js";
import * as inbox from "../services/inbox.js";
import { getContactAvatarUrl } from "../services/contactAvatar.js";
import { saveUploadFromData } from "../services/uploads.js";
import {
  contactToJson,
  listContactsWithTags,
  upsertContact
} from "../services/contacts.js";
import { firstNameFromFullName } from "../utils/phone.js";
import { queueFlowRunStart } from "../services/flowDispatch.js";
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

type InboxChatRow = {
  id: string;
  phone: string;
  name: string;
  lastMessage: string;
  timestamp: number;
  unreadCount: number;
  isGroup: boolean;
  kind: string;
  contact: ReturnType<typeof contactToJson> | null;
};

function preferMergedChatId(a: string, b: string): string {
  const rank = (id: string) => {
    if (id.endsWith("@g.us")) return 5;
    if (id.endsWith("@s.whatsapp.net")) return 4;
    if (id.endsWith("@c.us")) return 3;
    if (id.endsWith("@lid")) return 1;
    return 0;
  };
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra > rb ? a : b;
  return a.length >= b.length ? a : b;
}

function mergeInboxChatRows(a: InboxChatRow, b: InboxChatRow): InboxChatRow {
  const ts = Math.max(a.timestamp, b.timestamp);
  const ref = a.timestamp >= b.timestamp ? a : b;
  const other = a.timestamp >= b.timestamp ? b : a;
  const name =
    a.name.length >= b.name.length && !/^\d{8,}$/.test(a.name.replace(/\D/g, ""))
      ? a.name
      : b.name;
  return {
    ...ref,
    id: preferMergedChatId(a.id, b.id),
    phone: phoneDedupeKey(phoneDigits(ref.phone || ref.id)) || ref.phone,
    name,
    lastMessage: ref.lastMessage || other.lastMessage,
    timestamp: ts,
    unreadCount: Math.max(a.unreadCount, b.unreadCount),
    contact: a.contact ?? b.contact
  };
}

/** Última barreira: mesmo contato com JID/telefone em formatos diferentes. */
function dedupeInboxChatRows(list: InboxChatRow[]): InboxChatRow[] {
  const map = new Map<string, InboxChatRow>();
  for (const ch of list) {
    let key: string;
    if (ch.kind === "direct" && !ch.isGroup) {
      const d = phoneDigits(ch.phone || ch.id.replace(/@.*/, ""));
      if (d.length >= 10) key = `p:${phoneDedupeKey(d)}`;
      else if (ch.contact?.id) key = `c:${ch.contact.id}`;
      else key = `id:${ch.id}`;
    } else {
      key = `g:${ch.id}`;
    }
    const prev = map.get(key);
    map.set(key, prev ? mergeInboxChatRows(prev, ch) : ch);
  }
  return [...map.values()].sort((a, b) => {
    if (a.timestamp !== b.timestamp) return b.timestamp - a.timestamp;
    return a.name.localeCompare(b.name, "pt-BR");
  });
}

export async function inboxRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get("/api/inbox/chats", async () => {
    try {
      const { chats, sourcesOk, errors, ownerPhone, ownerPhoneChanged, connected } =
        await inbox.fetchChats();
      const { getHiddenInboxContactKeys, isChatHiddenFromInbox, getInboxSessionName } =
        await import("../services/inboxStore.js");
      const session = await getInboxSessionName();
      const hiddenKeys = await getHiddenInboxContactKeys(session);
      const visibleChats =
        hiddenKeys.size === 0
          ? chats
          : chats.filter((c) => !isChatHiddenFromInbox(c, hiddenKeys, session));
      const contacts = await listContactsWithTags();
      const byKey = new Map<string, ReturnType<typeof contactToJson>>();
      for (const c of contacts) {
        const j = contactToJson(c);
        for (const key of expandPhoneLookupKeys(c.phone)) {
          byKey.set(key, j);
        }
      }

      function resolveChatContact(ch: { id: string; phone: string }) {
        const keys = [
          ch.id,
          ch.phone,
          ch.id.replace(/@.*/, ""),
          ...expandPhoneLookupKeys(ch.phone),
          ...expandPhoneLookupKeys(ch.id)
        ];
        for (const key of keys) {
          const hit = byKey.get(key);
          if (hit) return hit;
        }
        return null;
      }

      const message =
        chats.length === 0
          ? connected
            ? inbox.INBOX_EMPTY_CONNECTED_HINT
            : errors[0] ??
              "WhatsApp não conectado. Vá em Configurações → Instâncias para conectar."
          : undefined;

      return {
        ok: true,
        connected,
        ownerPhone,
        ownerPhoneChanged: ownerPhoneChanged === true,
        chats: dedupeInboxChatRows(
          visibleChats.map((ch) => {
            const phone =
              ch.kind === "direct" && ch.phone ? canonicalBrazilPhone(ch.phone) : ch.phone;
            const contact = resolveChatContact({ ...ch, phone });
            const contactName = contact?.name?.trim();
            const looksLikePhone =
              !ch.name ||
              ch.name === ch.phone ||
              ch.name === phone ||
              isGenericSelfChatName(ch.name) ||
              /^\d{8,}$/.test(ch.name.replace(/\D/g, ""));
            let name =
              contactName && contactName !== contact?.phone
                ? contactName
                : looksLikePhone && contactName
                  ? contactName
                  : ch.name;
            if (ch.kind === "direct" && /^\d{8,}$/.test(String(name).replace(/\D/g, ""))) {
              name = canonicalBrazilPhone(String(name));
            }
            return {
              ...ch,
              phone,
              name,
              contact
            };
          })
        ),
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
      const { ensureInboxOwnerPhone } = await import("../services/inboxStore.js");
      const ownerSync = await ensureInboxOwnerPhone();
      const profile = await wpp.getConnectedInstanceProfile();
      return {
        ok: true,
        profile,
        ownerPhone: ownerSync.phone,
        ownerPhoneChanged: ownerSync.changed
      };
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
    const q = req.query as { chatId?: string; isGroup?: string; sync?: string };
    const chatId = (q.chatId ?? "").trim();
    if (!chatId) {
      return { ok: false, message: "chatId obrigatório", messages: [] };
    }
    const isGroup = q.isGroup === "1" || q.isGroup === "true" || chatId.includes("@g.us");
    // sync=0 → só banco (poll rápido). Padrão sincroniza com a Evolution.
    const skipSync = q.sync === "0";
    try {
      const { messages, hint, captureSince } = await inbox.fetchMessages(chatId, {
        chatId,
        isGroup,
        skipSync
      });
      return { ok: true, messages, hint, captureSince, localOnly: true };
    } catch (e: any) {
      return { ok: false, message: e?.message ?? String(e), messages: [] };
    }
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

  app.post("/api/inbox/forward-message", async (req) => {
    const body = req.body as {
      targets?: Array<{ chatId?: string; isGroup?: boolean }>;
      message?: {
        kind?: "text" | "image" | "video" | "audio" | "document";
        text?: string;
        url?: string;
        caption?: string;
        filename?: string;
      };
    };

    const targets = (body.targets ?? []).filter((t) => t.chatId?.trim());
    const msg = body.message;
    if (targets.length === 0) {
      return { ok: false, message: "Selecione ao menos um contato." };
    }
    if (!msg?.kind) {
      return { ok: false, message: "Mensagem inválida para encaminhar." };
    }

    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    let sent = 0;
    let failed = 0;
    const errors: string[] = [];

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      const chatId = String(target.chatId).trim();
      const isGroup = target.isGroup === true;
      try {
        if (msg.kind === "text") {
          const text = (msg.text ?? "").trim();
          if (!text) throw new Error("Texto vazio");
          await inbox.sendChatMessage(chatId, text, isGroup);
        } else {
          const url = (msg.url ?? "").trim();
          if (!url) throw new Error("URL da mídia ausente");
          await inbox.sendChatMedia(chatId, msg.kind, url, {
            caption: msg.caption,
            filename: msg.filename,
            isGroup
          });
        }
        sent++;
      } catch (e: unknown) {
        failed++;
        const errMsg = e instanceof Error ? e.message : String(e);
        errors.push(`${chatId}: ${errMsg}`);
      }
      if (i < targets.length - 1) {
        await delay(msg.kind === "text" ? 600 : 2600);
      }
    }

    return {
      ok: sent > 0 || failed === 0,
      sent,
      failed,
      errors: errors.slice(0, 8),
      message:
        failed > 0
          ? `${sent} enviado(s), ${failed} falha(s).`
          : `${sent} mensagem(ns) encaminhada(s).`
    };
  });

  app.post("/api/inbox/start-flow", async (req, reply) => {
    if (!prisma) return reply.status(503).send({ error: "Banco indisponível" });
    const body = req.body as {
      chatId?: string;
      flowId?: string;
      name?: string;
      phone?: string;
      isGroup?: boolean;
    };
    if (!body.flowId || !body.chatId) {
      return reply.status(400).send({ error: "flowId e chatId obrigatórios" });
    }
    if (body.isGroup) {
      return reply.status(400).send({ error: "Não é possível iniciar fluxo em grupo." });
    }

    try {
      const phoneKey = (body.phone ?? body.chatId).trim();
      const displayName = body.name?.trim() || undefined;
      const contact = await upsertContact(phoneKey, { name: displayName });
      if (!contact) {
        return reply.status(500).send({ ok: false, error: "Não foi possível salvar o contato." });
      }

      const contactName = contact.name ?? displayName ?? "Contato";
      const result = await queueFlowRunStart({
        flowId: body.flowId,
        triggerType: "trigger_manual",
        contactPhone: contact.phone,
        manualStart: true,
        variables: {
          phone: contact.phone,
          name: firstNameFromFullName(contactName, contactName),
          fullName: contactName,
          message: ""
        },
        externalId: `manual_${contact.phone}_${Date.now()}`
      });

      if (result && "skipped" in result && result.skipped) {
        return {
          ok: false,
          error: result.reason === "disabled" ? "Fluxo inativo." : "Execução já existente ou ignorada.",
          result
        };
      }

      return { ok: true, result };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return reply.status(400).send({ ok: false, error: message });
    }
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

  app.get("/api/contacts/:phone/profile", async (req, reply) => {
    const phone = decodeURIComponent((req.params as { phone: string }).phone);
    const q = req.query as { chatId?: string; isGroup?: string };
    try {
      const { getContactProfile } = await import("../services/contactProfile.js");
      const profile = await getContactProfile({
        key: phone,
        chatId: q.chatId,
        isGroup: q.isGroup === "1" || q.isGroup === "true"
      });
      if (!profile) return reply.status(503).send({ ok: false, error: "Indisponível" });
      return { ok: true, profile };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return reply.status(400).send({ ok: false, error: message });
    }
  });

  app.delete("/api/inbox/conversations/:chatId", async (req, reply) => {
    const chatId = decodeURIComponent((req.params as { chatId: string }).chatId);
    if (!chatId.trim()) return reply.status(400).send({ ok: false, error: "chatId obrigatório" });
    try {
      const { deleteInboxConversation } = await import("../services/inboxStore.js");
      const deleted = await deleteInboxConversation(chatId);
      return { ok: true, deleted };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return reply.status(400).send({ ok: false, error: message });
    }
  });

  app.delete("/api/contacts/:phone/crm", async (req, reply) => {
    const phone = decodeURIComponent((req.params as { phone: string }).phone);
    const q = req.query as { chatId?: string };
    try {
      const { removeContactFromCrm } = await import("../services/inboxStore.js");
      const result = await removeContactFromCrm(phone, q.chatId);
      return { ok: true, ...result };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      return reply.status(400).send({ ok: false, error: message });
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
