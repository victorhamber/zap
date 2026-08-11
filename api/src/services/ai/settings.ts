import { prisma } from "../../prisma.js";
import { env } from "../../env.js";
import type { AiMediaResponse, OfficialLink } from "../../types/ai.js";
import { isEncryptionConfigured } from "../secretCrypto.js";
import { decryptApiKey, encryptApiKey, maskApiKey } from "./crypto.js";
import { normalizeMediaResponsesForSave, parseMediaResponses } from "./mediaResponses.js";

export async function getActiveSessionName(): Promise<string> {
  if (!prisma) return "default";
  const s = await prisma.appSettings.findUnique({ where: { id: "default" } });
  return (s?.wppSession ?? "default").trim().toLowerCase();
}

function parseOfficialLinks(raw: unknown): OfficialLink[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x) => x && typeof x === "object")
    .map((x) => {
      const o = x as Record<string, unknown>;
      return {
        trigger: String(o.trigger ?? "").trim(),
        url: String(o.url ?? "").trim(),
        label: String(o.label ?? "").trim()
      };
    })
    .filter((l) => l.trigger && l.url);
}

export type AiSettingsDto = {
  session: string;
  enabled: boolean;
  learnEnabled: boolean;
  autoReplyEnabled: boolean;
  learnTagIds: string[];
  replyTagIds: string[];
  learnText: boolean;
  learnImage: boolean;
  learnAudio: boolean;
  learnVideo: boolean;
  replyText: boolean;
  replyImage: boolean;
  replyAudio: boolean;
  replyVideo: boolean;
  productContext: string;
  officialFacts: string;
  rulesAllowed: string;
  rulesForbidden: string;
  officialLinks: OfficialLink[];
  mediaResponses: AiMediaResponse[];
  openaiApiKeyMasked: string | null;
  hasOpenaiApiKey: boolean;
  encryptionReady: boolean;
  modelChat: string;
  modelVision: string;
  modelTranscribe: string;
  replyDelaySec: number;
  humanIdleSec: number;
  maxDailyReplies: number;
};

function toDto(row: NonNullable<Awaited<ReturnType<typeof loadSettingsRow>>>, session: string): AiSettingsDto {
  let masked: string | null = null;
  if (row.openaiApiKeyEnc) {
    try {
      masked = maskApiKey(decryptApiKey(row.openaiApiKeyEnc));
    } catch {
      masked = "sk-…";
    }
  }

  return {
    session,
    enabled: row.enabled,
    learnEnabled: row.learnEnabled,
    autoReplyEnabled: row.autoReplyEnabled,
    learnTagIds: row.learnTagIds,
    replyTagIds: Array.isArray(row.replyTagIds) ? row.replyTagIds : [],
    learnText: row.learnText,
    learnImage: row.learnImage,
    learnAudio: row.learnAudio,
    learnVideo: row.learnVideo,
    replyText: row.replyText,
    replyImage: row.replyImage,
    replyAudio: row.replyAudio,
    replyVideo: row.replyVideo,
    productContext: row.productContext,
    officialFacts: row.officialFacts,
    rulesAllowed: row.rulesAllowed,
    rulesForbidden: row.rulesForbidden,
    officialLinks: parseOfficialLinks(row.officialLinks),
    mediaResponses: parseMediaResponses(row.mediaResponses),
    openaiApiKeyMasked: masked,
    hasOpenaiApiKey: Boolean(row.openaiApiKeyEnc),
    encryptionReady: isEncryptionConfigured(),
    modelChat: row.modelChat,
    modelVision: row.modelVision,
    modelTranscribe: row.modelTranscribe,
    replyDelaySec: row.replyDelaySec,
    humanIdleSec: row.humanIdleSec,
    maxDailyReplies: row.maxDailyReplies
  };
}

async function loadSettingsRow(session: string) {
  if (!prisma) return null;
  return prisma.instanceAiSettings.findUnique({ where: { session } });
}

