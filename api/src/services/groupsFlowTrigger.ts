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
