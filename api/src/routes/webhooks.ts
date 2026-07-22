import type { FastifyInstance, FastifyReply } from "fastify";
import { prisma } from "../prisma.js";
import { env } from "../env.js";
import {
  extractHotmartVariables,
  getHotmartMappingFromGraph,
  getHotmartTriggerFromGraph,
  matchInboundFlows
} from "../engine/executor.js";
import { queueFlowRunStart } from "../services/flowDispatch.js";
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

async function triggerInboundFlows(params: {
  chatId: string;
  text: string;
  contactName?: string;
  log?: { warn: (obj: unknown, msg?: string) => void };
}): Promise<string[]> {
  if (!prisma) return [];
  const from = params.chatId.trim();
  if (!from) return [];

  const phone = normalizePhone(from.replace(/@.*/, ""));
  if (!phone.replace(/\D/g, "")) return [];

  let tagNames: string[] = [];
  try {
    tagNames = await getContactTagNames(phone);
  } catch (err) {
    params.log?.warn({ err, phone }, "getContactTagNames failed");
  }

  const flows = await prisma.flow.findMany({ where: { enabled: true } });
  const started: string[] = [];

  for (const flow of flows) {
    try {
      const graph = parseGraph(flow.graphJson);
      if (!matchInboundFlows(graph, params.text, tagNames)) continue;
      const result = await queueFlowRunStart({
        flowId: flow.id,
        triggerType: "trigger_inbound",
        contactPhone: phone,
        variables: {
          phone,
          name: params.contactName?.trim() || "Contato",
          message: params.text,
          purchaseId: `inbound_${Date.now()}_${flow.id}`
        },
        externalId: `inbound_${phone}_${Date.now()}_${flow.id}`
      });
      if (result && "runId" in result) started.push(result.runId as string);
    } catch (err) {
      params.log?.warn({ err, flowId: flow.id }, "inbound flow trigger failed");
    }
  }

  return started;
}

/**
 * Webhooks de mensagem são públicos por natureza (o WPPConnect/Evolution chama
 * de fora). Se WHATSAPP_WEBHOOK_SECRET estiver definido, exigimos o header —
 * sem ele, qualquer um consegue injetar mensagens no inbox e disparar fluxos.
 * Configure o mesmo valor no header do webhook lá no provedor.
 */
function whatsappWebhookAuthorized(req: {
  headers: Record<string, unknown>;
  query?: unknown;
}): boolean {
  const expected = env.WHATSAPP_WEBHOOK_SECRET?.trim();
  if (!expected) return true;

  const header = req.headers["x-webhook-secret"];
  if (typeof header === "string" && header === expected) return true;

  // Alternativa por query string: nem todo provedor (WPPConnect, por exemplo)
  // deixa configurar header no webhook, mas todos deixam editar a URL.
  const query = (req.query ?? {}) as Record<string, unknown>;
  const qs = query.secret;
  return typeof qs === "string" && qs === expected;
}