export async function getAiSettings(session?: string): Promise<AiSettingsDto> {
  const s = (session ?? (await getActiveSessionName())).trim().toLowerCase();
  const row = await loadSettingsRow(s);
  if (!row) {
    return toDto(
      {
        id: "",
        session: s,
        enabled: false,
        learnEnabled: false,
        autoReplyEnabled: false,
        learnTagIds: [],
        replyTagIds: [],
        learnText: true,
        learnImage: false,
        learnAudio: false,
        learnVideo: false,
        replyText: true,
        replyImage: true,
        replyAudio: true,
        replyVideo: true,
        productContext: "",
        officialFacts: "",
        rulesAllowed: "",
        rulesForbidden: "",
        officialLinks: [],
        mediaResponses: [],
        openaiApiKeyEnc: null,
        modelChat: "gpt-4o-mini",
        modelVision: "gpt-4o-mini",
        modelTranscribe: "whisper-1",
        replyDelaySec: env.AI_REPLY_DELAY_SEC,
        humanIdleSec: env.AI_HUMAN_IDLE_SEC,
        maxDailyReplies: env.AI_MAX_DAILY_REPLIES,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      s
    );
  }

  // Migração suave: installs antigas tinham mídia off por default.
  if (!row.replyAudio && !row.replyImage && !row.replyVideo && prisma) {
    await prisma.instanceAiSettings.update({
      where: { session: s },
      data: { replyAudio: true, replyImage: true, replyVideo: true }
    });
    const refreshed = await loadSettingsRow(s);
    if (refreshed) return toDto(refreshed, s);
  }

  return toDto(row, s);
}

export async function resolveOpenAiApiKey(session: string): Promise<string | null> {
  const row = await loadSettingsRow(session.trim().toLowerCase());
  if (!row?.openaiApiKeyEnc) return null;
  try {
    return decryptApiKey(row.openaiApiKeyEnc);
  } catch {
    return null;
  }
}

export async function saveAiSettings(
  session: string,
  body: Partial<AiSettingsDto> & { openaiApiKey?: string | null; clearOpenaiApiKey?: boolean }
): Promise<AiSettingsDto> {
  if (!prisma) throw new Error("Banco indisponível");
  const s = session.trim().toLowerCase();

  if (body.learnTagIds?.length) {
    const tags = await prisma.tag.findMany({
      where: { id: { in: body.learnTagIds } },
      select: { id: true }
    });
    const valid = new Set(tags.map((t) => t.id));
    const invalid = body.learnTagIds.filter((id) => !valid.has(id));
    if (invalid.length > 0) {
      throw new Error(`Tags de aprendizado inválidas: ${invalid.join(", ")}`);
    }
  }

  if (body.replyTagIds?.length) {
    const tags = await prisma.tag.findMany({
      where: { id: { in: body.replyTagIds } },
      select: { id: true }
    });
    const valid = new Set(tags.map((t) => t.id));
    const invalid = body.replyTagIds.filter((id) => !valid.has(id));
    if (invalid.length > 0) {
      throw new Error(`Tags de auto-resposta inválidas: ${invalid.join(", ")}`);
    }
  }

  const existing = await loadSettingsRow(s);
  let openaiApiKeyEnc = existing?.openaiApiKeyEnc ?? null;

  if (body.clearOpenaiApiKey) {
    if (existing?.learnEnabled || existing?.autoReplyEnabled) {
      throw new Error("Desative o aprendizado e a auto-resposta antes de remover a chave OpenAI");
    }
    openaiApiKeyEnc = null;
  } else if (body.openaiApiKey?.trim()) {
    try {
      openaiApiKeyEnc = encryptApiKey(body.openaiApiKey.trim());
    } catch {
      throw new Error(
        "Não foi possível criptografar a chave OpenAI. Verifique JWT_SECRET no servidor (mín. 32 caracteres)."
      );
    }
  }

  const data = {
    learnEnabled: body.learnEnabled ?? existing?.learnEnabled ?? false,
    autoReplyEnabled: body.autoReplyEnabled ?? existing?.autoReplyEnabled ?? false,
    learnTagIds: body.learnTagIds ?? existing?.learnTagIds ?? [],
    // [] é valor válido (sem tags de auto-resposta). Não espelhar learnTagIds.
    replyTagIds: body.replyTagIds !== undefined ? body.replyTagIds : (existing?.replyTagIds ?? []),
    learnText: body.learnText ?? existing?.learnText ?? true,
    learnImage: body.learnImage ?? existing?.learnImage ?? false,
    learnAudio: body.learnAudio ?? existing?.learnAudio ?? false,
    learnVideo: body.learnVideo ?? existing?.learnVideo ?? false,
    replyText: body.replyText ?? existing?.replyText ?? true,
    replyImage: body.replyImage ?? existing?.replyImage ?? true,
    replyAudio: body.replyAudio ?? existing?.replyAudio ?? true,
    replyVideo: body.replyVideo ?? existing?.replyVideo ?? true,
    productContext: body.productContext ?? existing?.productContext ?? "",
    officialFacts: body.officialFacts ?? existing?.officialFacts ?? "",
    rulesAllowed: body.rulesAllowed ?? existing?.rulesAllowed ?? "",
    rulesForbidden: body.rulesForbidden ?? existing?.rulesForbidden ?? "",
    officialLinks: body.officialLinks ?? parseOfficialLinks(existing?.officialLinks) ?? [],
    mediaResponses: body.mediaResponses
      ? normalizeMediaResponsesForSave(body.mediaResponses)
      : parseMediaResponses(existing?.mediaResponses),
    openaiApiKeyEnc,
    modelChat: body.modelChat ?? existing?.modelChat ?? "gpt-4o-mini",
    modelVision: body.modelVision ?? existing?.modelVision ?? "gpt-4o-mini",
    modelTranscribe: body.modelTranscribe ?? existing?.modelTranscribe ?? "whisper-1",
    replyDelaySec: body.replyDelaySec ?? existing?.replyDelaySec ?? env.AI_REPLY_DELAY_SEC,
    humanIdleSec: body.humanIdleSec ?? existing?.humanIdleSec ?? env.AI_HUMAN_IDLE_SEC,
    maxDailyReplies: body.maxDailyReplies ?? existing?.maxDailyReplies ?? env.AI_MAX_DAILY_REPLIES
  };

  const enabled = data.learnEnabled || data.autoReplyEnabled;

  if (data.learnEnabled && data.learnTagIds.length === 0) {
    throw new Error("Selecione ao menos uma tag para o aprendizado");
  }

  if (data.autoReplyEnabled && data.replyTagIds.length === 0) {
    throw new Error("Selecione ao menos uma tag para a auto-resposta");
  }

  if (enabled && !openaiApiKeyEnc) {
    throw new Error(
      "Configure a chave OpenAI desta instância (cada instância usa a chave do próprio usuário)"
    );
  }

  const persist = { ...data, enabled };

  await prisma.instanceAiSettings.upsert({
    where: { session: s },
    create: { session: s, ...persist },
    update: persist
  });

  return getAiSettings(s);
}
