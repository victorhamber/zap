import { prisma } from "../prisma.js";
import { parseGraph } from "../engine/graph.js";
import { queueFlowRunStart } from "./flowDispatch.js";
import { canonicalBrazilPhone } from "../utils/phone.js";

function normalizeContactPhone(phone: string): string | null {
  const raw = phone.trim();
  if (!raw || raw.includes("@g.us")) return null;
  try {
    return canonicalBrazilPhone(raw);
  } catch {
    const digits = raw.replace(/\D/g, "");
    return digits.length >= 10 ? digits : null;
  }
}

async function queueBroadcastRun(
  flowId: string,
  params: {
    contactPhone: string;
    contactName?: string;
    externalId: string;
  }
): Promise<string | null> {
  const result = await queueFlowRunStart({
    flowId,
    triggerType: "trigger_broadcast",
    contactPhone: params.contactPhone,
    variables: {
      phone: params.contactPhone,
      name: params.contactName ?? "Contato",
      purchaseId: `broadcast_${Date.now()}_${flowId}`
    },
    externalId: params.externalId
  });

  if (result && "queued" in result && result.queued) {
    return `queued_${result.delayMs}ms`;
  }
  if (result && "runId" in result && result.runId) return result.runId;
  return null;
}

/**
 * Inicia o fluxo para todos os contatos cadastrados.
 * Filtros (tag, oferta, etc.) ficam nos blocos de condição do fluxo.
 */
export async function dispatchBroadcastFlow(
  flowId: string
): Promise<{ scheduled: number; skipped: number; total: number }> {
  if (!prisma) throw new Error("Banco indisponível");

  const flow = await prisma.flow.findUnique({ where: { id: flowId } });
  if (!flow?.enabled) throw new Error("Fluxo não encontrado ou inativo");

  const graph = parseGraph(flow.graphJson);
  const trigger = graph.nodes.find((n) => n.type === "trigger_broadcast");
  if (!trigger) throw new Error("Este fluxo não tem gatilho Broadcast");

  const contacts = await prisma.contact.findMany({
    orderBy: { updatedAt: "desc" }
  });

  const batchId = Date.now();
  const seenPhones = new Set<string>();
  let scheduled = 0;
  let skipped = 0;

  for (const contact of contacts) {
    const phone = normalizeContactPhone(contact.phone);
    if (!phone) {
      skipped++;
      continue;
    }
    if (seenPhones.has(phone)) {
      skipped++;
      continue;
    }
    seenPhones.add(phone);

    try {
      const id = await queueBroadcastRun(flowId, {
        contactPhone: phone,
        contactName: contact.name ?? undefined,
        externalId: `broadcast_${flowId}_${batchId}_${phone}`
      });
      if (id) scheduled++;
      else skipped++;
    } catch {
      skipped++;
    }
  }

  console.log(
    `[broadcast] flow=${flowId} batch=${batchId} scheduled=${scheduled} skipped=${skipped} total=${contacts.length}`
  );

  return { scheduled, skipped, total: contacts.length };
}
