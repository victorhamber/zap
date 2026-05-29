import type { FastifyInstance } from "fastify";
import { prisma } from "../prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { env } from "../env.js";
import * as wpp from "../services/wppconnect.js";
import { getLastWppWebhookAt, getLastWppWebhookEvent } from "../services/wppWebhook.js";

export async function settingsRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get("/api/settings/wpp", async () => {
    if (!prisma) {
      return {
        wppBaseUrl: env.WPP_BASE_URL,
        wppSession: env.WPP_SESSION,
        hasToken: false,
        connectionStatus: null
      };
    }
    const s = await prisma.appSettings.findUnique({ where: { id: "default" } });
    return {
      wppBaseUrl: s?.wppBaseUrl ?? env.WPP_BASE_URL,
      wppSession: s?.wppSession ?? env.WPP_SESSION,
      hasToken: Boolean(s?.wppToken),
      connectionStatus: s?.connectionStatus
    };
  });

  app.put("/api/settings/wpp", async (req) => {
    if (!prisma) throw new Error("Banco indisponível");
    const body = req.body as { wppBaseUrl?: string; wppSession?: string };
    return prisma.appSettings.upsert({
      where: { id: "default" },
      update: {
        wppBaseUrl: body.wppBaseUrl,
        wppSession: body.wppSession,
        wppToken: null,
        wppTokenFull: null
      },
      create: {
        id: "default",
        wppBaseUrl: body.wppBaseUrl ?? env.WPP_BASE_URL,
        wppSession: body.wppSession ?? env.WPP_SESSION
      }
    });
  });

  app.post("/api/settings/wpp/refresh-token", async () => {
    try {
      const token = await wpp.refreshWppToken();
      return { ok: true, hasToken: Boolean(token) };
    } catch (e: any) {
      return { ok: false, message: e?.message ?? String(e) };
    }
  });

  app.get("/api/settings/wpp/status", async () => {
    try {
      const status = await wpp.checkConnection();
      if (prisma) {
        await prisma.appSettings.update({
          where: { id: "default" },
          data: { connectionStatus: JSON.stringify(status) }
        });
      }
      return { ok: true, status };
    } catch (e: any) {
      return { ok: false, message: e?.message ?? String(e) };
    }
  });

  app.post("/api/settings/wpp/start-session", async (req, reply) => {
    try {
      const body = (req.body ?? {}) as { waitQrCode?: boolean; force?: boolean };
      const raw = await wpp.startSession({
        waitQrCode: body.waitQrCode,
        force: body.force !== false
      });
      let state = wpp.extractSessionState(raw);
      let needsQr = wpp.sessionNeedsQr(state);
      let qrImage = wpp.extractQrImage(raw);
      let qrRaw: unknown = raw;

      const stable = wpp.isStablePhoneConnectionState(state);
      if (stable) {
        return {
          ok: true,
          state,
          needsQr: false,
          connected: true,
          qrImage: null,
          raw: { start: raw }
        };
      }

      if (!qrImage && !stable) {
        const waited = await wpp.waitForQrImageAfterStart();
        qrRaw = waited.raw;
        if (waited.state) state = waited.state;
        needsQr = wpp.sessionNeedsQr(state);
        if (waited.qrImage) qrImage = waited.qrImage;
        if (wpp.isStablePhoneConnectionState(state)) {
          return {
            ok: true,
            state,
            needsQr: false,
            connected: true,
            qrImage: null,
            raw: { start: raw, wait: waited.raw }
          };
        }
      }

      if (!qrImage && needsQr && !wpp.isWppConnectedState(state)) {
        return reply.status(200).send({
          ok: true,
          pendingQr: true,
          state,
          needsQr: true,
          connected: false,
          qrImage: null,
          message:
            "Sessão iniciada no WPP. O QR pode levar até ~30s para aparecer aqui — aguarde a atualização automática ou clique em Atualizar QR.",
          raw: { start: raw, qrcode: qrRaw }
        });
      }

      const connected =
        wpp.isStablePhoneConnectionState(state) ||
        (!needsQr && wpp.isWppConnectedState(state));
      const webhook =
        connected || wpp.isStablePhoneConnectionState(state)
          ? await wpp.registerInboundWebhook().catch((e: Error) => ({
              url: wpp.getInboundWebhookDiagnostics().webhookUrl,
              ok: false,
              detail: e.message
            }))
          : null;

      return {
        ok: true,
        state,
        needsQr,
        connected,
        qrImage,
        webhook,
        raw: { start: raw, qrcode: qrRaw }
      };
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      return reply.status(200).send({
        ok: false,
        message: wpp.mapWppErrorMessage(msg),
        browserLock: wpp.isWppBrowserLockError(msg)
      });
    }
  });

  app.get("/api/settings/wpp/qrcode", async () => {
    try {
      const { qrImage, raw } = await wpp.getQrCode();
      const session = await wpp.getSessionStatus().catch(() => null);
      return {
        ok: true,
        qrImage,
        state: session ? wpp.extractSessionState(session) : wpp.extractSessionState(raw),
        raw: { qrcode: raw, status: session }
      };
    } catch (e: any) {
      return { ok: false, message: e?.message ?? String(e) };
    }
  });

  app.get("/api/settings/wpp/session", async () => {
    try {
      const status = await wpp.getSessionStatus();
      const connection = await wpp.checkConnection().catch(() => null);
      return {
        ok: true,
        state: wpp.extractSessionState(status),
        status,
        connection
      };
    } catch (e: any) {
      return { ok: false, message: e?.message ?? String(e) };
    }
  });

  app.post("/api/settings/wpp/close-session", async () => {
    try {
      const result = await wpp.closeSession();
      if (result.noSession) {
        return {
          ok: true,
          noSession: true,
          state: "CLOSED",
          message: wpp.MSG_NO_SESSION_CLOSE
        };
      }
      return {
        ok: true,
        state: wpp.extractSessionState(result.raw),
        message:
          "Sessão fechada no WPP. O WhatsApp foi pausado; para usar de novo, clique em Conectar."
      };
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (wpp.isWppNetworkError(msg)) {
        return { ok: false, wppOffline: true, message: msg };
      }
      return { ok: false, message: msg.slice(0, 400) };
    }
  });

  app.post("/api/settings/wpp/logout-session", async () => {
    try {
      const result = await wpp.logoutSession();
      if (result.noSession) {
        return {
          ok: true,
          noSession: true,
          state: "LOGOUT",
          message: wpp.MSG_NO_SESSION_LOGOUT
        };
      }
      return {
        ok: true,
        state: wpp.extractSessionState(result.raw),
        message:
          "WhatsApp desconectado. Será necessário escanear o QR Code novamente para reconectar."
      };
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (wpp.isWppNetworkError(msg)) {
        return { ok: false, wppOffline: true, message: msg };
      }
      return { ok: false, message: msg.slice(0, 400) };
    }
  });

  app.get("/api/settings/wpp/webhook-status", async () => {
    const diag = wpp.getInboundWebhookDiagnostics();
    const lastAt = getLastWppWebhookAt();
    const lastEvent = getLastWppWebhookEvent();
    return {
      ok: true,
      ...diag,
      lastWebhookAt: lastAt,
      lastWebhookEvent: lastEvent,
      receivingOk: Boolean(lastAt),
      hint: diag.needsInternalUrl
        ? "Defina ZAP_INTERNAL_URL no serviço zap (rede Docker). Sem isso o WPP não entrega mensagens recebidas."
        : lastAt
          ? "O Zap já recebeu eventos do WPP. Envie uma mensagem de teste e confira lastWebhookAt."
          : "Após conectar, clique em Atualizar webhook e envie uma mensagem do celular. Se lastWebhookAt continuar vazio, o wppconnect não está alcançando o Zap."
    };
  });

  app.get("/api/settings/wpp/diagnostics", async () => {
    try {
      const report = await wpp.runWppDiagnostics();
      const allOk = report.steps.every((s) => s.ok);
      return { ok: allOk, ...report };
    } catch (e: any) {
      return { ok: false, message: e?.message ?? String(e) };
    }
  });

  app.get("/api/settings/wpp/verify", async () => {
    try {
      const result = await wpp.verifyActiveSession();
      if (prisma) {
        const cs = result.connected
          ? `CONNECTED:${result.state}`
          : result.ghostSession
            ? `DISCONNECTED:GHOST`
            : result.connecting || wpp.sessionNeedsQr(result.state ?? "")
              ? `AWAITING_QR:${result.state}`
              : `DISCONNECTED:${result.state}`;
        await prisma.appSettings.update({
          where: { id: "default" },
          data: { connectionStatus: cs }
        });
      }
      const payload = {
        ok: true,
        ...result,
        needsQr: wpp.sessionNeedsQr(result.state ?? "")
      };
      if (result.connected) {
        void wpp.registerInboundWebhook().catch(() => {});
      }
      return payload;
    } catch (e: any) {
      return {
        ok: true,
        connected: false,
        noSession: true,
        state: "ERRO",
        message: e?.message ?? String(e)
      };
    }
  });
}
