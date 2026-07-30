/**
 * Reprocessa mensagens antigas gravadas com o texto genérico de template/botão
 * ("📄 Template: nome", "📄 Mensagem com botões"). As que têm o nome do template
 * são reconstruídas a partir do cadastro na Meta.
 */
import { prisma } from "../prisma.js";
import { hydrateMetaTemplateText } from "./whatsapp/metaTemplates.js";

export type TemplateRepairResult = {
  session: string;
  scanned: number;
  repaired: number;
  /** Sem nome de template gravado — não há como reconstruir o texto. */
  unresolved: number;
};

const NAMED_PLACEHOLDER = /^📄\s*Template:\s*(.+)$/i;

/**
 * Os parâmetros originais ({{1}}, {{nome}}…) não foram gravados na época, só o
 * nome do template. Marca a lacuna em vez de deixar o `{{1}}` cru na conversa.
 */
function maskMissingParameters(text: string): string {
  return text
    .replace(/\{\{\s*[^}\s]+\s*\}\}/g, "…")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([,.;:!?])/g, "$1");
}

export async function repairTemplatePlaceholders(
  sessionName?: string,
  limit = 500
): Promise<TemplateRepairResult> {
  const empty = { session: "", scanned: 0, repaired: 0, unresolved: 0 };
  if (!prisma) return empty;

  const { getInboxSessionName } = await import("./inboxStore.js");
  const session = (sessionName ?? (await getInboxSessionName())).trim().toLowerCase();
  if (!session) return empty;

  const rows = await prisma.inboxMessage.findMany({
    where: {
      session,
      type: "chat",
      OR: [
        { body: { startsWith: "📄 Template:" } },
        { body: "📄 Mensagem com botões" },
        { body: "📄 Mensagem interativa" }
      ]
    },
    orderBy: { timestamp: "desc" },
    take: Math.min(Math.max(limit, 1), 2000),
    select: { id: true, body: true }
  });
  if (rows.length === 0) return { session, scanned: 0, repaired: 0, unresolved: 0 };

  // Um template repetido em N mensagens resolve com uma única ida à Meta
  // (getMetaTemplateDefinition cacheia por sessão + nome).
  const textByName = new Map<string, string | null>();
  let repaired = 0;
  let unresolved = 0;

  for (const row of rows) {
    const name = NAMED_PLACEHOLDER.exec(row.body.trim())?.[1]?.trim();
    if (!name) {
      unresolved++;
      continue;
    }

    if (!textByName.has(name)) {
      const hydrated = await hydrateMetaTemplateText({ session, name }).catch(() => null);
      textByName.set(name, hydrated ? maskMissingParameters(hydrated) : null);
    }

    const text = textByName.get(name);
    if (!text) {
      unresolved++;
      continue;
    }

    await prisma.inboxMessage.update({ where: { id: row.id }, data: { body: text } });
    repaired++;
  }

  console.log(
    `[inbox] repair-templates session=${session} scanned=${rows.length} repaired=${repaired} unresolved=${unresolved}`
  );

  return { session, scanned: rows.length, repaired, unresolved };
}
