import type { FastifyInstance } from "fastify";
import { prisma } from "../prisma.js";
import { env } from "../env.js";
import {
  extractHotmartVariables,
  getHotmartMappingFromGraph,
  matchInboundFlows,
  startFlowRun
} from "../engine/executor.js";
import { parseGraph } from "../engine/graph.js";
import { asString } from "../utils/jsonPathLite.js";
import { normalizePhone } from "../utils/phone.js";
import { getContactTagNames } from "../services/contacts.js";
import { downloadInboundMedia, isInboundMediaType } from "../services/wppMedia.js";
import {
  parseWppWebhookMessage,
  saveInboxMessage,
  updateInboxMessageMedia
} from "../services/inboxStore.js";
import {
  getWppWebhookEvent,
  isWppMessageWebhook,
  normalizeWppWebhookBody,
  touchWppWebhookReceived
} from "../services/wppWebhook.js";

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
    const mapping = getHotmartMappingFromGraph(graph);
    const vars = extractHotmartVariables(payload, mapping);

    const result = await startFlowRun({
      flowId,
      triggerType: "trigger_hotmart",
      contactPhone: String(vars.phone),
      variables: vars,
      externalId: String(vars.purchaseId)
    });

    return result;
  });

  app.get("/api/webhooks/wppconnect", async () => {
    const { getLastWppWebhookAt, getLastWppWebhookEvent } = await import(
      "../services/wppWebhook.js"
    );
    return {
      ok: true,
      lastWebhookAt: getLastWppWebhookAt(),
      lastWebhookEvent: getLastWppWebhookEvent()
    };
  });

  app.post("/api/webhooks/wppconnect", async (req) => {
    if (!prisma) return { ok: false };

    const raw = (req.body ?? {}) as Record<string, unknown>;
    const body = normalizeWppWebhookBody(raw);
    touchWppWebhookReceived(getWppWebhookEvent(body));

    if (!isWppMessageWebhook(raw)) {
      return { ok: true, skipped: "not_message" };
    }

    const parsed = parseWppWebhookMessage(body);
    if (parsed) {
      const msgType = parsed.type === "ptt" ? "audio" : parsed.type;

      await saveInboxMessage({
        chatId: parsed.chatId,
        body: parsed.text,
        fromMe: parsed.fromMe,
        type: msgType,
        mediaUrl: parsed.mediaUrl,
        waMessageId: parsed.waMessageId,
        timestamp: parsed.timestamp
      });

      if (
        !parsed.fromMe &&
        !parsed.mediaUrl &&
        parsed.waMessageId &&
        isInboundMediaType(parsed.type)
      ) {
        const waId = parsed.waMessageId;
        void downloadInboundMedia(body, waId)
          .then((url) => {
            if (url) return updateInboxMessageMedia(waId, url);
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

    if (!from) return { ok: true, skipped: "no_from" };

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

    return { ok: true, started };
  });
}
