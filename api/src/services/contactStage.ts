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

export const LOST_REASONS = ["preco", "sumiu", "ja_tem", "outro"] as const;
export type LostReason = (typeof LOST_REASONS)[number];

export const LOST_REASON_LABELS: Record<LostReason, string> = {
  preco: "Preço",
  sumiu: "Sumiu",
  ja_tem: "Já tem",
  outro: "Outro"
};

export function isLostReason(value: string): value is LostReason {
  return (LOST_REASONS as readonly string[]).includes(value);
}

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
  reason: "inbound" | "purchase" | "manual",
  extra?: { lostReason?: string | null; productName?: string | null }
): Promise<void> {
  if (!prisma) return;
  const contact = await ensureContact(phone);
  const move = nextStage(contact.stage, target, reason);
  const lostReason = extra?.lostReason && isLostReason(extra.lostReason) ? extra.lostReason : null;
  const productName = extra?.productName?.trim() || null;
  if (!move) {
    const data: { followUpFiredAt?: null; followUpStep?: number; productName?: string; lostReason?: string } = {};
    if (reason === "inbound" && (contact.followUpFiredAt || contact.followUpStep > 0)) {
      data.followUpFiredAt = null;
      data.followUpStep = 0;
    }
    if (reason === "purchase" && productName) data.productName = productName;
    if (reason === "manual" && contact.stage === "perdido" && lostReason) data.lostReason = lostReason;
    if (Object.keys(data).length === 0) return;
    await prisma.contact.update({ where: { id: contact.id }, data });
    return;
  }
  await prisma.contact.update({
    where: { id: contact.id },
    data: {
      stage: move,
      ...(reason === "inbound" ? { followUpFiredAt: null, followUpStep: 0 } : {}),
      ...(move === "perdido" ? { lostReason } : { lostReason: null }),
      ...(reason === "purchase" && productName ? { productName } : {})
    }
  });
}

export async function noteInbound(phone: string): Promise<void> {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return;
  await setContactStage(digits, "em_conversa", "inbound");
}

export async function notePurchase(phone: string, productName?: string): Promise<void> {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return;
  await setContactStage(digits, "comprou", "purchase", { productName });
}

export async function stageLabelForPhone(phone: string): Promise<string> {
  if (!prisma) return FUNNEL_LABELS.novo;
  const contact = await findContactByPhoneLoose(phone);
  const stage = contact?.stage && isFunnelStage(contact.stage) ? contact.stage : "novo";
  return FUNNEL_LABELS[stage];
}
