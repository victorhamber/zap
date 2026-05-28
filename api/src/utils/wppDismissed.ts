import { prisma } from "../prisma.js";

export function parseDismissedList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => String(x).toLowerCase()).filter(Boolean);
}

export async function getDismissedSessions(): Promise<string[]> {
  if (!prisma) return [];
  const s = await prisma.appSettings.findUnique({ where: { id: "default" } });
  return parseDismissedList(s?.dismissedWppSessions);
}

export async function dismissSession(name: string): Promise<void> {
  if (!prisma) return;
  const n = name.trim().toLowerCase();
  const current = await getDismissedSessions();
  if (current.includes(n)) return;
  await prisma.appSettings.update({
    where: { id: "default" },
    data: { dismissedWppSessions: [...current, n] }
  });
}

export async function undismissSession(name: string): Promise<void> {
  if (!prisma) return;
  const n = name.trim().toLowerCase();
  const current = await getDismissedSessions();
  await prisma.appSettings.update({
    where: { id: "default" },
    data: { dismissedWppSessions: current.filter((x) => x !== n) }
  });
}
