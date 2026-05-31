import Mustache from "mustache";
import { prisma } from "../prisma.js";
import { enqueueFlowJob } from "../queue.js";
import { getByPath, asString } from "../utils/jsonPathLite.js";
import { resolveHotmartCountryIso, resolveHotmartPhone } from "../utils/hotmartPhone.js";
import { assertValidWhatsAppPhone, firstNameFromFullName } from "../utils/phone.js";
import {
  addContactTagsByNames,
  removeContactTagsByNames
} from "../services/contacts.js";
import * as wpp from "../services/whatsapp/index.js";
import { getNextNodeId, getNextNodeIdByHandle, getNode, parseGraph } from "./graph.js";
import type {
  ConditionOfferCodeData,
  DelayNodeData,
  DelayUnit,
  FlowGraph,
  HotmartMapping,
  ScheduleAtNodeData,
  SendMediaNodeData,
  SendTextNodeData,
  StartFlowData,
  TagActionData,
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

export function resolveFlowTriggerType(graph: FlowGraph): string {
  if (graph.nodes.some((n) => n.type === "trigger_manual")) return "trigger_manual";
  if (graph.nodes.some((n) => n.type === "trigger_hotmart")) return "trigger_hotmart";
  if (graph.nodes.some((n) => n.type === "trigger_tag")) return "trigger_tag";
  if (graph.nodes.some((n) => n.type === "trigger_inbound")) return "trigger_inbound";
  return "trigger_manual";
}

function resolveHotmartOfferCode(payload: unknown, mapping: HotmartMapping): string {
  const paths = [
    mapping.offerCodePath,
    "$.data.purchase.offer.code",
    "$.data.offer.code",
    "$.purchase.offer.code"
  ];

  for (const path of paths) {
    if (!path) continue;
    const v = asString(getByPath(payload, path));
    if (v) return v;
  }
  return "";
}

function resolveHotmartPurchaseId(payload: unknown, mapping: HotmartMapping): string {
  const paths = [
    mapping.purchaseIdPath,
    "$.data.purchase.transaction",
    "$.data.purchase.order_id",
    "$.data.purchase.id",
    "$.data.purchase.code",
    "$.id"
  ];

  for (const path of paths) {
    if (!path) continue;
    const v = asString(getByPath(payload, path));
    if (v) return v;
  }
  return "";
}

export function extractHotmartVariables(
  payload: unknown,
  mapping: HotmartMapping
): Record<string, unknown> {
  const countryIso = resolveHotmartCountryIso(payload);
  const phone = resolveHotmartPhone(payload, mapping.phonePath);
  const fullName =
    asString(getByPath(payload, mapping.namePath)) ??
    asString(getByPath(payload, "$.data.buyer.name")) ??
    asString(getByPath(payload, "$.data.buyer.first_name")) ??
    "Cliente";
  const name = firstNameFromFullName(fullName);
  const purchaseId = resolveHotmartPurchaseId(payload, mapping);

  if (!phone) {
    throw new Error(
      "Telefone não encontrado no payload Hotmart (tente buyer.checkout_phone ou buyer.phone)"
    );
  }
  if (!purchaseId) {
    throw new Error(
      "ID da compra não encontrado no payload Hotmart (tente purchase.transaction)"
    );
  }

  const normalizedPhone = assertValidWhatsAppPhone(phone, countryIso);

  return {
    phone: normalizedPhone,
    countryIso,
    name,
    fullName,
    purchaseId,
    email:
      asString(mapping.emailPath ? getByPath(payload, mapping.emailPath) : undefined) ??
      asString(getByPath(payload, "$.data.buyer.email")) ??
      "",
    productName:
      asString(mapping.productNamePath ? getByPath(payload, mapping.productNamePath) : undefined) ??
      asString(getByPath(payload, "$.data.product.name")) ??
      "",
    offerCode: resolveHotmartOfferCode(payload, mapping),
    offerName:
      asString(getByPath(payload, "$.data.purchase.offer.name")) ??
      asString(getByPath(payload, "$.data.offer.name")) ??
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

  const phone = assertValidWhatsAppPhone(
    String(vars.phone ?? ""),
    String(vars.countryIso ?? "BR")
  );

  if (node.type === "condition_offer_code") {
    const data = node.data as unknown as ConditionOfferCodeData;
    const offerCode = String(vars.offerCode ?? "")
      .trim()
      .toLowerCase();
    let matchedHandle = "default";
    let matchedLabel = "Outros";

    for (const branch of data.branches ?? []) {
      const codes = (branch.codes ?? [])
        .map((code) => String(code).trim().toLowerCase())
        .filter(Boolean);
      if (codes.length > 0 && codes.includes(offerCode)) {
        matchedHandle = branch.id;
        matchedLabel = branch.label?.trim() || branch.id;
        break;
      }
    }

    await logStep(
      flowRunId,
      nodeId,
      node.type,
      "ok",
      offerCode
        ? `Código "${vars.offerCode}" → ${matchedLabel}`
        : `Sem código de oferta → ${matchedLabel}`,
      { offerCode: vars.offerCode ?? "", branch: matchedHandle }
    );

    const nextId = getNextNodeIdByHandle(graph, nodeId, matchedHandle);
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
    return;
  }

  if (node.type === "tag_action") {
    const data = node.data as unknown as TagActionData;
    const tagNames = (data.tagNames ?? []).map((name) => String(name).trim()).filter(Boolean);
    if (tagNames.length > 0) {
      if (data.mode === "remove") {
        await removeContactTagsByNames(phone, tagNames);
      } else {
        await addContactTagsByNames(phone, tagNames, String(vars.name ?? ""));
      }
    }
    const actionLabel = data.mode === "remove" ? "Removidas" : "Adicionadas";
    await logStep(
      flowRunId,
      nodeId,
      node.type,
      "ok",
      tagNames.length > 0 ? `${actionLabel}: ${tagNames.join(", ")}` : "Nenhuma tag configurada"
    );
  } else if (node.type === "start_flow") {
    const data = node.data as unknown as StartFlowData;
    const targetFlowId = String(data.targetFlowId ?? "").trim();
    if (!targetFlowId) {
      await logStep(flowRunId, nodeId, node.type, "skipped", "Nenhum fluxo destino selecionado");
    } else if (!prisma) {
      throw new Error("Banco indisponível");
    } else {
      const targetFlow = await prisma.flow.findUnique({ where: { id: targetFlowId } });
      if (!targetFlow) {
        await logStep(flowRunId, nodeId, node.type, "failed", "Fluxo destino não encontrado");
      } else if (!targetFlow.enabled) {
        await logStep(
          flowRunId,
          nodeId,
          node.type,
          "skipped",
          `Fluxo "${targetFlow.name}" está inativo`
        );
      } else {
        try {
          const targetGraph = parseGraph(targetFlow.graphJson);
          const subResult = await startFlowRun({
            flowId: targetFlowId,
            triggerType: resolveFlowTriggerType(targetGraph),
            contactPhone: phone,
            variables: { ...vars, phone },
            externalId: `from_${flowRunId}_${nodeId}_${Date.now()}`
          });
          if (subResult.skipped) {
            await logStep(
              flowRunId,
              nodeId,
              node.type,
              "skipped",
              `Subfluxo não iniciado: ${subResult.reason ?? "desconhecido"}`
            );
          } else {
            await logStep(
              flowRunId,
              nodeId,
              node.type,
              "ok",
              `Iniciou fluxo "${targetFlow.name}"`
            );
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : String(err);
          await logStep(flowRunId, nodeId, node.type, "failed", message);
        }
      }
    }
  } else if (node.type === "delay") {
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

  const logSendFailure = async (nodeType: string, err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    await logStep(flowRunId, nodeId, nodeType, "failed", message);
    throw err;
  };

  if (node.type === "send_text") {
    const data = node.data as unknown as SendTextNodeData;
    const text = render(data.text ?? "", vars);
    try {
      await wpp.sendText(phone, text);
    } catch (err) {
      await logSendFailure(node.type, err);
    }
    await logStep(flowRunId, nodeId, node.type, "ok", "Mensagem enviada");
  } else if (node.type === "send_image") {
    const data = node.data as unknown as SendMediaNodeData;
    try {
      await wpp.sendImage(phone, data.url, data.caption ? render(data.caption, vars) : undefined);
    } catch (err) {
      await logSendFailure(node.type, err);
    }
    await logStep(flowRunId, nodeId, node.type, "ok", "Imagem enviada");
  } else if (node.type === "send_video") {
    const data = node.data as unknown as SendMediaNodeData;
    try {
      await wpp.sendVideo(phone, data.url, data.caption ? render(data.caption, vars) : undefined);
    } catch (err) {
      await logSendFailure(node.type, err);
    }
    await logStep(flowRunId, nodeId, node.type, "ok", "Vídeo enviado");
  } else if (node.type === "send_audio") {
    const data = node.data as unknown as SendMediaNodeData;
    try {
      await wpp.sendAudio(phone, data.url);
    } catch (err) {
      await logSendFailure(node.type, err);
    }
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

  try {
    await logStep(run.id, startNodeId, params.triggerType, "ok", "Início");
    await executeNode(graph, run.id, firstActionId, params.variables);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.flowRun.update({
      where: { id: run.id },
      data: { status: "failed", errorMessage: message }
    });
    throw err;
  }
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
