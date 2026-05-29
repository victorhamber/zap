import Mustache from "mustache";
import { prisma } from "../prisma.js";
import { enqueueFlowJob } from "../queue.js";
import { getByPath, asString } from "../utils/jsonPathLite.js";
import { normalizePhone } from "../utils/phone.js";
import * as wpp from "../services/whatsapp/index.js";
import { getNextNodeId, getNode, parseGraph } from "./graph.js";
import type {
  DelayNodeData,
  DelayUnit,
  FlowGraph,
  HotmartMapping,
  ScheduleAtNodeData,
  SendMediaNodeData,
  SendTextNodeData,
  TriggerHotmartData,
  TriggerInboundData
} from "../types/flow.js";

function delayToMs(value: number, unit: DelayUnit): number {
  const v = Math.max(0, value);
  switch (unit) {
    case "minutes":
      return v * 60 * 1000;
    case "hours":
      return v * 60 * 60 * 1000;
    case "days":
      return v * 24 * 60 * 60 * 1000;
    default:
      return v * 24 * 60 * 60 * 1000;
  }
}

function render(template: string, vars: Record<string, unknown>): string {
  return Mustache.render(template, vars);
}

export function extractHotmartVariables(
  payload: unknown,
  mapping: HotmartMapping
): Record<string, unknown> {
  const phone = asString(getByPath(payload, mapping.phonePath));
  const name = asString(getByPath(payload, mapping.namePath)) ?? "Cliente";
  const purchaseId = asString(getByPath(payload, mapping.purchaseIdPath));

  if (!phone) throw new Error("Telefone não encontrado no payload Hotmart");
  if (!purchaseId) throw new Error("purchaseId não encontrado no payload Hotmart");

  return {
    phone: normalizePhone(phone),
    name,
    purchaseId,
    email: asString(mapping.emailPath ? getByPath(payload, mapping.emailPath) : undefined) ?? "",
    productName:
      asString(mapping.productNamePath ? getByPath(payload, mapping.productNamePath) : undefined) ??
      "",
    login: asString(mapping.loginPath ? getByPath(payload, mapping.loginPath) : undefined) ?? "",
    password:
      asString(mapping.passwordPath ? getByPath(payload, mapping.passwordPath) : undefined) ?? "",
    accessLink:
      asString(mapping.accessLinkPath ? getByPath(payload, mapping.accessLinkPath) : undefined) ??
      ""
  };
}

async function logStep(
  flowRunId: string,
  nodeId: string,
  nodeType: string,
  status: string,
  message?: string,
  payload?: unknown
) {
  if (!prisma) return;
  await prisma.flowRunStep.create({
    data: {
      flowRunId,
      nodeId,
      nodeType,
      status,
      message,
      payload: payload as object | undefined
    }
  });
}

async function executeNode(
  graph: FlowGraph,
  flowRunId: string,
  nodeId: string,
  vars: Record<string, unknown>
): Promise<void> {
  const node = getNode(graph, nodeId);
  if (!node) throw new Error(`Nó não encontrado: ${nodeId}`);

  const phone = String(vars.phone ?? "");

  if (node.type === "delay") {
    const data = node.data as unknown as DelayNodeData;
    const ms = delayToMs(data.value ?? 1, data.unit ?? "days");
    const nextId = getNextNodeId(graph, nodeId);
    if (!nextId) {
      await finishRun(flowRunId, "completed");
      return;
    }
    const runAt = new Date(Date.now() + ms);
    const jobId = `${flowRunId}:${nextId}`;
    const job = await enqueueFlowJob({ flowRunId, nodeId: nextId }, ms, jobId);
    if (prisma) {
      await prisma.scheduledJob.create({
        data: {
          flowRunId,
          nodeId: nextId,
          bullJobId: job.id ?? jobId,
          runAt,
          status: "pending"
        }
      });
      await prisma.flowRun.update({
        where: { id: flowRunId },
        data: { status: "waiting", currentNodeId: nodeId }
      });
    }
    await logStep(flowRunId, nodeId, node.type, "scheduled", `Aguardando ${data.value} ${data.unit}`);
    return;
  }

  if (node.type === "schedule_at") {
    const data = node.data as unknown as ScheduleAtNodeData;
    const target = new Date(data.datetime);
    const ms = Math.max(0, target.getTime() - Date.now());
    const nextId = getNextNodeId(graph, nodeId);
    if (!nextId) {
      await finishRun(flowRunId, "completed");
      return;
    }
    const jobId = `${flowRunId}:${nextId}:at`;
    const job = await enqueueFlowJob({ flowRunId, nodeId: nextId }, ms, jobId);
    if (prisma) {
      await prisma.scheduledJob.create({
        data: {
          flowRunId,
          nodeId: nextId,
          bullJobId: job.id ?? jobId,
          runAt: target,
          status: "pending"
        }
      });
      await prisma.flowRun.update({
        where: { id: flowRunId },
        data: { status: "waiting", currentNodeId: nodeId }
      });
    }
    await logStep(flowRunId, nodeId, node.type, "scheduled", `Agendado para ${data.datetime}`);
    return;
  }

  if (node.type === "send_text") {
    const data = node.data as unknown as SendTextNodeData;
    const text = render(data.text ?? "", vars);
    await wpp.sendText(phone, text);
    await logStep(flowRunId, nodeId, node.type, "ok", "Mensagem enviada");
  } else if (node.type === "send_image") {
    const data = node.data as unknown as SendMediaNodeData;
    await wpp.sendImage(phone, data.url, data.caption ? render(data.caption, vars) : undefined);
    await logStep(flowRunId, nodeId, node.type, "ok", "Imagem enviada");
  } else if (node.type === "send_video") {
    const data = node.data as unknown as SendMediaNodeData;
    await wpp.sendVideo(phone, data.url, data.caption ? render(data.caption, vars) : undefined);
    await logStep(flowRunId, nodeId, node.type, "ok", "Vídeo enviado");
  } else if (node.type === "send_audio") {
    const data = node.data as unknown as SendMediaNodeData;
    await wpp.sendAudio(phone, data.url);
    await logStep(flowRunId, nodeId, node.type, "ok", "Áudio enviado");
  } else if (
    node.type.startsWith("trigger_")
  ) {
    await logStep(flowRunId, nodeId, node.type, "ok", "Gatilho");
  }

  const nextId = getNextNodeId(graph, nodeId);
  if (!nextId) {
    await finishRun(flowRunId, "completed");
    return;
  }

  if (prisma) {
    await prisma.flowRun.update({
      where: { id: flowRunId },
      data: { currentNodeId: nextId, status: "running" }
    });
  }

  await executeNode(graph, flowRunId, nextId, vars);
}

