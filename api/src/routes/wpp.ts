import type { FastifyInstance } from "fastify";
import { prisma } from "../prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { defaultWhatsAppSession, env } from "../env.js";
import * as wpp from "../services/whatsapp/index.js";
import { resetInboxForSession } from "../services/inboxStore.js";
import { undismissSession } from "../utils/wppDismissed.js";
import {
  getBusinessConfigDto,
  saveBusinessConfig,
  type BusinessConfigInput,
  type WppIntegration
} from "../services/whatsapp/wppInstanceConfig.js";

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

async function listServerSessionNames(): Promise<{ sessions: string[]; error?: string }> {
  try {
    const raw = await wpp.listServerSessions();
    return { sessions: wpp.parseWppServerSessionNames(raw) };
  } catch (e: any) {
    return { sessions: [], error: e?.message ?? String(e) };
  }
}

export async function wppRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get("/api/wpp/groups", async (_req, reply) => {
    try {
      const groups = await wpp.listAllGroups();
      return { groups };
    } catch (e: any) {
      return reply.status(502).send({
        groups: [],
        error: e?.message ?? String(e)
      });
    }
  });

  app.get("/api/wpp/instances", async () => {
    if (!prisma) throw new Error("Banco indisponível");

    const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
    const active = settings?.wppSession ?? defaultWhatsAppSession();
    const instances = await prisma.wppInstance.findMany({ orderBy: { createdAt: "asc" } });
    const instanceNames = instances.map((i) => i.name);
    const keepNames = buildKeepSessionNames(instanceNames, active);

    const configs = await Promise.all(
      instances.map(async (i) => ({
        business: await getBusinessConfigDto(i.name)
      }))
    );

    const { sessions: serverSessions, error: serverError } = await listServerSessionNames();
    const orphanSessions = serverSessions.filter(
      (s) => !keepNames.map((k) => k.toLowerCase()).includes(s.toLowerCase())
    );

    let orphanCleanup: Awaited<ReturnType<typeof wpp.purgeOrphanWppSessions>> | null = null;
    if (env.WPP_AUTO_PURGE_ORPHANS && orphanSessions.length > 0) {
      orphanCleanup = await wpp.purgeOrphanWppSessions(keepNames);
      for (const n of orphanCleanup.purged) {
        await undismissSession(n);
        await resetInboxForSession(n);
      }
    }

    const afterList =
      orphanCleanup?.purged.length ? await listServerSessionNames() : { sessions: serverSessions };

    return {
      active,
      instances: instances.map((i, idx) => ({
        id: i.id,
        name: i.name,
        label: i.label,
        isActive: i.name === active,
        onServer: afterList.sessions.includes(i.name),
        integration: configs[idx]?.business.integration ?? "baileys",
        business: configs[idx]?.business
      })),
      serverSessions: afterList.sessions,
      keepNames,
      orphanSessions: afterList.sessions.filter(
        (s) => !keepNames.map((k) => k.toLowerCase()).includes(s.toLowerCase())
      ),
      serverError,
      orphanCleanup
    };
  });

  app.post("/api/wpp/instances", async (req, reply) => {
    if (!prisma) return reply.status(503).send({ error: "Banco indisponível" });

    const body = req.body as {
      name?: string;
      label?: string;
      connect?: boolean;
      integration?: WppIntegration;
    };
    const name = (body.name ?? "").trim().toLowerCase();
    if (!name) return reply.status(400).send({ error: "Nome da instância obrigatório" });

    if (!/^[\w-]{2,64}$/i.test(name)) {
      return reply.status(400).send({ error: "Nome inválido (letras, números, _ ou -)" });
    }

    await undismissSession(name);

    const instance = await prisma.wppInstance.upsert({
      where: { name },
      update: {
        label: body.label ?? name,
        ...(body.integration ? { integration: body.integration } : {})
      },
      create: {
        name,
        label: body.label ?? name,
        integration: body.integration === "business" ? "business" : "baileys"
      }
    });

    await wpp.setActiveSession(name);
    await wpp.refreshWppToken(name);

    let connectResult: unknown = null;
    const cfg = await getBusinessConfigDto(name);
    if (body.connect !== false && cfg.integration !== "business") {
      try {
        connectResult = await wpp.startSession();
      } catch {
        /* QR pode ser obtido depois */
      }
    } else if (cfg.integration === "business" && cfg.hasMetaAccessToken) {
      try {
        connectResult = await wpp.startSession();
      } catch {
        /* credenciais incompletas */
      }
    }

    return {
      ok: true,
      instance,
      active: name,
      connect: connectResult
    };
  });

  app.get("/api/wpp/instances/:name/business", async (req, reply) => {
    if (!prisma) return reply.status(503).send({ error: "Banco indisponível" });
    const name = (req.params as { name: string }).name.trim().toLowerCase();
    const exists = await prisma.wppInstance.findUnique({ where: { name } });
    if (!exists) return reply.status(404).send({ error: "Instância não encontrada" });
    return getBusinessConfigDto(name);
  });

  app.put("/api/wpp/instances/:name/business", async (req, reply) => {
    if (!prisma) return reply.status(503).send({ error: "Banco indisponível" });
    const name = (req.params as { name: string }).name.trim().toLowerCase();
    const exists = await prisma.wppInstance.findUnique({ where: { name } });
    if (!exists) return reply.status(404).send({ error: "Instância não encontrada" });

    const body = req.body as Partial<BusinessConfigInput> & { integration?: WppIntegration };

    try {
      const dto = await saveBusinessConfig(name, body);
      if (dto.integration === "business" && dto.hasMetaAccessToken) {
        await wpp.setActiveSession(name);
        await wpp.refreshWppToken(name).catch(() => {});
        await wpp.startSession().catch(() => {});
      }
      return { ok: true, ...dto };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return reply.status(400).send({ error: message });
    }
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

  app.post("/api/wpp/purge-server/:name", async (req, reply) => {
    const name = (req.params as { name: string }).name.trim().toLowerCase();
    if (!name) return reply.status(400).send({ error: "Nome obrigatório" });

    const purge = await wpp.purgeWppSessionFromServer(name);
    if (purge.ok) {
      await resetInboxForSession(name);
      await undismissSession(name);
    }

    return {
      ok: purge.ok,
      purge,
      message: purge.ok
        ? `Sessão "${name}" removida do servidor WPP.`
        : `Não foi possível remover "${name}": ${purge.detail}`
    };
  });

  app.post("/api/wpp/cleanup-orphans", async (_req, reply) => {
    if (!prisma) return reply.status(503).send({ error: "Banco indisponível" });

    const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
    const active = settings?.wppSession ?? defaultWhatsAppSession();
    const instances = await prisma.wppInstance.findMany();
    const keepNames = buildKeepSessionNames(
      instances.map((i) => i.name),
      active
    );

    const before = await listServerSessionNames();
    if (before.error) {
      return reply.status(502).send({
        ok: false,
        error: before.error,
        message: `Não foi possível listar sessões no WPP: ${before.error}`
      });
    }

    const targets = before.sessions.filter(
      (s) => !keepNames.map((k) => k.toLowerCase()).includes(s.toLowerCase())
    );

    if (targets.length === 0) {
      return {
        ok: true,
        purged: [],
        failed: [],
        keepNames,
        serverSessions: before.sessions,
        message:
          before.sessions.length === 0
            ? "Nenhuma sessão no servidor WPP (lista vazia)."
            : `Nada a limpar: todas as ${before.sessions.length} sessão(ões) no servidor estão cadastradas no painel (${keepNames.join(", ")}). Remova a instância no painel primeiro se quiser apagá-la no WPP.`
      };
    }

    try {
      const result = await wpp.purgeOrphanWppSessions(keepNames);
      for (const n of result.purged) {
        await undismissSession(n);
        await resetInboxForSession(n);
      }

      const after = await listServerSessionNames();

      return {
        ok: result.failed.length === 0,
        ...result,
        keepNames,
        targets,
        serverSessionsBefore: before.sessions,
        serverSessionsAfter: after.sessions,
        serverError: after.error,
        message:
          result.purged.length > 0
            ? `Removidas do servidor WPP: ${result.purged.join(", ")}`
            : result.failed.length > 0
              ? `Falha ao remover: ${result.failed.map((f) => `${f.name} (${f.error})`).join("; ")}`
              : "Nenhuma sessão removida."
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
