import type { FastifyInstance } from "fastify";
import { prisma } from "../prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { env } from "../env.js";
import * as wpp from "../services/wppconnect.js";
import { resetInboxForSession } from "../services/inboxStore.js";
import { undismissSession } from "../utils/wppDismissed.js";

function buildKeepSessionNames(
  instanceNames: string[],
  activeSession: string
): string[] {
  const names = new Set<string>();
  for (const n of instanceNames) {
    const t = n.trim().toLowerCase();
    if (t) names.add(t);
  }
  const active = activeSession.trim().toLowerCase();
  if (active) names.add(active);
  return [...names];
}

async function syncOrphanSessionsOnServer(keepNames: string[]): Promise<{
  purged: string[];
  failed: Array<{ name: string; error: string }>;
} | null> {
  if (!env.WPP_AUTO_PURGE_ORPHANS) return null;
  return wpp.purgeOrphanWppSessions(keepNames);
}

export async function wppRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get("/api/wpp/instances", async () => {
    if (!prisma) throw new Error("Banco indisponível");

    const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
    const active = settings?.wppSession ?? env.WPP_SESSION;
    const instances = await prisma.wppInstance.findMany({ orderBy: { createdAt: "asc" } });
    const instanceNames = instances.map((i) => i.name);
    const keepNames = buildKeepSessionNames(instanceNames, active);

    let orphanCleanup: { purged: string[]; failed: Array<{ name: string; error: string }> } | null =
      null;
    try {
      orphanCleanup = await syncOrphanSessionsOnServer(keepNames);
      if (orphanCleanup?.purged.length) {
        for (const n of orphanCleanup.purged) {
          await undismissSession(n);
          await resetInboxForSession(n);
        }
      }
    } catch {
      /* WPP offline */
    }

    let serverSessions: string[] = [];
    try {
      const raw = await wpp.listServerSessions();
      serverSessions = wpp.parseWppServerSessionNames(raw);
    } catch {
      /* servidor pode estar offline */
    }

    return {
      active,
      instances: instances.map((i) => ({
        id: i.id,
        name: i.name,
        label: i.label,
        isActive: i.name === active,
        onServer: serverSessions.includes(i.name)
      })),
      serverSessions,
      orphanCleanup
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
    const name = (req.params as { name: string }).name.trim().toLowerCase();

    const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
    const wasActive = settings?.wppSession === name;

    const purge = await wpp.purgeWppSessionFromServer(name);
    await resetInboxForSession(name);
    await undismissSession(name);

    await prisma.wppInstance.deleteMany({ where: { name } });

    const remaining = await prisma.wppInstance.findFirst({ orderBy: { createdAt: "asc" } });
    if (remaining && wasActive) {
      await wpp.setActiveSession(remaining.name);
      await wpp.refreshWppToken(remaining.name).catch(() => {});
    }

    const message = purge.ok
      ? `Instância "${name}" removida do painel e do servidor WPP.`
      : `Instância "${name}" removida do painel. Não foi possível limpar no WPP: ${purge.detail}`;

    return {
      ok: true,
      purge,
      message,
      warning: purge.ok ? undefined : purge.detail
    };
  });

  app.post("/api/wpp/cleanup-orphans", async (_req, reply) => {
    if (!prisma) return reply.status(503).send({ error: "Banco indisponível" });

    const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
    const active = settings?.wppSession ?? env.WPP_SESSION;
    const instances = await prisma.wppInstance.findMany();
    const keepNames = buildKeepSessionNames(
      instances.map((i) => i.name),
      active
    );

    try {
      const result = await wpp.purgeOrphanWppSessions(keepNames);
      for (const n of result.purged) {
        await undismissSession(n);
        await resetInboxForSession(n);
      }
      return {
        ok: result.failed.length === 0,
        ...result,
        message:
          result.purged.length > 0
            ? `Removidas do servidor WPP: ${result.purged.join(", ")}`
            : result.failed.length > 0
              ? "Nenhuma sessão removida — veja os erros."
              : "Nenhuma sessão órfã no servidor WPP."
      };
    } catch (e: any) {
      return reply.status(502).send({ ok: false, error: e?.message ?? String(e) });
    }
  });

  app.post("/api/wpp/sync-webhook", async (_req, reply) => {
    try {
      const result = await wpp.registerInboundWebhook();
      if (!result.ok) {
        return reply.status(502).send(result);
      }
      return result;
    } catch (e: any) {
      return reply.status(502).send({ ok: false, error: e?.message ?? String(e) });
    }
  });

  app.post("/api/wpp/call", async (req, reply) => {
    const body = req.body as { path?: string; method?: string; payload?: unknown };
    const path = body.path ?? "";
    const method = (body.method ?? "GET").toUpperCase() as "GET" | "POST" | "PUT" | "DELETE";

    if (!["GET", "POST", "PUT", "DELETE"].includes(method)) {
      return reply.status(400).send({ error: "Método inválido" });
    }

    const safePath = path.split("?")[0];
    const allowedOffline = ["/check-connection-session", "/status-session", "/qrcode-session"];
    const needsLiveSession = !allowedOffline.some((p) => safePath === p || safePath.endsWith(p));

    if (needsLiveSession) {
      const check = await wpp.verifyActiveSession();
      if (!check.connected) {
        return reply.status(503).send({
          ok: false,
          error: check.message ?? wpp.MSG_NO_DEVICE,
          browserLock: check.browserLock === true,
          needsQr: true
        });
      }
    }

    try {
      const data = await wpp.callSessionApi(path, method, body.payload);
      return { ok: true, data };
    } catch (e: any) {
      const msg = wpp.mapWppErrorMessage(e?.message ?? String(e));
      return reply.status(502).send({ ok: false, error: msg });
    }
  });
}