/** Rejeição registrada na telemetria — senão o inbox para e não há como diagnosticar. */
function rejectWebhook(reply: FastifyReply, event: string) {
  touchWppWebhookReceived(event);
  touchWppWebhookSkipped("bad_secret");
  return reply.status(401).send({
    error: "Webhook não autorizado",
    hint: "WHATSAPP_WEBHOOK_SECRET está definido — o provedor precisa enviar o header x-webhook-secret ou ?secret= na URL."
  });
}

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

    if (!flow.enabled) {
      console.warn(`[hotmart] Fluxo ${flowId} desativado — compra ignorada (event=${event})`);
      return { skipped: true, reason: "flow_disabled", event, triggerType: hotmartTrigger.triggerType };
    }

    const mapping = getHotmartMappingFromGraph(graph);
    let vars: Awaited<ReturnType<typeof extractHotmartVariables>>;
    try {
      vars = extractHotmartVariables(payload, mapping);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[hotmart] flow=${flowId} event=${event} erro ao extrair dados:`, message);
      return reply.status(422).send({ error: message, event, flowId });
    }

    const externalSuffix =
      hotmartTrigger.triggerType === "trigger_hotmart_pending" ? "pending" : "approved";

    const result = await queueFlowRunStart({
      flowId,
      triggerType: hotmartTrigger.triggerType,
      contactPhone: String(vars.phone),
      variables: vars,
      externalId: `${String(vars.purchaseId)}_${externalSuffix}`
    });

    console.log(
      `[hotmart] flow=${flowId} event=${event} phone=${vars.phone} purchase=${vars.purchaseId}`,
      result
    );

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

  app.post("/api/webhooks/wppconnect", async (req, reply) => {
    if (!prisma) return { ok: false };
    if (!whatsappWebhookAuthorized(req)) {
      return rejectWebhook(reply, String((req.body as Record<string, unknown>)?.event ?? "desconhecido"));
    }

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

      try {
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
      } catch (err) {
        req.log.warn({ err, event }, "save wppconnect message failed");
      }

      if (
        saved &&
        parsed.waMessageId &&
        isInboundMediaType(parsed.type) &&
        !webhookMediaAlreadyInline(parsed)
      ) {
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

    let started: string[] = [];
    if (saved && parsed && !parsed.fromMe) {
      started = await triggerInboundFlows({
        chatId: from,
        text,
        contactName: asString(body?.notifyName) ?? undefined,
        log: req.log
      });
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

  app.post("/api/webhooks/evolution", async (req, reply) => {
    if (!prisma) return { ok: false };
    if (!whatsappWebhookAuthorized(req)) {
      return rejectWebhook(reply, String((req.body as Record<string, unknown>)?.event ?? "desconhecido"));
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const event = String(body.event ?? "").toLowerCase();
    touchWppWebhookReceived(event);

    let saved = false;

    try {
      const {
        parseEvolutionMessagePayload,
        parseEvolutionConnectionEvent,
        extractEvolutionQr,
        extractEvolutionMessagePayloads,
        isEvolutionMessageEvent
      } = await import("../services/whatsapp/evolutionWebhook.js");

      const activeSession = await getActiveWppSessionName();
      const instance = String(body.instance ?? "").trim().toLowerCase();
      // Mensagens de QUALQUER instância são gravadas (com a sessão da própria
      // instância) — inclusive da API oficial Meta via Evolution. Antes, tudo
      // que não fosse da instância ativa era descartado e o histórico sumia.
      const isActiveInstance = !instance || instance === activeSession;

      const connLabel = parseEvolutionConnectionEvent(body);
      if (connLabel) {
        // connectionStatus é global do painel: só a instância ativa atualiza.
        if (isActiveInstance) {
          await prisma.appSettings.update({
            where: { id: "default" },
            data: { connectionStatus: connLabel }
          });
        }
        return { ok: true, lifecycle: true, event, instance };
      }

      const qr = extractEvolutionQr(body);
      if (qr) {
        if (isActiveInstance) {
          await prisma.appSettings.update({
            where: { id: "default" },
            data: { connectionStatus: "AWAITING_QR:QRCODE" }
          });
        }
        return { ok: true, qr: true, event, instance };
      }

      if (!isEvolutionMessageEvent(body)) {
        touchWppWebhookSkipped("not_message");
        return { ok: true, skipped: "not_message", event };
      }

      const payloads = extractEvolutionMessagePayloads(body);
      let lastParsed: ReturnType<typeof parseEvolutionMessagePayload> = null;
      let lastPushName = "";

      const { ensureInboxCaptureStarted } = await import("../services/inboxStore.js");

      for (const payload of payloads) {
        let parsed: ReturnType<typeof parseEvolutionMessagePayload> = null;
        try {
          parsed = parseEvolutionMessagePayload(body, payload);
          if (!parsed) continue;
          lastParsed = parsed;
          if (!parsed.fromMe) {
            const pushName = String(payload.pushName ?? "").trim();
            if (pushName && pushName !== "Você") lastPushName = pushName;
          }

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
        } catch (err) {
          req.log.warn({ err, event, waMessageId: parsed?.waMessageId }, "save evolution message failed");
        }
      }

      const parsed = lastParsed;
      const from = parsed?.chatId ?? "";
      const text = parsed?.text ?? "";

      if (!from) {
        touchWppWebhookSkipped(saved ? "no_from_flow" : "no_from_unparsed");
        return { ok: true, skipped: saved ? "no_from_flow" : "no_from_unparsed", event, saved };
      }

      let started: string[] = [];
      // Fluxos enviam pela instância ativa; só dispara para mensagens dela.
      if (saved && parsed && !parsed.fromMe && isActiveInstance) {
        started = await triggerInboundFlows({
          chatId: from,
          text,
          contactName: lastPushName || undefined,
          log: req.log
        });
      }

      if (!saved) touchWppWebhookSkipped("message_unparsed");
      return { ok: true, started, saved, event };
    } catch (err) {
      req.log.error({ err, event }, "evolution webhook handler error");
      touchWppWebhookSkipped("handler_error");
      return reply.status(200).send({
        ok: false,
        saved,
        event,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  });

  app.get("/api/webhooks/meta", async (req, reply) => {
    const q = req.query as Record<string, unknown>;
    const challenge = await (
      await import("../services/whatsapp/metaWebhook.js")
    ).verifyMetaWebhookChallenge(q);
    if (challenge) {
      return reply.status(200).type("text/plain").send(challenge);
    }
    return { ok: true, service: "meta-cloud-api" };
  });

  app.post("/api/webhooks/meta", async (req, reply) => {
    if (!prisma) return { ok: false };
    if (!whatsappWebhookAuthorized(req)) {
      return rejectWebhook(reply, String((req.body as Record<string, unknown>)?.event ?? "desconhecido"));
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const { parseMetaWebhookMessages } = await import("../services/whatsapp/metaWebhook.js");
    const { ensureInboxCaptureStarted } = await import("../services/inboxStore.js");
    const {
      touchWppWebhookReceived,
      touchWppWebhookSaved,
      touchWppWebhookSkipped
    } = await import("../services/wppWebhook.js");

    touchWppWebhookReceived("meta.messages");

    try {
      const messages = await parseMetaWebhookMessages(body);
      if (messages.length === 0) {
        touchWppWebhookSkipped("not_message");
        return { ok: true, skipped: "not_message" };
      }

      let saved = 0;
      for (const parsed of messages) {
        await ensureInboxCaptureStarted();
        await saveInboxMessage({
          chatId: parsed.chatId,
          body: parsed.text,
          fromMe: parsed.fromMe,
          type: parsed.type,
          waMessageId: parsed.waMessageId,
          timestamp: parsed.timestamp,
          sessionName: parsed.session
        });
        saved++;
        touchWppWebhookSaved();

        if (!parsed.fromMe) {
          await triggerInboundFlows({
            chatId: parsed.chatId,
            text: parsed.text,
            log: req.log
          });
        }
      }

      return { ok: true, saved, count: messages.length };
    } catch (err) {
      req.log.error({ err }, "meta webhook handler error");
      return reply.status(200).send({
        ok: false,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  });
}