async function finishRun(flowRunId: string, status: string) {
  if (!prisma) return;
  await prisma.flowRun.update({
    where: { id: flowRunId },
    data: { status, currentNodeId: null }
  });
}

export async function continueFlowRun(flowRunId: string, startNodeId: string) {
  if (!prisma) throw new Error("DATABASE_URL obrigatório");
  const run = await prisma.flowRun.findUnique({
    where: { id: flowRunId },
    include: { flow: true }
  });
  if (!run) throw new Error("FlowRun não encontrado");
  if (run.status === "completed" || run.status === "failed") return;

  const graph = parseGraph(run.flow.graphJson);
  const vars = run.variables as Record<string, unknown>;

  try {
    await prisma.flowRun.update({
      where: { id: flowRunId },
      data: { status: "running" }
    });
    await executeNode(graph, flowRunId, startNodeId, vars);
  } catch (err: any) {
    await prisma.flowRun.update({
      where: { id: flowRunId },
      data: { status: "failed", errorMessage: err?.message ?? String(err) }
    });
    await logStep(flowRunId, startNodeId, "error", "failed", err?.message);
    throw err;
  }
}

export async function startFlowRun(params: {
  flowId: string;
  triggerType: string;
  contactPhone: string;
  variables: Record<string, unknown>;
  externalId?: string;
  startFromNodeId?: string;
}) {
  if (!prisma) throw new Error("DATABASE_URL obrigatório");

  const flow = await prisma.flow.findUnique({ where: { id: params.flowId } });
  if (!flow) throw new Error("Fluxo não encontrado");
  if (!flow.enabled) return { skipped: true, reason: "disabled" };

  if (params.externalId) {
    const existing = await prisma.flowRun.findUnique({
      where: {
        flowId_externalId: { flowId: params.flowId, externalId: params.externalId }
      }
    });
    if (existing) return { skipped: true, reason: "duplicate", runId: existing.id };
  }

  const graph = parseGraph(flow.graphJson);
  let startNodeId = params.startFromNodeId;
  if (!startNodeId) {
    const trigger = graph.nodes.find((n) => n.type === params.triggerType);
    if (!trigger) throw new Error(`Gatilho ${params.triggerType} não encontrado no fluxo`);
    startNodeId = trigger.id;
  }

  const run = await prisma.flowRun.create({
    data: {
      flowId: params.flowId,
      triggerType: params.triggerType,
      contactPhone: params.contactPhone,
      variables: params.variables as object,
      externalId: params.externalId,
      status: "running",
      currentNodeId: startNodeId
    }
  });

  const firstActionId = getNextNodeId(graph, startNodeId);
  if (!firstActionId) {
    await finishRun(run.id, "completed");
    return { runId: run.id };
  }

  await logStep(run.id, startNodeId, params.triggerType, "ok", "Início");
  await executeNode(graph, run.id, firstActionId, params.variables);
  return { runId: run.id };
}

export function matchInboundFlows(
  graph: FlowGraph,
  messageText: string,
  contactTagNames: string[] = []
): boolean {
  const trigger = graph.nodes.find((n) => n.type === "trigger_inbound");
  if (!trigger) return false;
  const data = trigger.data as unknown as TriggerInboundData;

  const requiredTags = (data.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean);
  if (requiredTags.length > 0) {
    const normalized = contactTagNames.map((t) => t.toLowerCase());
    const hasTag = requiredTags.some((t) => normalized.includes(t));
    if (!hasTag) return false;
  }

  if (!data.keyword?.trim()) return true;
  return messageText.toLowerCase().includes(data.keyword.toLowerCase());
}

export function getHotmartMappingFromGraph(graph: FlowGraph): HotmartMapping {
  const trigger = graph.nodes.find((n) => n.type === "trigger_hotmart");
  if (!trigger) throw new Error("trigger_hotmart não configurado");
  return (trigger.data as unknown as TriggerHotmartData).mapping;
}
