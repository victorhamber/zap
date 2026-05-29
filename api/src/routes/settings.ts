import type { FastifyInstance } from "fastify";
import { prisma } from "../prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { env } from "../env.js";
import * as wpp from "../services/wppconnect.js";

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
      const state = wpp.extractSessionState(raw);
      const needsQr = wpp.sessionNeedsQr(state);
      let qrImage = wpp.extractQrImage(raw);
      let qrRaw: unknown = raw;

      if (!qrImage) {
        qrImage = await wpp.fetchQrFromSessionStatus();
      }
      if (!qrImage) {
        await new Promise((r) => setTimeout(r, needsQr ? 2500 : 1500));
        const qr = await wpp.getQrCode().catch(() => ({ qrImage: null, raw: null }));
        qrImage = qr.qrImage;
        qrRaw = qr.raw;
      }
      if (!qrImage && needsQr) {
        await new Promise((r) => setTimeout(r, 2000));
        qrImage = await wpp.fetchQrFromSessionStatus();
        if (!qrImage) {
          const qr2 = await wpp.getQrCode().catch(() => ({ qrImage: null, raw: null }));
          qrImage = qr2.qrImage;
          qrRaw = qr2.raw;
        }
      }

      if (!qrImage && needsQr && !wpp.isWppConnectedState(state)) {
        return reply.status(200).send({
          ok: false,
          state,
          needsQr: true,
          connected: false,
          qrImage: null,
          wppConfigRequired: true,
          message: wpp.MSG_WPP_NO_QR,
          raw: { start: raw, qrcode: qrRaw }
        });
      }

      return {
        ok: true,
        state,
        needsQr,
        connected: !needsQr && wpp.isWppConnectedState(state),
        qrImage,
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
