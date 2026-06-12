import { prisma } from "../prisma.js";
import { startFlowRun } from "../engine/executor.js";
import { parseGraph } from "../engine/graph.js";
import { enqueueFlowRunStart } from "../queue.js";
import type { FlowGraph, TriggerTagData } from "../types/flow.js";
import { getTagTriggerStaggerConfig, reserveStaggeredStartDelay } from "./flowStagger.js";

export function matchTagTrigger(graph: FlowGraph, addedTagNames: string[]): boolean {
  const trigger = graph.nodes.find((n) => n.type === "trigger_tag");
  if (!trigger) return false;
  const data = trigger.data as unknown as TriggerTagData;
  const required = (data.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (required.length === 0) return false;
  const added = addedTagNames.map((t) => t.trim().toLowerCase()).filter(Boolean);
  return required.some((tag) => added.includes(tag));
}

async function startOrScheduleTagFlow(
  flowId: string,
  graph: FlowGraph,
  params: {
    contactPhone: string;
    contactName?: string;
    externalId: string;
  }
): Promise<string | null> {
  const stagger = getTagTriggerStaggerConfig(graph);
  const runParams = {
    flowId,
    triggerType: "trigger_tag" as const,
    contactPhone: params.contactPhone,
    variables: {
      phone: params.contactPhone,
      name: params.contactName ?? "Contato",
      purchaseId: `tag_${Date.now()}_${flowId}`
    },
    externalId: params.externalId
  };

  if (!stagger.enabled) {
    const result = await startFlowRun(runParams);
    return result && "runId" in result && result.runId ? result.runId : null;
  }

  const delayMs = await reserveStaggeredStartDelay(flowId, stagger.minSec, stagger.maxSec);
  const jobId = `tagstart_${flowId}_${params.contactPhone}_${Date.now()}`;
  await enqueueFlowRunStart(runParams, delayMs, jobId);
  return `scheduled_${delayMs}ms`;
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
      const runId = await startOrScheduleTagFlow(flow.id, graph, {
        contactPhone: params.phone,
        contactName: params.contactName,
        externalId: `tag_${params.phone}_${Date.now()}_${flow.id}`
      });
      if (runId) started.push(runId);
    } catch {
      /* não bloqueia atribuição de tag */
    }
  }

  return started;
}

/** Dispara fluxo com gatilho tag para todos os contatos que já possuem a tag (cadência humanizada). */
export async function dispatchTagFlowToContactsWithTag(
  flowId: string,
  tagName: string
): Promise<{ scheduled: number; skipped: number }> {
  if (!prisma) throw new Error("Banco indisponível");

  const flow = await prisma.flow.findUnique({ where: { id: flowId } });
  if (!flow?.enabled) throw new Error("Fluxo não encontrado ou inativo");

  const graph = parseGraph(flow.graphJson);
  const trigger = graph.nodes.find((n) => n.type === "trigger_tag");
  if (!trigger) throw new Error("Este fluxo não tem gatilho por tag");

  const normalizedTag = tagName.trim().toLowerCase();
  const triggerTags = ((trigger.data as TriggerTagData).tags ?? []).map((t) =>
    t.trim().toLowerCase()
  );
  if (!triggerTags.includes(normalizedTag)) {
    throw new Error(`A tag "${tagName}" não está configurada neste gatilho`);
  }

  const tag = await prisma.tag.findFirst({
    where: { name: { equals: tagName, mode: "insensitive" } }
  });
  if (!tag) throw new Error("Tag não encontrada");

  const links = await prisma.contactTag.findMany({
    where: { tagId: tag.id },
    include: { contact: true }
  });

  let scheduled = 0;
  let skipped = 0;

  for (const link of links) {
    const phone = link.contact.phone;
    if (!phone) {
      skipped++;
      continue;
    }
    try {
      const runId = await startOrScheduleTagFlow(flowId, graph, {
        contactPhone: phone,
        contactName: link.contact.name ?? undefined,
        externalId: `tag_bulk_${phone}_${flowId}_${Date.now()}`
      });
      if (runId) scheduled++;
      else skipped++;
    } catch {
      skipped++;
    }
  }

  return { scheduled, skipped };
}
