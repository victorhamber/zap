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
}
