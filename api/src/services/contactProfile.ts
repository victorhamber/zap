import { prisma } from "../prisma.js";
import { defaultWhatsAppSession } from "../env.js";
import { canonicalBrazilPhone } from "../utils/phone.js";
import { contactToJson, findContactByPhoneLoose } from "./contacts.js";
import {
  findPrimaryChatIdForContact,
  resolveAllChatIdsForContact
} from "./inboxStore.js";
import * as wpp from "./whatsapp/index.js";

export type ContactProfileGroup = {
  id: string;
  name: string;
};

export type ContactProfile = {
  chatId: string;
  phone: string;
  name: string | null;
  notes: string | null;
  isGroup: boolean;
  contact: ReturnType<typeof contactToJson> | null;
  groups: ContactProfileGroup[];
  messageCount: number;
  createdAt: string | null;
};

async function inboxSession(): Promise<string> {
  if (!prisma) return defaultWhatsAppSession().trim().toLowerCase();
  const s = await prisma.appSettings.findUnique({ where: { id: "default" } });
  return (s?.wppSession ?? defaultWhatsAppSession()).trim().toLowerCase();
}

export async function getContactProfile(params: {
  key: string;
  chatId?: string;
  isGroup?: boolean;
}): Promise<ContactProfile | null> {
  if (!prisma) return null;

  const rawKey = decodeURIComponent(params.key).trim();
  const isGroup =
    params.isGroup === true || rawKey.includes("@g.us") || params.chatId?.includes("@g.us");

  const session = await inboxSession();

  if (isGroup) {
    const chatId = params.chatId?.trim() || rawKey;
    const variants = await resolveAllChatIdsForContact(session, chatId);
    const messageCount = await prisma.inboxMessage.count({
      where: { session, chatId: { in: variants } }
    });
    return {
      chatId: await findPrimaryChatIdForContact(session, chatId),
      phone: chatId.replace(/@.*/, ""),
      name: null,
      notes: null,
      isGroup: true,
      contact: null,
      groups: [],
      messageCount,
      createdAt: null
    };
  }

  const phoneDigits = canonicalBrazilPhone(rawKey.replace(/@.*/, ""));
  const seed = rawKey.includes("@") ? rawKey : `${phoneDigits}@s.whatsapp.net`;
  const chatId = await findPrimaryChatIdForContact(session, seed);
  const variants = await resolveAllChatIdsForContact(session, chatId);

  const contact = await findContactByPhoneLoose(phoneDigits || rawKey);
  const messageCount = await prisma.inboxMessage.count({
    where: { session, chatId: { in: variants } }
  });

  let groups: ContactProfileGroup[] = [];
  if (wpp.isEvolution && phoneDigits.length >= 10) {
    const { fetchGroupsForPhone } = await import("./whatsapp/evolution.js");
    groups = await fetchGroupsForPhone(phoneDigits);
  }

  return {
    chatId,
    phone: contact?.phone ?? phoneDigits,
    name: contact?.name ?? null,
    notes: contact?.notes ?? null,
    isGroup: false,
    contact: contact ? contactToJson(contact) : null,
    groups,
    messageCount,
    createdAt: contact?.createdAt?.toISOString() ?? null
  };
}
