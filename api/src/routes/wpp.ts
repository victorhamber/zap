import type { FastifyInstance } from "fastify";
import { prisma } from "../prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { env } from "../env.js";
import * as wpp from "../services/wppconnect.js";
import { dismissSession, getDismissedSessions, undismissSession } from "../utils/wppDismissed.js";

function parseSessionNames(serverPayload: unknown): string[] {
  if (!serverPayload) return [];
  if (Array.isArray(serverPayload)) {
    return serverPayload.map((x) => String(x));
  }
  if (typeof serverPayload === "object") {
    const o = serverPayload as Record<string, unknown>;
    if (Array.isArray(o.response)) return o.response.map((x) => String(x));
    if (Array.isArray(o.sessions)) return o.sessions.map((x) => String(x));
    if (o.response && typeof o.response === "object") {
      return Object.keys(o.response as object);
    }
  }
  return [];
}

export async function wppRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get("/api/wpp/instances", async () => {
    if (!prisma) throw new Error("Banco indisponível");

    const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
    const active = settings?.wppSession ?? env.WPP_SESSION;
    const instances = await prisma.wppInstance.findMany({ orderBy: { createdAt: "asc" } });

    let serverSessions: string[] = [];
    try {
      const raw = await wpp.listServerSessions();
      serverSessions = parseSessionNames(raw);
    } catch {
      /* servidor pode estar offline */
    }

    const dismissed = await getDismissedSessions();
    serverSessions = serverSessions.filter((s) => !dismissed.includes(s.toLowerCase()));

    return {
      active,
      instances: instances.map((i) => ({
        id: i.id,
        name: i.name,
        label: i.label,
        isActive: i.name === active,
        onServer: serverSessions.includes(i.name)
      })),
      serverSessions
    };
  });

  app.post("/api/wpp/instances", async (req, reply) => {
    if (!prisma) return reply.status(503).send({ error: "Banco indisponível" });

    const body = req.body as { name?: string; label?: string; connect?: boolean };
    const name = (body.name ?? "").trim().toLowerCase();
    if (!name) return reply.status(400).send({ error: "Nome da instância obrigatório" });

    if (!/^[\w-]{2,64}$/i.test(name)) {
      return reply.status(400).send({ error: "Nome inválido (letras, números, _ ou -)" });
    }

    await undismissSession(name);

    const instance = await prisma.wppInstance.upsert({
      where: { name },
      update: { label: body.label ?? name },
      create: { name, label: body.label ?? name }
    });

    await wpp.setActiveSession(name);
    await wpp.refreshWppToken(name);

    let connectResult: unknown = null;
    if (body.connect !== false) {
      try {
        connectResult = await wpp.startSession();
      } catch {
        /* QR pode ser obtido depois */
      }
    }

    return {
      ok: true,
      instance,
      active: name,
      connect: connectResult
    };
  });

  app.post("/api/wpp/instances/:name/activate", async (req, reply) => {
    if (!prisma) return reply.status(503).send({ error: "Banco indisponível" });
    const name = (req.params as { name: string }).name;

    const exists = await prisma.wppInstance.findUnique({ where: { name } });
    if (!exists) {
      await prisma.wppInstance.create({ data: { name, label: name } });
    }

    await wpp.setActiveSession(name);
    await wpp.refreshWppToken(name);

    return { ok: true, active: name };
  });

  app.delete("/api/wpp/instances/:name", async (req, reply) => {
    if (!prisma) return reply.status(503).send({ error: "Banco indisponível" });
    const name = (req.params as { name: string }).name;

    const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
    if (settings?.wppSession === name) {
      try {
        await wpp.closeSession();
      } catch {
        /* ignora */
      }
    }

    await prisma.wppInstance.deleteMany({ where: { name } });
    await dismissSession(name);

    const remaining = await prisma.wppInstance.findFirst({ orderBy: { createdAt: "asc" } });
    if (remaining && settings?.wppSession === name) {
      await wpp.setActiveSession(remaining.name);
      await wpp.refreshWppToken(remaining.name).catch(() => {});
    }

    return { ok: true, message: `Instância "${name}" removida do painel. A sessão pode continuar no servidor WPP.` };
  });

  app.post("/api/wpp/call", async (req, reply) => {
    const body = req.body as { path?: string; method?: string; payload?: unknown };
    const path = body.path ?? "";
    const method = (body.method ?? "GET").toUpperCase() as "GET" | "POST" | "PUT" | "DELETE";

    if (!["GET", "POST", "PUT", "DELETE"].includes(method)) {
      return reply.status(400).send({ error: "Método inválido" });
    }

    try {
      const data = await wpp.callSessionApi(path, method, body.payload);
      return { ok: true, data };
    } catch (e: any) {
      return reply.status(502).send({ ok: false, error: e?.message ?? String(e) });
    }
  });
}
