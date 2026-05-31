import { prisma } from "../prisma.js";
import { startFlowRun } from "../engine/executor.js";
import { parseGraph } from "../engine/graph.js";
import type { FlowGraph, TriggerTagData } from "../types/flow.js";

export function matchTagTrigger(graph: FlowGraph, addedTagNames: string[]): boolean {
  const trigger = graph.nodes.find((n) => n.type === "trigger_tag");
  if (!trigger) return false;
  const data = trigger.data as unknown as TriggerTagData;
  const required = (data.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (required.length === 0) return false;
  const added = addedTagNames.map((t) => t.trim().toLowerCase()).filter(Boolean);
  return required.some((tag) => added.includes(tag));
}

export async function dispatchTagTriggerFlows(params: {
  phone: string;
  addedTagNames: string[];
  contactName?: string;
}): Promise<string[]> {
  if (!prisma || params.addedTagNames.length === 0) return [];

  const flows = await prisma.flow.findMany({ where: { enabled: true } });
  const started: string[] = [];

  for (const flow of flows) {
    const graph = parseGraph(flow.graphJson);
    if (!matchTagTrigger(graph, params.addedTagNames)) continue;

    try {
      const result = await startFlowRun({
        flowId: flow.id,
        triggerType: "trigger_tag",
        contactPhone: params.phone,
        variables: {
          phone: params.phone,
          name: params.contactName ?? "Contato",
          purchaseId: `tag_${Date.now()}_${flow.id}`
        },
        externalId: `tag_${params.phone}_${Date.now()}_${flow.id}`
      });
      if (result && "runId" in result && result.runId) started.push(result.runId);
    } catch {
      /* não bloqueia atribuição de tag */
    }
  }

  return started;
}
