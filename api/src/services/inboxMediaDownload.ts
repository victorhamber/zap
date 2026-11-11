/** Baixa a mídia de uma mensagem já gravada. Grupo não baixa sozinho. */
import { prisma } from "../prisma.js";
import { toPublicMediaUrl } from "./uploads.js";
import { downloadMediaForStoredMessage, isInboundMediaType, previewStillNeedsFile } from "./wppMedia.js";
import { getInboxSessionName, updateInboxMessageMedia } from "./inboxStore.js";

export async function downloadInboxMessageOnDemand(
  messageId: string
): Promise<{ url: string; type: string } | null> {
  if (!prisma) return null;
  const id = messageId.trim();
  if (!id) return null;
  const session = await getInboxSessionName();
  const row = await prisma.inboxMessage.findFirst({
    where: { id, session },
    select: { chatId: true, waMessageId: true, type: true, mediaUrl: true }
  });
  if (!row) return null;
  const type = row.type === "ptt" ? "audio" : row.type;
  if (row.mediaUrl && !previewStillNeedsFile(type, row.mediaUrl)) {
    const url = toPublicMediaUrl(row.mediaUrl) ?? row.mediaUrl;
    return { url, type };
  }
  if (!row.waMessageId || !isInboundMediaType(type)) return null;
  const saved = await downloadMediaForStoredMessage({
    chatId: row.chatId,
    waMessageId: row.waMessageId,
    type
  });
  if (!saved) return null;
  await updateInboxMessageMedia(row.waMessageId, saved);
  const url = toPublicMediaUrl(saved) ?? saved;
  return { url, type };
}
