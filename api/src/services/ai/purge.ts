import { prisma } from "../../prisma.js";

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
