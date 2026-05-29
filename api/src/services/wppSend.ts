import * as wpp from "./whatsapp/index.js";

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

function resolveChatId(chatId: string, isGroup?: boolean): string {
  if (chatId.includes("@")) return chatId;
  const clean = digitsOnly(chatId);
  if (!clean) return chatId;
  if (isGroup) return `${clean}@g.us`;
  return `${clean}@c.us`;
}

export type WppSendTarget = {
  phone: string;
  isGroup: boolean;
  isLid: boolean;
  isNewsletter: boolean;
  jid: string;
};

/** Monta destino para APIs do WPP (número + flags isLid / isGroup). */
export function buildWppSendTarget(chatId: string, isGroup?: boolean): WppSendTarget {
  const jid = resolveChatId(chatId, isGroup);
  const digits = digitsOnly(jid);
  const isGroupChat = isGroup === true || jid.endsWith("@g.us");
  const isNewsletter = jid.includes("@newsletter");
  const isLid =
    jid.endsWith("@lid") || (!isGroupChat && !isNewsletter && digits.length > 14);

  return {
    phone: digits || jid.replace(/@.*/, ""),
    isGroup: isGroupChat,
    isLid,
    isNewsletter,
    jid
  };
}

function parseWppErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  try {
    const json = raw.match(/\{[\s\S]*\}/)?.[0];
    if (json) {
      const o = JSON.parse(json) as { message?: string };
      if (o.message) return o.message;
    }
  } catch {
    /* ignore */
  }
  if (/não existe|not exist|chat_not_found/i.test(raw)) {
    return "Contato não encontrado no WhatsApp. Abra a conversa no celular e tente de novo.";
  }
  if (/InvalidMediaFileType/i.test(raw)) {
    return "Formato de áudio não aceito. Grave de novo ou envie um arquivo .ogg/.mp3 pelo anexo.";
  }
  return raw.slice(0, 200);
}

async function callSendMessage(
  target: WppSendTarget,
  message: string
): Promise<string | null> {
  const raw = await wpp.callSessionApi("/send-message", "POST", {
    phone: target.phone,
    message,
    isGroup: target.isGroup,
    isLid: target.isLid,
    isNewsletter: target.isNewsletter
  });
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const key = o.key;
  if (key && typeof key === "object") {
    const id = String((key as Record<string, unknown>).id ?? "").trim();
    if (id) return id;
  }
  const id = String(o.id ?? "").trim();
  return id || null;
}

/** Envia texto; se falhar com @c.us, tenta isLid (contatos novos do WhatsApp). */
export async function sendWppText(
  chatId: string,
  message: string,
  isGroup?: boolean
): Promise<string | null> {
  const primary = buildWppSendTarget(chatId, isGroup);
  try {
    return await callSendMessage(primary, message);
  } catch (first) {
    if (primary.isLid || primary.isGroup) {
      throw new Error(parseWppErrorMessage(first));
    }
    const lidRetry: WppSendTarget = { ...primary, isLid: true };
    try {
      return await callSendMessage(lidRetry, message);
    } catch (second) {
      throw new Error(parseWppErrorMessage(second));
    }
  }
}

export async function sendWppApi(
  path: string,
  body: Record<string, unknown>
): Promise<void> {
  await wpp.callSessionApi(path, "POST", body);
}
