import { prisma } from "../../prisma.js";

export type KnowledgeImportRow = {
  kind: string;
  topic: string | null;
  content: string;
  chatId: string;
  modality: string;
  sourceMsgId: string | null;
  createdAt: Date | null;
};

export type ImportKnowledgeResult = {
  imported: number;
  skipped: number;
  total: number;
};

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function rowFromJsonObject(raw: Record<string, unknown>): KnowledgeImportRow | null {
  const kind = String(raw.kind ?? "").trim();
  const content = String(raw.content ?? "").trim();
  const chatId = String(raw.chatId ?? "").trim();
  if (!kind || !content || !chatId) return null;

  const createdRaw = raw.createdAt;
  let createdAt: Date | null = null;
  if (typeof createdRaw === "string" && createdRaw.trim()) {
    const d = new Date(createdRaw);
    if (!Number.isNaN(d.getTime())) createdAt = d;
  }

  return {
    kind,
    topic: raw.topic != null && String(raw.topic).trim() ? String(raw.topic).trim() : null,
    content,
    chatId,
    modality: String(raw.modality ?? "text").trim() || "text",
    sourceMsgId:
      raw.sourceMsgId != null && String(raw.sourceMsgId).trim()
        ? String(raw.sourceMsgId).trim().slice(0, 240)
        : null,
    createdAt
  };
}

export function parseKnowledgeImport(content: string, format: "json" | "csv"): KnowledgeImportRow[] {
  const text = content.replace(/^\uFEFF/, "").trim();
  if (!text) return [];

  if (format === "json") {
    const parsed = JSON.parse(text) as unknown;
    const list = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { items?: unknown }).items)
        ? (parsed as { items: unknown[] }).items
        : [];

    return list
      .filter((x) => x && typeof x === "object")
      .map((x) => rowFromJsonObject(x as Record<string, unknown>))
      .filter((x): x is KnowledgeImportRow => x !== null);
  }

  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);

  const kindI = idx("kind");
  const contentI = idx("content");
  const chatI = idx("chatid");
  if (kindI < 0 || contentI < 0 || chatI < 0) {
    throw new Error("CSV inválido: colunas kind, content e chatId são obrigatórias");
  }

  const topicI = idx("topic");
  const modalityI = idx("modality");
  const sourceI = idx("sourcemsgid");
  const createdI = idx("createdat");

  const rows: KnowledgeImportRow[] = [];
  for (const line of lines.slice(1)) {
    const cols = parseCsvLine(line);
    const kind = (cols[kindI] ?? "").trim();
    const content = (cols[contentI] ?? "").trim();
    const chatId = (cols[chatI] ?? "").trim();
    if (!kind || !content || !chatId) continue;

    let createdAt: Date | null = null;
    if (createdI >= 0 && cols[createdI]?.trim()) {
      const d = new Date(cols[createdI]);
      if (!Number.isNaN(d.getTime())) createdAt = d;
    }

    rows.push({
      kind,
      topic: topicI >= 0 && cols[topicI]?.trim() ? cols[topicI].trim() : null,
      content,
      chatId,
      modality: modalityI >= 0 && cols[modalityI]?.trim() ? cols[modalityI].trim() : "text",
      sourceMsgId:
        sourceI >= 0 && cols[sourceI]?.trim() ? cols[sourceI].trim().slice(0, 240) : null,
      createdAt
    });
  }

  return rows;
}

export async function importKnowledgeForSession(params: {
  session: string;
  rows: KnowledgeImportRow[];
  mode: "merge" | "replace";
}): Promise<ImportKnowledgeResult> {
  if (!prisma) throw new Error("Banco indisponível");

  const session = params.session.trim().toLowerCase();
  if (params.mode === "replace") {
    await prisma.instanceAiKnowledge.deleteMany({ where: { session } });
  }

  let imported = 0;
  let skipped = 0;

  for (const row of params.rows) {
    if (params.mode === "merge") {
      if (row.sourceMsgId) {
        const dup = await prisma.instanceAiKnowledge.findFirst({
          where: { session, sourceMsgId: row.sourceMsgId }
        });
        if (dup) {
          skipped++;
          continue;
        }
      } else {
        const dup = await prisma.instanceAiKnowledge.findFirst({
          where: {
            session,
            chatId: row.chatId,
            kind: row.kind,
            content: row.content
          }
        });
        if (dup) {
          skipped++;
          continue;
        }
      }
    }

    await prisma.instanceAiKnowledge.create({
      data: {
        session,
        chatId: row.chatId,
        kind: row.kind,
        topic: row.topic,
        content: row.content,
        modality: row.modality,
        sourceMsgId: row.sourceMsgId,
        ...(row.createdAt ? { createdAt: row.createdAt } : {})
      }
    });
    imported++;
  }

  return { imported, skipped, total: params.rows.length };
}
