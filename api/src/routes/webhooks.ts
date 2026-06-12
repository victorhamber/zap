import type { FastifyInstance } from "fastify";
import { prisma } from "../prisma.js";
import { env } from "../env.js";
import {
  extractHotmartVariables,
  getHotmartMappingFromGraph,
  getHotmartTriggerFromGraph,
  matchInboundFlows,
  startFlowRun
} from "../engine/executor.js";
import { hotmartEventName, matchHotmartTrigger } from "../utils/hotmartEvents.js";
import { parseGraph } from "../engine/graph.js";
import { asString } from "../utils/jsonPathLite.js";
import { normalizePhone } from "../utils/phone.js";
import { getContactTagNames } from "../services/contacts.js";
import { downloadInboundMedia, isInboundMediaType } from "../services/wppMedia.js";
import {
  parseWppWebhookMessage,
  saveInboxMessage,
  updateInboxMessageMedia,
  webhookMediaAlreadyInline
} from "../services/inboxStore.js";
import {
  getWppWebhookEvent,
  isWppMessageWebhook,
  normalizeWppWebhookBody,
  touchWppWebhookReceived,
  touchWppWebhookSaved,
  touchWppWebhookSkipped
} from "../services/wppWebhook.js";
import { getActiveWppSessionName } from "../services/whatsapp/index.js";

