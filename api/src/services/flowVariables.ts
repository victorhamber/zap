import { findContactByPhoneLoose, isWeakContactName } from "./contacts.js";
import { firstNameFromFullName } from "../utils/phone.js";

/** E-mail válido para Mustache / Resend. */
export function normalizeFlowEmail(value: unknown): string {
  const s = String(value ?? "").trim();
  if (!s || !s.includes("@") || s.startsWith("@") || s.endsWith("@")) return "";
  return s;
}

/**
 * Completa name/fullName/email a partir do CRM quando o gatilho não enviou
 * (tag, broadcast, inbound, manual, etc.).
 */
export async function enrichFlowVariables(
  contactPhone: string,
  variables: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const contact = await findContactByPhoneLoose(contactPhone);

  const email =
    normalizeFlowEmail(variables.email) || normalizeFlowEmail(contact?.email) || "";

  const fullNameRaw = String(variables.fullName ?? variables.name ?? contact?.name ?? "").trim();
  const fullName = fullNameRaw || "Contato";
  const nameRaw = String(variables.name ?? "").trim();
  const name =
    nameRaw && !isWeakContactName(nameRaw)
      ? firstNameFromFullName(nameRaw, nameRaw)
      : firstNameFromFullName(fullName, fullName);

  return {
    ...variables,
    phone: String(variables.phone ?? contact?.phone ?? contactPhone).trim() || contactPhone,
    email,
    name,
    fullName
  };
}

/** Grava e-mail/nome do webhook no contato para reutilizar em outros gatilhos. */
export async function persistContactFromFlowVariables(
  contactPhone: string,
  variables: Record<string, unknown>
): Promise<void> {
  const { prisma } = await import("../prisma.js");
  if (!prisma) return;

  const email = normalizeFlowEmail(variables.email);
  const incomingName = String(variables.fullName ?? variables.name ?? "").trim();
  const contact = await findContactByPhoneLoose(contactPhone);
  if (!contact) return;

  const data: { email?: string; name?: string } = {};
  if (email && email !== normalizeFlowEmail(contact.email)) {
    data.email = email;
  }
  if (incomingName && !isWeakContactName(incomingName) && isWeakContactName(contact.name)) {
    data.name = firstNameFromFullName(incomingName, incomingName);
  }
  if (Object.keys(data).length === 0) return;

  await prisma.contact.update({
    where: { id: contact.id },
    data
  });
}
