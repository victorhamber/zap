import { prisma } from "../prisma.js";
import { findContactByPhoneLoose } from "./contacts.js";
import { queueFlowRunStart } from "./flowDispatch.js";
import { listStoredChatSummaries } from "./inboxStore.js";

export type FollowUpStep = { hours: number; flowId: string };

const MAX_STEPS = 3;

export function parseFollowUpSteps(
  raw: unknown,
  legacy?: { hours?: number | null; flowId?: string | null }
): FollowUpStep[] {
  const parsed: FollowUpStep[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const hours = Math.floor(Number((item as { hours?: unknown }).hours));
      const flowId = String((item as { flowId?: unknown }).flowId ?? "").trim();
      if (!flowId || hours < 1) continue;
      parsed.push({ hours: Math.min(24 * 30, hours), flowId });
      if (parsed.length >= MAX_STEPS) break;
    }
  }
  if (parsed.length > 0) return parsed;
  const hours = Math.floor(Number(legacy?.hours ?? 0));
  const flowId = (legacy?.flowId ?? "").trim();
  if (flowId && hours >= 1) return [{ hours: Math.min(24 * 30, hours), flowId }];
  return [];
}

/** Próximo passo, ou null. O passo 1 só sai se a última mensagem foi nossa. Uma resposta da pessoa zera a sequência. */
export function nextFollowUp(params: {
  steps: FollowUpStep[];
  sent: number;
  lastFromMe: boolean;
  lastMessageAt: number;
  lastFiredAt: number | null;
  now: number;
}): FollowUpStep | null {
  const sent = Math.max(0, params.sent);
  if (sent >= params.steps.length) return null;
  const step = params.steps[sent];
  if (!step) return null;
  const wait = step.hours * 60 * 60 * 1000;
  if (sent === 0) {
    if (!params.lastFromMe || !params.lastMessageAt) return null;
    if (params.now - params.lastMessageAt < wait) return null;
    return step;
  }
  if (params.lastFiredAt == null) return null;
  if (!params.lastFromMe && params.lastMessageAt > params.lastFiredAt) return null;
  if (params.now - params.lastFiredAt < wait) return null;
  return step;
}

/**
 * Até 3 fluxos para quem está em conversa e não respondeu.
 * Cada passo espera as próprias horas depois do anterior. Uma mensagem da pessoa zera a contagem.
 */
export async function runColdFollowUps(): Promise<number> {
  if (!prisma) return 0;
  const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
  const steps = parseFollowUpSteps(settings?.followUpSteps, {
    hours: settings?.followUpHours,
    flowId: settings?.followUpFlowId
  });
  if (steps.length === 0) return 0;

  const now = Date.now();
  const chats = await listStoredChatSummaries();
  let started = 0;

  for (const chat of chats) {
    if (chat.kind !== "direct" || chat.isGroup || !chat.timestamp) continue;
    const phone = chat.phone.replace(/\D/g, "");
    if (phone.length < 10) continue;

    const contact = await findContactByPhoneLoose(phone);
    if (!contact || contact.stage !== "em_conversa") continue;

    const step = nextFollowUp({
      steps,
      sent: contact.followUpStep,
      lastFromMe: chat.lastFromMe,
      lastMessageAt: chat.timestamp,
      lastFiredAt: contact.followUpFiredAt?.getTime() ?? null,
      now
    });
    if (!step) continue;

    const anchor = contact.followUpStep > 0 ? contact.followUpFiredAt?.getTime() ?? chat.timestamp : chat.timestamp;
    const externalId = `followup_${contact.id}_s${contact.followUpStep}_${anchor}`;
    try {
      const result = await queueFlowRunStart({
        flowId: step.flowId,
        triggerType: "trigger_manual",
        contactPhone: contact.phone,
        variables: {
          phone: contact.phone,
          name: contact.name ?? "",
          email: contact.email ?? ""
        },
        externalId,
        manualStart: true
      });
      if ("skipped" in result && result.skipped && result.reason !== "duplicate") continue;
      await prisma.contact.update({
        where: { id: contact.id },
        data: { followUpFiredAt: new Date(now), followUpStep: contact.followUpStep + 1 }
      });
      started += 1;
    } catch (err) {
      console.warn(`[follow-up] ${contact.phone}:`, err instanceof Error ? err.message : err);
    }
  }

  if (started > 0) console.log(`[follow-up] ${started} retomada(s)`);
  return started;
}
