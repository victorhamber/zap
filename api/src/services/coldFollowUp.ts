import { prisma } from "../prisma.js";
import { findContactByPhoneLoose } from "./contacts.js";
import { queueFlowRunStart } from "./flowDispatch.js";
import { listStoredChatSummaries } from "./inboxStore.js";

/**
 * Contato em "Em conversa" cuja última mensagem é dele e já passou do silêncio
 * configurado. Dispara o fluxo escolhido uma vez por essa mensagem.
 */
export async function runColdFollowUps(): Promise<number> {
  if (!prisma) return 0;
  const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
  const flowId = settings?.followUpFlowId?.trim() ?? "";
  const hours = settings?.followUpHours ?? 24;
  if (!flowId || hours < 1) return 0;

  const cutoff = Date.now() - hours * 60 * 60 * 1000;
  const chats = await listStoredChatSummaries();
  let started = 0;

  for (const chat of chats) {
    if (chat.kind !== "direct" || chat.isGroup || chat.lastFromMe) continue;
    if (!chat.timestamp || chat.timestamp > cutoff) continue;
    const phone = chat.phone.replace(/\D/g, "");
    if (phone.length < 10) continue;

    const contact = await findContactByPhoneLoose(phone);
    if (!contact || contact.stage !== "em_conversa") continue;
    if (contact.followUpFiredAt && contact.followUpFiredAt.getTime() >= chat.timestamp) continue;

    const externalId = `followup_${contact.id}_${chat.timestamp}`;
    try {
      await queueFlowRunStart({
        flowId,
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
      await prisma.contact.update({
        where: { id: contact.id },
        data: { followUpFiredAt: new Date(chat.timestamp) }
      });
      started += 1;
    } catch (err) {
      console.warn(`[follow-up] ${contact.phone}:`, err instanceof Error ? err.message : err);
    }
  }

  if (started > 0) console.log(`[follow-up] ${started} retomada(s)`);
  return started;
}
