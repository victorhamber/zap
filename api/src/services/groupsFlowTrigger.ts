import { prisma } from "../prisma.js";
import { parseGraph } from "../engine/graph.js";
import { queueFlowRunStart } from "./flowDispatch.js";
import type { TriggerGroupsData } from "../types/flow.js";

function normalizeGroupId(raw: string): string | null {
  const id = String(raw ?? "").trim();
  if (!id) return null;
  if (id.includes("@g.us") || id.includes("@newsletter")) return id;
  const digits = id.replace(/\D/g, "");
  return digits ? `${digits}@g.us` : null;
}

function readTriggerGroupsData(data: Record<string, unknown>): TriggerGroupsData {
  return {
    groupIds: Array.isArray(data.groupIds)
      ? data.groupIds.map((x) => String(x)).filter(Boolean)
      : [],
    groupLabels:
      data.groupLabels && typeof data.groupLabels === "object"
        ? (data.groupLabels as Record<string, string>)
        : {}
  };
}

export function getTriggerGroupsFromFlow(graphJson: unknown): TriggerGroupsData | null {
  try {
    const graph = parseGraph(graphJson);
    const trigger = graph.nodes.find((n) => n.type === "trigger_groups");
    if (!trigger) return null;
    return readTriggerGroupsData(trigger.data ?? {});
  } catch {
    return null;
  }
}

/**
 * Inicia o fluxo uma vez por grupo selecionado no gatilho.
 * Cada run carrega isGroup=true para que send_text/imagem/etc. enviem ao grupo.
 */
export async function dispatchGroupsFlow(
  flowId: string,
  opts?: { slotKey?: string; reason?: string }
): Promise<{ scheduled: number; skipped: number; total: number }> {
  if (!prisma) throw new Error("Banco indisponível");

  const flow = await prisma.flow.findUnique({ where: { id: flowId } });
  if (!flow?.enabled) throw new Error("Fluxo não encontrado ou inativo");

  const data = getTriggerGroupsFromFlow(flow.graphJson);
  if (!data) throw new Error("Este fluxo não tem gatilho de Grupos");

  const groupIds = [...new Set(data.groupIds.map(normalizeGroupId).filter(Boolean) as string[])];
  if (groupIds.length === 0) {
    throw new Error("Selecione ao menos um grupo no gatilho");
  }

  const batchId = opts?.slotKey ?? String(Date.now());
  const reason = opts?.reason ?? "manual";
  let scheduled = 0;
  let skipped = 0;

  for (const groupId of groupIds) {
    const label = data.groupLabels?.[groupId] || groupId.replace(/@.*/, "");
    const externalId = `groups_${flowId}_${batchId}_${groupId}`.slice(0, 190);

    try {
      const result = await queueFlowRunStart({
        flowId,
        triggerType: "trigger_groups",
        contactPhone: groupId.slice(0, 64),
        variables: {
          phone: groupId,
          isGroup: true,
          groupId,
          groupName: label,
          name: label,
          fullName: label,
          email: "",
          purchaseId: `groups_${batchId}`,
          reason
        },
        externalId
      });

      if (result && "skipped" in result && result.skipped) {
        skipped++;
      } else if (
        result &&
        (("runId" in result && result.runId) || ("queued" in result && result.queued))
      ) {
        scheduled++;
      } else {
        skipped++;
      }
    } catch (err) {
      skipped++;
      console.warn(
        `[groups-trigger] falha flow=${flowId} group=${groupId}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  console.log(
    `[groups-trigger] flow=${flowId} reason=${reason} slot=${batchId} scheduled=${scheduled} skipped=${skipped} total=${groupIds.length}`
  );

  return { scheduled, skipped, total: groupIds.length };
}

/** Há execução ativa (rodando ou aguardando delay/dia) deste fluxo de grupos? */
export async function countActiveGroupsRuns(flowId: string): Promise<number> {
  if (!prisma) return 0;
  return prisma.flowRun.count({
    where: {
      flowId,
      triggerType: "trigger_groups",
      status: { in: ["running", "waiting"] }
    }
  });
}

/**
 * Garante que o fluxo de grupos está em execução.
 * Usado ao publicar e ao terminar um ciclo (se o fluxo continuar habilitado).
 */
export async function ensureGroupsFlowRunning(
  flowId: string,
  reason = "auto"
): Promise<{
  started: boolean;
  scheduled?: number;
  skipped?: number;
  total?: number;
  reason?: string;
}> {
  if (!prisma) throw new Error("Banco indisponível");

  const flow = await prisma.flow.findUnique({ where: { id: flowId } });
  if (!flow?.enabled) {
    return { started: false, reason: "disabled" };
  }
  if (!getTriggerGroupsFromFlow(flow.graphJson)) {
    return { started: false, reason: "no_trigger" };
  }

  const active = await countActiveGroupsRuns(flowId);
  if (active > 0) {
    return { started: false, reason: "already_active" };
  }

  const result = await dispatchGroupsFlow(flowId, {
    reason,
    slotKey: `auto_${Date.now()}`
  });
  return {
    started: result.scheduled > 0,
    scheduled: result.scheduled,
    skipped: result.skipped,
    total: result.total
  };
}

/** Fluxo com nós de espera no tempo (semana programada) — pode reiniciar o ciclo. */
export function groupsFlowHasScheduleNodes(graphJson: unknown): boolean {
  try {
    const graph = parseGraph(graphJson);
    return graph.nodes.some(
      (n) => n.type === "wait_weekday" || n.type === "delay" || n.type === "schedule_at"
    );
  } catch {
    return false;
  }
}

/** Cancela runs ativos e dispara de novo (botão Reiniciar). */
export async function restartGroupsFlow(
  flowId: string
): Promise<{ scheduled: number; skipped: number; total: number; cancelled: number }> {
  if (!prisma) throw new Error("Banco indisponível");

  const active = await prisma.flowRun.findMany({
    where: {
      flowId,
      triggerType: "trigger_groups",
      status: { in: ["running", "waiting"] }
    },
    select: { id: true }
  });

  if (active.length > 0) {
    const ids = active.map((r) => r.id);
    await prisma.scheduledJob.updateMany({
      where: { flowRunId: { in: ids }, status: { in: ["pending", "processing"] } },
      data: { status: "done" }
    });
    await prisma.flowRun.updateMany({
      where: { id: { in: ids } },
      data: { status: "cancelled", currentNodeId: null, errorMessage: "Reiniciado manualmente" }
    });
  }

  const result = await dispatchGroupsFlow(flowId, {
    reason: "manual_restart",
    slotKey: `restart_${Date.now()}`
  });
  return { ...result, cancelled: active.length };
}
