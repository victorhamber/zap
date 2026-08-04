import { prisma } from "../../prisma.js";
import { findContactByPhoneLoose } from "../contacts.js";

export async function contactHasLearnTags(
  phone: string,
  learnTagIds: string[]
): Promise<boolean> {
  // Sem tags configuradas = todos elegíveis (filtro só quando a lista tem IDs).
  if (learnTagIds.length === 0) return true;
  if (!prisma) return false;

  const contact = await findContactByPhoneLoose(phone);
  if (!contact) return false;

  const tagSet = new Set(contact.tags.map((t) => t.tagId));
  return learnTagIds.some((id) => tagSet.has(id));
}

export function phoneFromChatId(chatId: string): string {
  return chatId.replace(/@.*/, "").replace(/\D/g, "");
}

export function isGroupChatId(chatId: string): boolean {
  return chatId.includes("@g.us");
}
