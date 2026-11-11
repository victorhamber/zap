import { prisma } from "../prisma.js";
import { ensureContact, findContactByPhoneLoose } from "./contacts.js";

export const FUNNEL_STAGES = ["novo", "em_conversa", "comprou", "perdido"] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export const FUNNEL_LABELS: Record<FunnelStage, string> = {
  novo: "Novo",
  em_conversa: "Em conversa",
  comprou: "Comprou",
  perdido: "Perdido"
};

export function isFunnelStage(value: string): value is FunnelStage {
  return (FUNNEL_STAGES as readonly string[]).includes(value);
}

/** Inbound só tira de Novo. Compra sempre vai para Comprou. Manual aceita qualquer etapa. */
export function nextStage(
  current: string,
  target: FunnelStage,
  reason: "inbound" | "purchase" | "manual"
): FunnelStage | null {
  const from: FunnelStage = isFunnelStage(current) ? current : "novo";
  if (reason === "manual") return target === from ? null : target;
  if (reason === "purchase") return from === "comprou" ? null : "comprou";
  if (from !== "novo") return null;
  return "em_conversa";
}

export async function setContactStage(
  phone: string,
  target: FunnelStage,
  reason: "inbound" | "purchase" | "manual"
): Promise<void> {
  if (!prisma) return;
  const contact = await ensureContact(phone);
  const move = nextStage(contact.stage, target, reason);
  if (!move) {
    if (reason === "inbound" && contact.followUpFiredAt) {
      await prisma.contact.update({
        where: { id: contact.id },
        data: { followUpFiredAt: null }
      });
    }
    return;
  }
  await prisma.contact.update({
    where: { id: contact.id },
    data: {
      stage: move,
      ...(reason === "inbound" ? { followUpFiredAt: null } : {})
    }
  });
}

export async function noteInbound(phone: string): Promise<void> {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return;
  await setContactStage(digits, "em_conversa", "inbound");
}

export async function notePurchase(phone: string): Promise<void> {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return;
  await setContactStage(digits, "comprou", "purchase");
}

export async function stageLabelForPhone(phone: string): Promise<string> {
  if (!prisma) return FUNNEL_LABELS.novo;
  const contact = await findContactByPhoneLoose(phone);
  const stage = contact?.stage && isFunnelStage(contact.stage) ? contact.stage : "novo";
  return FUNNEL_LABELS[stage];
}
