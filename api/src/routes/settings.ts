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
    const token = await wpp.refreshWppToken();
    return { ok: true, hasToken: Boolean(token) };
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
      return { ok: false, error: e?.message ?? String(e) };
    }
  });

  app.post("/api/settings/wpp/start-session", async (_req, reply) => {
    try {
      const raw = await wpp.startSession();
      let qrFromStart = wpp.extractQrImage(raw);
      let qrRaw: unknown = raw;

      if (!qrFromStart) {
        await new Promise((r) => setTimeout(r, 2000));
        const qr = await wpp.getQrCode();
        qrFromStart = qr.qrImage;
        qrRaw = qr.raw;
      }

      return {
        ok: true,
        state: wpp.extractSessionState(raw),
        qrImage: qrFromStart,
        raw: { start: raw, qrcode: qrRaw }
      };
    } catch (e: any) {
      return reply.status(502).send({ ok: false, error: e?.message ?? String(e) });
    }
  });

  app.get("/api/settings/wpp/qrcode", async (_req, reply) => {
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
      return reply.status(502).send({ ok: false, error: e?.message ?? String(e) });
    }
  });

  app.get("/api/settings/wpp/session", async (_req, reply) => {
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
      return reply.status(502).send({ ok: false, error: e?.message ?? String(e) });
    }
  });

  app.post("/api/settings/wpp/close-session", async (_req, reply) => {
    try {
      const raw = await wpp.closeSession();
      return {
        ok: true,
        state: wpp.extractSessionState(raw),
        message: "Sessão fechada no WPP. O WhatsApp foi pausado; para usar de novo, clique em Conectar."
      };
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (/502|bad gateway|ECONNREFUSED|fetch failed/i.test(msg)) {
        return reply.status(502).send({
          ok: false,
          error:
            "Não foi possível falar com o servidor WPP. Confira WPP_INTERNAL_URL no EasyPanel ou se o WPP está online."
        });
      }
      return reply.status(502).send({ ok: false, error: msg.slice(0, 300) });
    }
  });

  app.post("/api/settings/wpp/logout-session", async (_req, reply) => {
    try {
      const raw = await wpp.logoutSession();
      return {
        ok: true,
        state: wpp.extractSessionState(raw),
        message:
          "WhatsApp desconectado. Será necessário escanear o QR Code novamente para reconectar."
      };
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      if (/502|bad gateway|ECONNREFUSED|fetch failed/i.test(msg)) {
        return reply.status(502).send({
          ok: false,
          error:
            "Não foi possível falar com o servidor WPP. Confira WPP_INTERNAL_URL no EasyPanel ou se o WPP está online."
        });
      }
      return reply.status(502).send({ ok: false, error: msg.slice(0, 300) });
    }
  });

  app.get("/api/settings/wpp/diagnostics", async (_req, reply) => {
    try {
      const report = await wpp.runWppDiagnostics();
      const allOk = report.steps.every((s) => s.ok);
      return { ok: allOk, ...report };
    } catch (e: any) {
      return reply.status(502).send({ ok: false, error: e?.message ?? String(e) });
    }
  });

  app.get("/api/settings/wpp/verify", async (_req, reply) => {
    try {
      const result = await wpp.verifyActiveSession();
      if (prisma) {
        await prisma.appSettings.update({
          where: { id: "default" },
          data: {
            connectionStatus: result.connected
              ? `CONNECTED:${result.state}`
              : `DISCONNECTED:${result.state}`
          }
        });
      }
      return { ok: true, ...result };
    } catch (e: any) {
      return reply.status(502).send({ ok: false, error: e?.message ?? String(e) });
    }
  });
}
