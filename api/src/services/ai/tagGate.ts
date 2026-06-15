import { prisma } from "../../prisma.js";
import { expandPhoneLookupKeys } from "../../utils/phone.js";
import { findContactByPhoneLoose } from "../contacts.js";

export async function contactHasLearnTags(
  phone: string,
  learnTagIds: string[]
): Promise<boolean> {
  if (!prisma || learnTagIds.length === 0) return false;

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