export async function webhookRoutes(app: FastifyInstance) {
  app.post("/api/webhooks/hotmart/:flowId", async (req, reply) => {
    if (!prisma) return reply.status(503).send({ error: "Banco indisponível" });

    const secret = req.headers["x-hotmart-hottok"] ?? req.headers["x-webhook-secret"];
    if (env.HOTMART_WEBHOOK_SECRET && secret !== env.HOTMART_WEBHOOK_SECRET) {
      return reply.status(401).send({ error: "Webhook não autorizado" });
    }

    const flowId = (req.params as { flowId: string }).flowId;
    const flow = await prisma.flow.findUnique({ where: { id: flowId } });
    if (!flow) return reply.status(404).send({ error: "Fluxo não encontrado" });

    const payload = req.body;
    const graph = parseGraph(flow.graphJson);
    const hotmartTrigger = getHotmartTriggerFromGraph(graph);
    if (!hotmartTrigger) {
      return reply.status(400).send({
        error: "Este fluxo não tem gatilho Hotmart (compra ou aguardando pagamento)."
      });
    }

    const event = hotmartEventName(payload);
    if (!matchHotmartTrigger(payload, hotmartTrigger.triggerType)) {
      return {
        skipped: true,
        reason: "event_not_matched",
        event,
        expectedTrigger: hotmartTrigger.triggerType
      };
    }

    const mapping = getHotmartMappingFromGraph(graph);
    const vars = extractHotmartVariables(payload, mapping);
    const externalSuffix =
      hotmartTrigger.triggerType === "trigger_hotmart_pending" ? "pending" : "approved";

    const result = await startFlowRun({
      flowId,
      triggerType: hotmartTrigger.triggerType,
      contactPhone: String(vars.phone),
      variables: vars,
      externalId: `${String(vars.purchaseId)}_${externalSuffix}`
    });

    return { ...result, event, triggerType: hotmartTrigger.triggerType };
  });

  app.get("/api/webhooks/wppconnect", async () => {
    const {
      getLastWppWebhookAt,
      getLastWppWebhookEvent,
      getLastWppWebhookSavedAt,
      getLastWppWebhookSkipReason
    } = await import("../services/wppWebhook.js");
    const activeSession = await getActiveWppSessionName();
    return {
      ok: true,
      activeSession,
      lastWebhookAt: getLastWppWebhookAt(),
      lastWebhookEvent: getLastWppWebhookEvent(),
      lastWebhookSavedAt: getLastWppWebhookSavedAt(),
      lastWebhookSkipReason: getLastWppWebhookSkipReason()
    };
  });

  app.post("/api/webhooks/wppconnect", async (req) => {
    if (!prisma) return { ok: false };

    const raw = (req.body ?? {}) as Record<string, unknown>;
    const body = normalizeWppWebhookBody(raw);
    const event = getWppWebhookEvent(body);
    touchWppWebhookReceived(event);

    const webhookSession = String(body.session ?? "").trim().toLowerCase();
    const activeSession = await getActiveWppSessionName();
    const isMessage = isWppMessageWebhook(body);

    if (webhookSession && webhookSession !== activeSession) {
      const skipped = isMessage ? "other_session_message" : "other_session_lifecycle";
      touchWppWebhookSkipped(skipped);
      return { ok: true, skipped, event, webhookSession, activeSession };
    }

    const { handleWppLifecycleWebhook } = await import("../services/whatsapp/index.js");
    if (await handleWppLifecycleWebhook(body)) {
      return { ok: true, lifecycle: true, event };
    }

    if (!isMessage) {
      touchWppWebhookSkipped("not_message");
      return { ok: true, skipped: "not_message", event };
    }

    const parsed = parseWppWebhookMessage(body);
    let saved = false;
    if (parsed) {
      const msgType = parsed.type === "ptt" ? "audio" : parsed.type;
      const sessionName = webhookSession || activeSession;

      const { ensureInboxCaptureStarted } = await import("../services/inboxStore.js");
      await ensureInboxCaptureStarted();

      await saveInboxMessage({
        chatId: parsed.chatId,
        body: parsed.text,
        fromMe: parsed.fromMe,
        type: msgType,
        mediaUrl: parsed.mediaUrl,
        waMessageId: parsed.waMessageId,
        timestamp: parsed.timestamp,
        sessionName
      });
      saved = true;
      touchWppWebhookSaved();

      const needsMediaDownload =
        parsed.waMessageId &&
        isInboundMediaType(parsed.type) &&
        !webhookMediaAlreadyInline(parsed);

      if (needsMediaDownload) {
        const waId = parsed.waMessageId;
        void downloadInboundMedia(body, waId)
          .then((url) => {
            if (url) return updateInboxMessageMedia(waId!, url);
          })
          .catch((e) => {
            req.log.warn({ err: e, waId }, "download inbound media async");
          });
      }
    }

    const from =
      parsed?.chatId ??
      asString(body.from) ??
      asString((body.sender as Record<string, unknown> | undefined)?.id) ??
      asString((body.data as Record<string, unknown> | undefined)?.from) ??
      asString(body.chatId);
    const text =
      parsed?.text ??
      asString(body.body) ??
      asString(body.content) ??
      asString((body.data as Record<string, unknown> | undefined)?.body) ??
      asString((body.message as Record<string, unknown> | undefined)?.body) ??
      "";

    if (!from) {
      touchWppWebhookSkipped(saved ? "no_from_flow" : "no_from_unparsed");
      return {
        ok: true,
        skipped: saved ? "no_from_flow" : "no_from_unparsed",
        event,
        saved
      };
    }

    const phone = normalizePhone(from.replace(/@.*/, ""));
    const tagNames = await getContactTagNames(phone);

    const flows = await prisma.flow.findMany({ where: { enabled: true } });
    const started: string[] = [];

    for (const flow of flows) {
      const graph = parseGraph(flow.graphJson);
      if (!matchInboundFlows(graph, text, tagNames)) continue;

      const result = await startFlowRun({
        flowId: flow.id,
        triggerType: "trigger_inbound",
        contactPhone: phone,
        variables: {
          phone,
          name: asString(body?.notifyName) ?? "Contato",
          message: text,
          purchaseId: `inbound_${Date.now()}_${flow.id}`
        },
        externalId: `inbound_${phone}_${Date.now()}`
      });

      if (result && "runId" in result) started.push(result.runId as string);
    }

    if (!saved) {
      touchWppWebhookSkipped("message_unparsed");
    }

    return { ok: true, started, saved, event };
  });

  app.get("/api/webhooks/evolution", async () => {
    const {
      getLastWppWebhookAt,
      getLastWppWebhookEvent,
      getLastWppWebhookSavedAt,
      getLastWppWebhookSkipReason
    } = await import("../services/wppWebhook.js");
    const activeSession = await getActiveWppSessionName();
    return {
      ok: true,
      provider: "evolution",
      activeSession,
      lastWebhookAt: getLastWppWebhookAt(),
      lastWebhookEvent: getLastWppWebhookEvent(),
      lastWebhookSavedAt: getLastWppWebhookSavedAt(),
      lastWebhookSkipReason: getLastWppWebhookSkipReason()
    };
  });

  app.post("/api/webhooks/evolution", async (req) => {
    if (!prisma) return { ok: false };

    const body = (req.body ?? {}) as Record<string, unknown>;
    const event = String(body.event ?? "").toLowerCase();
    touchWppWebhookReceived(event);

    const {
      parseEvolutionMessagePayload,
      parseEvolutionConnectionEvent,
      extractEvolutionQr,
      extractEvolutionMessagePayloads,
      isEvolutionMessageEvent
    } = await import("../services/whatsapp/evolutionWebhook.js");

    const activeSession = await getActiveWppSessionName();
    const instance = String(body.instance ?? "").trim().toLowerCase();
    if (instance && instance !== activeSession) {
      touchWppWebhookSkipped("other_session");
      return { ok: true, skipped: "other_session", instance, activeSession };
    }

    const connLabel = parseEvolutionConnectionEvent(body);
    if (connLabel) {
      if (prisma) {
        await prisma.appSettings.update({
          where: { id: "default" },
          data: { connectionStatus: connLabel }
        });
      }
      return { ok: true, lifecycle: true, event };
    }

    const qr = extractEvolutionQr(body);
    if (qr && prisma) {
      await prisma.appSettings.update({
        where: { id: "default" },
        data: { connectionStatus: "AWAITING_QR:QRCODE" }
      });
      return { ok: true, qr: true, event };
    }

    if (!isEvolutionMessageEvent(body)) {
      touchWppWebhookSkipped("not_message");
      return { ok: true, skipped: "not_message", event };
    }

    const payloads = extractEvolutionMessagePayloads(body);
    let saved = false;
    let lastParsed: ReturnType<typeof parseEvolutionMessagePayload> = null;

    const { ensureInboxCaptureStarted } = await import("../services/inboxStore.js");

    for (const payload of payloads) {
      const parsed = parseEvolutionMessagePayload(body, payload);
      if (!parsed) continue;
      lastParsed = parsed;

      await ensureInboxCaptureStarted();

      const key = (payload.key ?? {}) as Record<string, unknown>;
      const msgType = parsed.type === "ptt" ? "audio" : parsed.type;
      await saveInboxMessage({
        chatId: parsed.chatId,
        body: parsed.text,
        fromMe: parsed.fromMe,
        type: msgType,
        mediaUrl: parsed.mediaUrl,
        waMessageId: parsed.waMessageId,
        timestamp: parsed.timestamp,
        sessionName: parsed.instance || activeSession,
        peerJids: [
          String(key.remoteJid ?? ""),
          String(key.remoteJidAlt ?? ""),
          String(key.participant ?? ""),
          String(key.participantAlt ?? ""),
          String(body.sender ?? "")
        ].filter(Boolean)
      });
      saved = true;
      touchWppWebhookSaved();

      const needsMediaDownload =
        parsed.waMessageId &&
        isInboundMediaType(parsed.type) &&
        !webhookMediaAlreadyInline(parsed);

      if (needsMediaDownload) {
        const waId = parsed.waMessageId;
        void downloadInboundMedia(body, waId, parsed.rawData)
          .then((url) => {
            if (url) return updateInboxMessageMedia(waId!, url);
          })
          .catch((e) => {
            req.log.warn({ err: e, waId }, "download evolution media async");
          });
      }
    }

    const parsed = lastParsed;
    const from = parsed?.chatId ?? "";
    const text = parsed?.text ?? "";

    if (!from) {
      touchWppWebhookSkipped(saved ? "no_from_flow" : "no_from_unparsed");
      return { ok: true, skipped: saved ? "no_from_flow" : "no_from_unparsed", event, saved };
    }

    const phone = normalizePhone(from.replace(/@.*/, ""));
    const tagNames = await getContactTagNames(phone);
    const flows = await prisma.flow.findMany({ where: { enabled: true } });
    const started: string[] = [];

    for (const flow of flows) {
      const graph = parseGraph(flow.graphJson);
      if (!matchInboundFlows(graph, text, tagNames)) continue;
      const result = await startFlowRun({
        flowId: flow.id,
        triggerType: "trigger_inbound",
        contactPhone: phone,
        variables: {
          phone,
          name: "Contato",
          message: text,
          purchaseId: `inbound_${Date.now()}_${flow.id}`
        },
        externalId: `inbound_${phone}_${Date.now()}`
      });
      if (result && "runId" in result) started.push(result.runId as string);
    }

    if (!saved) touchWppWebhookSkipped("message_unparsed");
    return { ok: true, started, saved, event };
  });
}
