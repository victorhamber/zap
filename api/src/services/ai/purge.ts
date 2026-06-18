import { prisma } from "../../prisma.js";

/** Remove memória e conhecimento da IA para um contato (todos os chatId variantes). */
export async function purgeAiForContact(
  sessionName: string,
  chatIds: string[]
): Promise<void> {
  if (!prisma) return;
  const session = sessionName.trim().toLowerCase();
  const ids = [...new Set(chatIds.filter(Boolean))];
  if (ids.length === 0) return;

  await prisma.$transaction([
    prisma.instanceAiKnowledge.deleteMany({ where: { session, chatId: { in: ids } } }),
    prisma.instanceAiChatState.deleteMany({ where: { session, chatId: { in: ids } } }),
    prisma.instanceAiEvent.deleteMany({
      where: { session, chatId: { in: ids } }
    })
  ]);
}

export async function purgeAiForSession(sessionName: string): Promise<void> {
  if (!prisma) return;
  const session = sessionName.trim().toLowerCase();
  if (!session) return;

  await prisma.$transaction([
    prisma.instanceAiKnowledge.deleteMany({ where: { session } }),
    prisma.instanceAiChatState.deleteMany({ where: { session } }),
    prisma.instanceAiEvent.deleteMany({ where: { session } }),
    prisma.instanceAiSettings.deleteMany({ where: { session } })
  ]);
}
