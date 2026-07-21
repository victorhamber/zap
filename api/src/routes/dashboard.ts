import type { FastifyInstance } from "fastify";
import { prisma } from "../prisma.js";
import { requireAuth } from "../middleware/auth.js";

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysAgo(n: number): Date {
  const d = startOfToday();
  d.setDate(d.getDate() - n);
  return d;
}

/**
 * Chave YYYY-MM-DD no fuso do servidor. Usar toISOString() aqui jogaria os
 * eventos da noite (UTC-3) para o dia seguinte, fora do intervalo consultado.
 */
function localDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function last7DayKeys(): string[] {
  const keys: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = startOfToday();
    d.setDate(d.getDate() - i);
    keys.push(localDayKey(d));
  }
  return keys;
}

function bucketByDay(items: { at: Date }[]): { date: string; count: number }[] {
  const keys = last7DayKeys();
  const map = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const item of items) {
    const key = localDayKey(item.at);
    if (key in map) map[key]++;
  }
  return keys.map((date) => ({ date, count: map[date] ?? 0 }));
}

export async function dashboardRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireAuth);

  app.get("/api/dashboard/stats", async () => {
    if (!prisma) {
      return {
        flows: { total: 0, active: 0, inactive: 0 },
        contacts: 0,
        tags: 0,
        runs: {
          total: 0,
          today: 0,
          last7Days: 0,
          byStatus: [],
          byTrigger: [],
          daily: last7DayKeys().map((date) => ({ date, count: 0 }))
        },
        messages: {
          sentToday: 0,
          receivedToday: 0,
          sentLast7Days: 0,
          dailySent: last7DayKeys().map((date) => ({ date, count: 0 }))
        },
        scheduled: { pending: 0 },
        topFlows: []
      };
    }

    const today = startOfToday();
    const weekStart = daysAgo(6);

    const [
      flowTotal,
      flowActive,
      contacts,
      tags,
      runsTotal,
      runsToday,
      runsWeek,
      statusGroups,
      triggerGroups,
      weekRuns,
      weekMessages,
      messagesSentToday,
      messagesReceivedToday,
      scheduledPending,
      topFlowGroups,
      allFlows
    ] = await Promise.all([
      prisma.flow.count(),
      prisma.flow.count({ where: { enabled: true } }),
      prisma.contact.count(),
      prisma.tag.count(),
      prisma.flowRun.count(),
      prisma.flowRun.count({ where: { createdAt: { gte: today } } }),
      prisma.flowRun.count({ where: { createdAt: { gte: weekStart } } }),
      prisma.flowRun.groupBy({ by: ["status"], _count: { _all: true } }),
      prisma.flowRun.groupBy({ by: ["triggerType"], _count: { _all: true } }),
      prisma.flowRun.findMany({
        where: { createdAt: { gte: weekStart } },
        select: { createdAt: true }
      }),
      // só as enviadas: é o único recorte usado no gráfico e evita puxar
      // todo o inbox recebido da semana para a memória do processo
      prisma.inboxMessage.findMany({
        where: { fromMe: true, timestamp: { gte: weekStart } },
        select: { timestamp: true }
      }),
      prisma.inboxMessage.count({ where: { fromMe: true, timestamp: { gte: today } } }),
      prisma.inboxMessage.count({ where: { fromMe: false, timestamp: { gte: today } } }),
      prisma.scheduledJob.count({ where: { status: "pending" } }),
      prisma.flowRun.groupBy({
        by: ["flowId"],
        _count: { _all: true },
        orderBy: { _count: { flowId: "desc" } },
        take: 5
      }),
      prisma.flow.findMany({ select: { id: true, name: true, enabled: true } })
    ]);

    const flowMap = new Map(allFlows.map((f) => [f.id, f]));

    return {
      flows: {
        total: flowTotal,
        active: flowActive,
        inactive: flowTotal - flowActive
      },
      contacts,
      tags,
      runs: {
        total: runsTotal,
        today: runsToday,
        last7Days: runsWeek,
        byStatus: statusGroups.map((g) => ({
          status: g.status,
          count: g._count._all
        })),
        byTrigger: triggerGroups.map((g) => ({
          trigger: g.triggerType,
          count: g._count._all
        })),
        daily: bucketByDay(weekRuns.map((r) => ({ at: r.createdAt })))
      },
      messages: {
        sentToday: messagesSentToday,
        receivedToday: messagesReceivedToday,
        sentLast7Days: weekMessages.length,
        dailySent: bucketByDay(weekMessages.map((m) => ({ at: m.timestamp })))
      },
      scheduled: { pending: scheduledPending },
      topFlows: topFlowGroups.map((g) => {
        const flow = flowMap.get(g.flowId);
        return {
          flowId: g.flowId,
          name: flow?.name ?? "Fluxo removido",
          enabled: flow?.enabled ?? false,
          count: g._count._all
        };
      })
    };
  });
}
