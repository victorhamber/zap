/**
 * Provedor Evolution API v2 — substituto do WPPConnect quando WHATSAPP_PROVIDER=evolution
 */
import { prisma } from "../../prisma.js";
import { defaultWhatsAppSession, env } from "../../env.js";
import { evolutionApiKey, evolutionBaseUrl } from "./provider.js";
import {
  digitsOnly,
  evolutionSendNumber,
  isLikelyInternalLidJid,
  isValidWhatsAppPhoneDigits,
  normalizeDirectJid
} from "../waJid.js";
import {
  MEDIA_SEND_URL_THRESHOLD_BYTES,
  fetchRemoteMediaBase64,
  loadUploadMediaBase64,
  publicUploadUrl,
  rewriteUploadUrlForWpp,
  uploadFilenameFromUrl
} from "../uploads.js";
import { brazilPhoneVariants, canonicalBrazilPhone } from "../../utils/phone.js";
import { getWppInstanceConfig } from "./wppInstanceConfig.js";

export const MSG_NO_DEVICE =
  "Nenhum WhatsApp conectado na Evolution. Crie/conecte a instância e escaneie o QR.";
export const MSG_NO_SESSION_CLOSE = "Sessão já está desconectada na Evolution.";
export const MSG_NO_SESSION_LOGOUT = "Sessão já está deslogada na Evolution.";
export const MSG_QR_TIMEOUT = "QR expirou. Clique em Conectar / Mostrar QR de novo.";
export const MSG_WPP_NO_QR = "Evolution não retornou QR. Verifique logs do serviço Evolution.";
export const MSG_WPP_AGGREGATE_BOOT = "Erro ao subir instâncias na Evolution.";
export const MSG_BROWSER_PROFILE_LOCK = "Perfil Chrome travado (não se aplica à Evolution Baileys).";

export function isWppNetworkError(message: string): boolean {
  return /fetch failed|econnrefused|network|502|503/i.test(message);
}

export function isWppBrowserLockError(_message: string): boolean {
  return false;
}

export function isWppBrokenClientError(_message: string): boolean {
  return false;
}

export function mapWppErrorMessage(message: string): string {
  return message.slice(0, 400);
}

export function isDisconnectedState(state: string): boolean {
  const s = state.toUpperCase();
  return s.includes("DISCONNECT") || s.includes("CLOSE") || s === "UNPAIRED";
}

export function isPhoneUnlinkedStatus(status: string): boolean {
  return /unpair|logout|not.?logged/i.test(status);
}

export async function clearWppStoredAuth(connectionStatus: string): Promise<void> {
  if (!prisma) return;
  await prisma.appSettings.update({
    where: { id: "default" },
    data: { wppToken: "evolution", connectionStatus }
  });
}

export function isPairingQuiet(): boolean {
  return false;
}

export function isStablePhoneConnectionState(state: string): boolean {
  const s = state.toUpperCase();
  return s === "OPEN" || s.includes("CONNECTED:OPEN") || s === "CONNECTED";
}

export async function markSessionRequiresQr(reason: string): Promise<void> {
  if (!prisma) return;
  await prisma.appSettings.update({
    where: { id: "default" },
    data: { connectionStatus: `AWAITING_QR:${reason}`, wppToken: "evolution" }
  });
}

export async function handleWppLifecycleWebhook(_body: Record<string, unknown>): Promise<boolean> {
  return false;
}

export function httpErrorMeansNoSession(status: number): boolean {
  return status === 404;
}

export function formatWppError(status: number, body: unknown): string {
  const parts: string[] = [];

  if (typeof body === "string" && body.trim()) {
    parts.push(body.trim());
  } else if (typeof body === "object" && body) {
    const o = body as Record<string, unknown>;
    if (o.message) parts.push(String(o.message));
    if (o.error) parts.push(String(o.error));
    const response = o.response;
    if (Array.isArray(response) && response[0] && typeof response[0] === "object") {
      const r0 = response[0] as Record<string, unknown>;
      if (r0.message) parts.push(String(r0.message));
      if (r0.exists === false) parts.push("número sem WhatsApp");
    }
  }

  if (parts.length) return `HTTP ${status}: ${parts.join(" — ").slice(0, 380)}`;
  try {
    const raw = JSON.stringify(body);
    if (raw && raw !== "{}") return `HTTP ${status}: ${raw.slice(0, 380)}`;
  } catch {
    /* ignore */
  }
  return `HTTP ${status}`;
}

async function getInstanceName(): Promise<string> {
  if (!prisma) return defaultWhatsAppSession();
  const s = await prisma.appSettings.findUnique({ where: { id: "default" } });
  return (s?.wppSession ?? defaultWhatsAppSession()).trim().toLowerCase();
}

async function evoFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const base = evolutionBaseUrl();
  const url = `${base}${path.startsWith("/") ? path : `/${path}`}`;
  const headers: Record<string, string> = {
    accept: "application/json",
  };
  if (init.body) headers["content-type"] = "application/json";
  const key = evolutionApiKey();
  if (key) headers.apikey = key;

  return fetch(url, {
    ...init,
    headers: { ...headers, ...(init.headers as Record<string, string>) }
  });
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => "");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { message: text };
  }
}

function inboundWebhookUrl(): string {
  const internal = env.ZAP_INTERNAL_URL?.replace(/\/$/, "");
  if (internal) return `${internal}/api/webhooks/evolution`;
  return `${env.APP_PUBLIC_URL.replace(/\/$/, "")}/api/webhooks/evolution`;
}

export async function getActiveWppSessionName(): Promise<string> {
  return getInstanceName();
}

export async function setActiveSession(sessionName: string): Promise<void> {
  const name = sessionName.trim().toLowerCase();
  if (!prisma) return;
  await prisma.appSettings.update({
    where: { id: "default" },
    data: { wppSession: name, wppToken: "evolution" }
  });
  await ensureInstanceExists(name);
}

async function ensureInstanceExists(instance: string): Promise<void> {
  const list = await listServerSessions().catch(() => []);
  const names = parseWppServerSessionNames(list);
  const cfg = await getWppInstanceConfig(instance);

  if (cfg?.integration === "business") {
    if (!cfg.metaAccessToken || !cfg.metaPhoneNumberId || !cfg.metaBusinessId) {
      throw new Error(
        "Configure Access Token, Phone Number ID e Business ID no painel (API oficial Meta)."
      );
    }

    if (names.includes(instance)) {
      await evoFetch(`/instance/delete/${encodeURIComponent(instance)}`, { method: "DELETE" }).catch(
        () => {}
      );
    }

    const res = await evoFetch("/instance/create", {
      method: "POST",
      body: JSON.stringify({
        instanceName: instance,
        integration: "WHATSAPP-BUSINESS",
        token: cfg.metaAccessToken,
        number: cfg.metaPhoneNumberId,
        businessId: cfg.metaBusinessId,
        qrcode: false
      })
    });
    if (!res.ok && res.status !== 403) {
      const body = await readJson(res);
      const msg = formatWppError(res.status, body);
      if (!/already exists|já existe/i.test(msg)) {
        throw new Error(`Evolution create business instance: ${msg}`);
      }
    }
    return;
  }

  if (names.includes(instance)) return;

  const res = await evoFetch("/instance/create", {
    method: "POST",
    body: JSON.stringify({
      instanceName: instance,
      integration: "WHATSAPP-BAILEYS",
      qrcode: true
    })
  });
  if (!res.ok && res.status !== 403) {
    const body = await readJson(res);
    const msg = formatWppError(res.status, body);
    if (!/already exists|já existe/i.test(msg)) {
      throw new Error(`Evolution create instance: ${msg}`);
    }
  }
}

export async function refreshWppToken(_sessionOverride?: string): Promise<string> {
  if (!evolutionApiKey()) {
    throw new Error("EVOLUTION_API_KEY não configurada no serviço zap.");
  }
  const instance = await getInstanceName();
  await ensureInstanceExists(instance);
  if (prisma) {
    await prisma.appSettings.update({
      where: { id: "default" },
      data: { wppToken: "evolution", connectionStatus: "token_ok" }
    });
  }
  return "evolution";
}

export async function getWppToken(): Promise<string> {
  return refreshWppToken();
}

async function resolveEvolutionSendNumber(chatId: string, isGroup?: boolean): Promise<string> {
  const jid = normalizeDirectJid(chatId.trim());
  if (isGroup || jid.endsWith("@g.us")) {
    return evolutionSendNumber(jid, true);
  }

  const d = digitsOnly(jid);
  if (isValidWhatsAppPhoneDigits(d)) return d;

  if (jid.endsWith("@lid") || isLikelyInternalLidJid(jid)) {
    const instance = await getInstanceName();
    const query = jid.includes("@") ? jid : `${d}@lid`;
    const res = await evoFetch(`/chat/whatsappNumbers/${encodeURIComponent(instance)}`, {
      method: "POST",
      body: JSON.stringify({ numbers: [query] })
    });
    const data = await readJson(res);
    const list = Array.isArray(data)
      ? data
      : Array.isArray((data as Record<string, unknown>).response)
        ? ((data as Record<string, unknown>).response as unknown[])
        : [];
    const first = list[0] as Record<string, unknown> | undefined;
    const resolved = String(first?.jid ?? first?.number ?? "").trim();
    if (resolved && !isLikelyInternalLidJid(resolved)) {
      return evolutionSendNumber(resolved, false);
    }
    throw new Error(
      "Contato com ID interno (@lid). Abra a conversa pelo nome/número real (ex.: Victor Hamber) ou aguarde uma mensagem recebida desse contato."
    );
  }

  return evolutionSendNumber(jid, false);
}

/** Resolve @lid → JID de telefone real via Evolution API. */
export async function resolveEvolutionPeerJid(
  chatId: string,
  isGroup?: boolean
): Promise<string | null> {
  try {
    const num = await resolveEvolutionSendNumber(chatId, isGroup);
    if (num.includes("@")) return normalizeDirectJid(num);
    const d = digitsOnly(num);
    if (isValidWhatsAppPhoneDigits(d)) return `${d}@s.whatsapp.net`;
  } catch {
    return null;
  }
  return null;
}

function toEvolutionNumber(chatId: string, isGroup?: boolean): string {
  return evolutionSendNumber(chatId, isGroup);
}

export function extractEvolutionSentMessageId(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const candidates = [o.key, (o.message as Record<string, unknown> | undefined)?.key, o];
  for (const key of candidates) {
    if (!key || typeof key !== "object") continue;
    const id = String((key as Record<string, unknown>).id ?? "").trim();
    if (id) return id.slice(0, 240);
  }
  const direct = String(o.id ?? o.messageId ?? "").trim();
  return direct ? direct.slice(0, 240) : null;
}

export async function markEvolutionChatAsRead(
  chatId: string,
  waMessageIds: Array<{ id: string; remoteJid: string; fromMe?: boolean }>
): Promise<void> {
  if (waMessageIds.length === 0) return;
  const instance = await getInstanceName();
  const readMessages = waMessageIds.map((m) => ({
    id: m.id,
    remoteJid: normalizeDirectJid(m.remoteJid),
    fromMe: m.fromMe === true
  }));
  await evoFetch(`/chat/markMessageAsRead/${encodeURIComponent(instance)}`, {
    method: "POST",
    body: JSON.stringify({ readMessages })
  }).catch(() => {});
}

export async function sendText(phone: string, message: string): Promise<string | null> {
  const text = String(message ?? "").trim();
  if (!text) throw new Error("sendText: mensagem vazia");

  const instance = await getInstanceName();
  let number = await resolveEvolutionSendNumber(phone);
  const d = digitsOnly(number);
  if (d.startsWith("55") && d.length >= 12) {
    number = canonicalBrazilPhone(d);
  }
  const res = await evoFetch(`/message/sendText/${encodeURIComponent(instance)}`, {
    method: "POST",
    body: JSON.stringify({
      number,
      text
    })
  });
  const data = await readJson(res);
  if (!res.ok) throw new Error(`sendText: ${formatWppError(res.status, data)}`);
  return extractEvolutionSentMessageId(data);
}

function inferMimeType(fileName?: string, mimeHint?: string): string {
  const mime = String(mimeHint ?? "").trim();
  if (mime) return mime;
  const fn = String(fileName ?? "").toLowerCase();
  if (/\.jpe?g(\?|$)/.test(fn)) return "image/jpeg";
  if (/\.png(\?|$)/.test(fn)) return "image/png";
  if (/\.webp(\?|$)/.test(fn)) return "image/webp";
  if (/\.gif(\?|$)/.test(fn)) return "image/gif";
  if (/\.mp4(\?|$)/.test(fn)) return "video/mp4";
  if (/\.webm(\?|$)/.test(fn)) return "video/webm";
  if (/\.mov(\?|$)/.test(fn)) return "video/quicktime";
  if (/\.pdf(\?|$)/.test(fn)) return "application/pdf";
  return "application/octet-stream";
}

const IMAGE_INLINE_BASE64_MAX_BYTES = 16 * 1024 * 1024;
const WHATSAPP_CAPTION_MAX_CHARS = 1024;
/** Espaço mínimo entre sendMedia — evita HTTP 400 intermitente em broadcast. */
const MEDIA_SEND_MIN_GAP_MS = 3500;

type ResolvedMediaInput = { media: string; mimeType: string; fileName: string };
const mediaInputCache = new Map<string, Promise<ResolvedMediaInput>>();
let lastMediaSendAt = 0;
let mediaSendMutex: Promise<void> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Evolution baixa a mídia pela internet — URL pública é mais confiável que zap:3000 interno. */
function mediaUrlForEvolution(publicOrInternalUrl: string): string {
  const name = uploadFilenameFromUrl(publicOrInternalUrl);
  if (name) return publicUploadUrl(name);
  return publicOrInternalUrl;
}

async function readLocalUploadBase64(
  url: string
): Promise<{ base64: string; filename: string } | null> {
  for (let i = 0; i < 4; i++) {
    const local = await loadUploadMediaBase64(url);
    if (local?.base64) return local;
    await sleep(120 * (i + 1));
  }
  return null;
}

function invalidateMediaInputCache(media: string, mimeHint?: string, fileNameHint?: string): void {
  mediaInputCache.delete(`${media}|${mimeHint ?? ""}|${fileNameHint ?? ""}`);
}

async function waitMediaSendSlot(): Promise<void> {
  mediaSendMutex = mediaSendMutex.then(async () => {
    const now = Date.now();
    const wait = Math.max(0, lastMediaSendAt + MEDIA_SEND_MIN_GAP_MS - now);
    if (wait > 0) await sleep(wait);
    lastMediaSendAt = Date.now();
  });
  await mediaSendMutex;
}

function phoneSendVariants(phone: string): string[] {
  const d = digitsOnly(phone);
  if (d.startsWith("55")) {
    return [...new Set([d, ...brazilPhoneVariants(d)].filter(Boolean))];
  }
  return d ? [d] : [phone.trim()];
}

function isRetriableSendError(status: number, message: string): boolean {
  // HTTP 400 em sendMedia costuma ser limite/race da Evolution no broadcast, não telefone inválido.
  if ([400, 429, 502, 503, 504].includes(status)) return true;
  const m = message.toLowerCase();
  return /timeout|econnreset|fetch failed|network|rate|busy|media/i.test(m);
}

function isRetriablePhoneVariantError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("not exist") ||
    m.includes("does not exist") ||
    m.includes("invalid number") ||
    m.includes("número sem whatsapp") ||
    m.includes("no whatsapp") ||
    m.includes("is not on whatsapp")
  );
}

function truncateCaption(caption?: string): string {
  if (!caption) return "";
  return caption.length > WHATSAPP_CAPTION_MAX_CHARS
    ? caption.slice(0, WHATSAPP_CAPTION_MAX_CHARS)
    : caption;
}

async function resolveEvolutionMediaInput(
  media: string,
  mimeHint?: string,
  fileNameHint?: string
): Promise<{ media: string; mimeType: string; fileName: string }> {
  const fromUrl = uploadFilenameFromUrl(media);
  const fileName = String(fileNameHint ?? "").trim() || fromUrl || "arquivo";
  let mimeType = inferMimeType(fileName, mimeHint);

  if (media.startsWith("data:")) {
    const match = media.match(/^data:([^;]+);base64,(.+)$/s);
    if (match) {
      return {
        media: match[2].replace(/\s/g, ""),
        mimeType: match[1],
        fileName
      };
    }
  }

  if (media.startsWith("http://") || media.startsWith("https://")) {
    const local = await readLocalUploadBase64(media);
    if (local?.base64) {
      const bytes = Buffer.byteLength(local.base64, "base64");
      const effectiveMime = inferMimeType(local.filename, mimeHint);
      const isVideo = effectiveMime.startsWith("video/");
      const isImage = effectiveMime.startsWith("image/");
      const inlineMax = isVideo
        ? MEDIA_SEND_URL_THRESHOLD_BYTES
        : isImage
          ? IMAGE_INLINE_BASE64_MAX_BYTES
          : MEDIA_SEND_URL_THRESHOLD_BYTES;
      if (bytes <= inlineMax) {
        return {
          media: local.base64,
          mimeType: effectiveMime,
          fileName: fileNameHint?.trim() || local.filename
        };
      }
    }

    const effectiveMime = inferMimeType(fromUrl ?? fileName, mimeHint);
    if (effectiveMime.startsWith("image/")) {
      const remote = await fetchRemoteMediaBase64(media, IMAGE_INLINE_BASE64_MAX_BYTES);
      if (remote?.base64) {
        return {
          media: remote.base64,
          mimeType: remote.mimeType || effectiveMime,
          fileName: fromUrl ?? fileName
        };
      }
    }

    const resolvedMime = inferMimeType(fromUrl ?? fileName, mimeHint);
    return {
      media: mediaUrlForEvolution(media),
      mimeType: resolvedMime,
      fileName: fromUrl ?? fileName
    };
  }

  const stripped = media.replace(/\s/g, "");
  if (stripped.length > 64 && !stripped.includes("/")) {
    return { media: stripped, mimeType, fileName };
  }

  return { media, mimeType, fileName };
}

async function resolveEvolutionMediaInputCached(
  media: string,
  mimeHint?: string,
  fileNameHint?: string
): Promise<ResolvedMediaInput> {
  const cacheKey = `${media}|${mimeHint ?? ""}|${fileNameHint ?? ""}`;
  let pending = mediaInputCache.get(cacheKey);
  if (!pending) {
    pending = resolveEvolutionMediaInput(media, mimeHint, fileNameHint);
    mediaInputCache.set(cacheKey, pending);
    void pending.catch(() => mediaInputCache.delete(cacheKey));
  }
  return pending;
}

async function postSendMedia(
  instance: string,
  payload: Record<string, unknown>,
  label: string
): Promise<string | null> {
  let lastError = `${label}: HTTP error`;

  for (let attempt = 0; attempt < 7; attempt++) {
    await waitMediaSendSlot();
    const res = await evoFetch(`/message/sendMedia/${encodeURIComponent(instance)}`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    const data = await readJson(res);
    if (res.ok) return extractEvolutionSentMessageId(data);

    lastError = `${label}: ${formatWppError(res.status, data)}`;
    if (attempt < 6 && isRetriableSendError(res.status, lastError)) {
      await sleep(1500 * (attempt + 1));
      continue;
    }
    throw new Error(lastError);
  }

  throw new Error(lastError);
}

async function sendImageOnce(
  phone: string,
  url: string,
  caption?: string,
  opts?: { mimeType?: string; fileName?: string }
): Promise<string | null> {
  const instance = await getInstanceName();
  const number = await resolveEvolutionSendNumber(phone);
  const resolved = await resolveEvolutionMediaInputCached(url, opts?.mimeType, opts?.fileName);
  return postSendMedia(
    instance,
    {
      number,
      mediatype: "image",
      media: resolved.media,
      mimetype: resolved.mimeType,
      fileName: resolved.fileName,
      caption: truncateCaption(caption)
    },
    "sendMedia image"
  );
}

async function resolveImageMediaForcedBase64(
  url: string,
  opts?: { mimeType?: string; fileName?: string }
): Promise<ResolvedMediaInput | null> {
  invalidateMediaInputCache(url, opts?.mimeType, opts?.fileName);

  const local = await readLocalUploadBase64(url);
  if (local?.base64) {
    const mimeType = inferMimeType(local.filename, opts?.mimeType);
    return {
      media: local.base64,
      mimeType,
      fileName: opts?.fileName?.trim() || local.filename
    };
  }

  const remote = await fetchRemoteMediaBase64(url, IMAGE_INLINE_BASE64_MAX_BYTES);
  if (remote?.base64) {
    const fromUrl = uploadFilenameFromUrl(url);
    return {
      media: remote.base64,
      mimeType: remote.mimeType || inferMimeType(fromUrl ?? opts?.fileName, opts?.mimeType),
      fileName: opts?.fileName?.trim() || fromUrl || "imagem.jpg"
    };
  }

  return null;
}

async function sendImageOnceForceBase64(
  phone: string,
  url: string,
  caption?: string,
  opts?: { mimeType?: string; fileName?: string }
): Promise<string | null> {
  const forced = await resolveImageMediaForcedBase64(url, opts);
  if (!forced) return null;

  const instance = await getInstanceName();
  const number = await resolveEvolutionSendNumber(phone);
  return postSendMedia(
    instance,
    {
      number,
      mediatype: "image",
      media: forced.media,
      mimetype: forced.mimeType,
      fileName: forced.fileName,
      caption: truncateCaption(caption)
    },
    "sendMedia image"
  );
}

function isHttp400MediaError(message: string): boolean {
  return /sendMedia image:\s*HTTP 400/i.test(message);
}

export async function sendImage(
  phone: string,
  url: string,
  caption?: string,
  opts?: { mimeType?: string; fileName?: string }
): Promise<string | null> {
  const variants = phoneSendVariants(phone);
  let lastErr: Error | null = null;

  for (let i = 0; i < variants.length; i++) {
    const variant = variants[i];
    try {
      return await sendImageOnce(variant, url, caption, opts);
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (isHttp400MediaError(lastErr.message)) {
        try {
          const fallback = await sendImageOnceForceBase64(variant, url, caption, opts);
          if (fallback !== null) return fallback;
        } catch (fallbackErr) {
          lastErr = fallbackErr instanceof Error ? fallbackErr : new Error(String(fallbackErr));
        }
      }
      if (i < variants.length - 1 && isRetriablePhoneVariantError(lastErr.message)) {
        continue;
      }
      throw new Error(`${lastErr.message} (tel. ${phone})`);
    }
  }

  throw lastErr ?? new Error(`sendMedia image falhou (tel. ${phone})`);
}

export async function sendVideo(
  phone: string,
  url: string,
  caption?: string,
  opts?: { mimeType?: string; fileName?: string }
): Promise<string | null> {
  const instance = await getInstanceName();
  const number = await resolveEvolutionSendNumber(phone);
  const resolved = await resolveEvolutionMediaInputCached(url, opts?.mimeType, opts?.fileName);
  return postSendMedia(
    instance,
    {
      number,
      mediatype: "video",
      media: resolved.media,
      mimetype: resolved.mimeType,
      fileName: resolved.fileName,
      caption: truncateCaption(caption)
    },
    "sendMedia video"
  );
}

export async function sendAudio(phone: string, media: string): Promise<string | null> {
  const instance = await getInstanceName();
  const number = await resolveEvolutionSendNumber(phone);

  let audio: string;
  if (media.startsWith("data:")) {
    const match = media.match(/^data:[^;]+;base64,(.+)$/s);
    audio = match ? match[1].replace(/\s/g, "") : media;
  } else if (media.startsWith("http://") || media.startsWith("https://")) {
    audio = rewriteUploadUrlForWpp(media);
  } else {
    audio = media.replace(/\s/g, "");
  }

  const res = await evoFetch(
    `/message/sendWhatsAppAudio/${encodeURIComponent(instance)}`,
    {
      method: "POST",
      body: JSON.stringify({
        number,
        audio,
        encoding: true
      })
    }
  );
  const data = await readJson(res);
  if (!res.ok) throw new Error(`sendWhatsAppAudio: ${formatWppError(res.status, data)}`);
  return extractEvolutionSentMessageId(data);
}

export async function sendDocument(
  phone: string,
  url: string,
  caption?: string,
  fileName?: string,
  opts?: { mimeType?: string }
): Promise<string | null> {
  const instance = await getInstanceName();
  const number = await resolveEvolutionSendNumber(phone);
  const name = fileName ?? "documento";
  const resolved = await resolveEvolutionMediaInput(url, opts?.mimeType, name);
  const res = await evoFetch(`/message/sendMedia/${encodeURIComponent(instance)}`, {
    method: "POST",
    body: JSON.stringify({
      number,
      mediatype: "document",
      media: resolved.media,
      mimetype: resolved.mimeType,
      caption: caption ?? "",
      fileName: resolved.fileName
    })
  });
  const data = await readJson(res);
  if (!res.ok) throw new Error(`sendMedia document: ${formatWppError(res.status, data)}`);
  return extractEvolutionSentMessageId(data);
}

function phoneFromCallBody(b: Record<string, unknown>): string {
  return String(b.phone ?? b.chatId ?? "");
}

function mediaFromCallBody(b: Record<string, unknown>): {
  media: string;
  mimeType: string;
  fileName: string;
} {
  const path = String(b.path ?? "").trim();
  const base64 = String(b.base64Ptt ?? b.base64 ?? "").trim();
  const fileName = String(b.filename ?? b.fileName ?? "arquivo").trim() || "arquivo";
  const mimeType = inferMimeType(
    fileName,
    String(b.mimetype ?? b.mimeType ?? b.mime ?? "")
  );

  if (base64) {
    if (base64.startsWith("data:")) {
      const match = base64.match(/^data:([^;]+);base64,(.+)$/s);
      if (match) {
        return {
          media: match[2].replace(/\s/g, ""),
          mimeType: match[1],
          fileName
        };
      }
    }
    return { media: base64.replace(/\s/g, ""), mimeType, fileName };
  }
  if (path) {
    return { media: rewriteUploadUrlForWpp(path), mimeType, fileName };
  }
  throw new Error("Mídia sem path ou base64");
}

/** Áudio PTT — mantém data URI quando necessário. */
function mediaUrlFromCallBody(b: Record<string, unknown>): string {
  const path = String(b.path ?? "").trim();
  const base64 = String(b.base64Ptt ?? b.base64 ?? "").trim();
  if (base64) {
    if (base64.startsWith("data:")) return base64;
    return `data:audio/ogg;base64,${base64.replace(/\s/g, "")}`;
  }
  if (path) return rewriteUploadUrlForWpp(path);
  throw new Error("Mídia sem path ou base64");
}

export async function checkConnection(): Promise<unknown> {
  const instance = await getInstanceName();
  const res = await evoFetch(
    `/instance/connectionState/${encodeURIComponent(instance)}`,
    { method: "GET" }
  );
  const body = await readJson(res);
  if (!res.ok) throw new Error(formatWppError(res.status, body));
  return body;
}

export function isWppConnectedState(state: string): boolean {
  const s = state.toUpperCase();
  return s === "OPEN" || s.includes("CONNECTED");
}

export function parseConnectionCheck(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const o = data as Record<string, unknown>;
  const inst = o.instance as Record<string, unknown> | undefined;
  const state = String(inst?.state ?? o.state ?? "").toLowerCase();
  return state === "open";
}

export function sessionNeedsQr(state: string): boolean {
  const s = state.toUpperCase();
  return s.includes("QR") || s === "CONNECTING" || s === "CLOSE";
}

export async function verifyActiveSession() {
  try {
    const raw = await checkConnection();
    const state = extractSessionState(raw);
    const connected = parseConnectionCheck(raw);
    return {
      connected,
      connecting: state.toUpperCase().includes("CONNECT"),
      ghostSession: false,
      wppReachable: true,
      message: connected ? "Conectado (Evolution)" : `Estado: ${state}`,
      phoneConnected: connected,
      sessionAlive: true,
      sessionStatus: state,
      state,
      browserLock: false
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      connected: false,
      connecting: false,
      ghostSession: false,
      wppReachable: !isWppNetworkError(msg),
      message: msg,
      phoneConnected: false,
      sessionAlive: false,
      sessionStatus: "UNKNOWN",
      state: "UNKNOWN",
      browserLock: false
    };
  }
}

export async function registerInboundWebhook(): Promise<{
  url: string;
  ok: boolean;
  detail?: string;
}> {
  const url = inboundWebhookUrl();
  if (!env.ZAP_INTERNAL_URL?.trim()) {
    return {
      url,
      ok: false,
      detail: "Defina ZAP_INTERNAL_URL (ex.: http://zap_zap:3000) para a Evolution chamar o webhook."
    };
  }
  const instance = await getInstanceName();
  await ensureInstanceExists(instance);

  // Se exigimos segredo no webhook, a Evolution precisa mandá-lo de volta —
  // senão o painel se auto-bloquearia e o inbox pararia sem aviso.
  const webhookSecret = env.WHATSAPP_WEBHOOK_SECRET?.trim();

  const res = await evoFetch(`/webhook/set/${encodeURIComponent(instance)}`, {
    method: "POST",
    body: JSON.stringify({
      webhook: {
        enabled: true,
        url,
        webhookByEvents: false,
        webhookBase64: true,
        ...(webhookSecret ? { headers: { "x-webhook-secret": webhookSecret } } : {}),
        events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE", "QRCODE_UPDATED", "SEND_MESSAGE"]
      }
    })
  });
  const body = await readJson(res);
  if (!res.ok) {
    return { url, ok: false, detail: formatWppError(res.status, body) };
  }
  return { url, ok: true, detail: "evolution_webhook_set" };
}

export function getInboundWebhookDiagnostics(): {
  webhookUrl: string;
  webhookPublic: string | null;
  needsInternalUrl: boolean;
} {
  const url = inboundWebhookUrl();
  return {
    webhookUrl: url,
    webhookPublic: env.APP_PUBLIC_URL ? `${env.APP_PUBLIC_URL.replace(/\/$/, "")}/api/webhooks/evolution` : null,
    needsInternalUrl: !env.ZAP_INTERNAL_URL?.trim()
  };
}

export function extractQrImage(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const base64 = o.base64 ?? o.qrcode ?? (o.qrcode as Record<string, unknown>)?.base64;
  if (typeof base64 === "string" && base64.length > 40) {
    return base64.startsWith("data:") ? base64 : `data:image/png;base64,${base64}`;
  }
  const nested = o.response ?? o.data;
  if (nested && typeof nested === "object") return extractQrImage(nested);
  return null;
}

export function extractSessionState(data: unknown): string {
  if (!data || typeof data !== "object") return "UNKNOWN";
  const o = data as Record<string, unknown>;
  const inst = o.instance as Record<string, unknown> | undefined;
  const state = inst?.state ?? o.state ?? o.status;
  if (typeof state === "string") return state.toUpperCase();
  return "UNKNOWN";
}

export async function startSession(_options?: {
  waitQrCode?: boolean;
  force?: boolean;
}): Promise<unknown> {
  const instance = await getInstanceName();
  const cfg = await getWppInstanceConfig(instance);
  await ensureInstanceExists(instance);
  await registerInboundWebhook().catch(() => {});

  if (cfg?.integration === "business") {
    const stateRes = await checkConnection().catch(() => null);
    const connected = stateRes ? parseConnectionCheck(stateRes) : true;
    const state = stateRes ? extractSessionState(stateRes) : "OPEN";
    if (prisma) {
      await prisma.appSettings.update({
        where: { id: "default" },
        data: {
          connectionStatus: connected ? `CONNECTED:${state}` : "CONNECTED:BUSINESS",
          wppToken: "evolution"
        }
      });
    }
    return { state, connected: true, integration: "business" };
  }

  const res = await evoFetch(`/instance/connect/${encodeURIComponent(instance)}`, {
    method: "GET"
  });
  const body = await readJson(res);
  if (!res.ok) throw new Error(formatWppError(res.status, body));

  const stateRes = await checkConnection().catch(() => null);
  const state = stateRes ? extractSessionState(stateRes) : "CONNECTING";
  if (prisma) {
    await prisma.appSettings.update({
      where: { id: "default" },
      data: {
        connectionStatus: parseConnectionCheck(stateRes) ? `CONNECTED:${state}` : `AWAITING_QR:${state}`,
        wppToken: "evolution"
      }
    });
  }
  return { ...((body as object) ?? {}), state, qrcode: extractQrImage(body) };
}

export async function getQrCode(): Promise<{ qrImage: string | null; raw: unknown }> {
  const instance = await getInstanceName();
  const cfg = await getWppInstanceConfig(instance);
  if (cfg?.integration === "business") {
    return { qrImage: null, raw: { integration: "business", message: "API oficial — sem QR" } };
  }
  const res = await evoFetch(`/instance/connect/${encodeURIComponent(instance)}`, {
    method: "GET"
  });
  const raw = await readJson(res);
  return { qrImage: extractQrImage(raw), raw };
}

export async function fetchQrFromSessionStatus(): Promise<string | null> {
  const { qrImage } = await getQrCode();
  return qrImage;
}

export async function waitForQrImageAfterStart(): Promise<{
  qrImage: string | null;
  state?: string;
  raw: unknown;
}> {
  await new Promise((r) => setTimeout(r, 1500));
  const { qrImage, raw } = await getQrCode();
  const state = extractSessionState(raw);
  return { qrImage, state, raw };
}

export async function getSessionStatus(): Promise<unknown> {
  return checkConnection();
}

export async function closeSession(): Promise<{ raw?: unknown; noSession: boolean }> {
  const instance = await getInstanceName();
  const res = await evoFetch(`/instance/logout/${encodeURIComponent(instance)}`, {
    method: "DELETE"
  });
  const raw = await readJson(res);
  if (prisma) {
    await prisma.appSettings.update({
      where: { id: "default" },
      data: { connectionStatus: "DISCONNECTED:logout" }
    });
  }
  return { raw, noSession: res.status === 404 };
}

export async function logoutSession(): Promise<{ raw?: unknown; noSession: boolean }> {
  return closeSession();
}

export function parseWppServerSessionNames(serverPayload: unknown): string[] {
  const names: string[] = [];
  let list: unknown[] = [];
  if (Array.isArray(serverPayload)) list = serverPayload;
  else if (serverPayload && typeof serverPayload === "object") {
    const o = serverPayload as Record<string, unknown>;
    if (Array.isArray(o.response)) list = o.response;
    else if (Array.isArray(o.instances)) list = o.instances;
  }
  for (const item of list) {
    if (typeof item === "string") {
      names.push(item.trim().toLowerCase());
      continue;
    }
    if (item && typeof item === "object") {
      const n = String(
        (item as Record<string, unknown>).instanceName ??
          (item as Record<string, unknown>).name ??
          ""
      )
        .trim()
        .toLowerCase();
      if (n) names.push(n);
    }
  }
  return [...new Set(names)];
}

export async function listServerSessions(): Promise<unknown> {
  const res = await evoFetch("/instance/fetchInstances", { method: "GET" });
  const body = await readJson(res);
  if (!res.ok) throw new Error(formatWppError(res.status, body));
  return body;
}

let cachedOwnerDigits: { session: string; digits: string; expires: number } | null = null;

function extractOwnerDigitsFromInstance(item: Record<string, unknown>): string | null {
  const candidates = [
    item.ownerJid,
    item.owner,
    item.wuid,
    item.number,
    (item.instance as Record<string, unknown> | undefined)?.ownerJid,
    (item.instance as Record<string, unknown> | undefined)?.wuid
  ];
  for (const raw of candidates) {
    const d = digitsOnly(String(raw ?? ""));
    if (isValidWhatsAppPhoneDigits(d)) return d;
  }
  return null;
}

/** Telefone da instância conectada (ex.: 5521995758554) — evita rotular contatos como "Você". */
export async function getConnectedOwnerDigits(): Promise<string | null> {
  const instance = (await getInstanceName()).trim().toLowerCase();
  const now = Date.now();
  if (
    cachedOwnerDigits &&
    cachedOwnerDigits.session === instance &&
    cachedOwnerDigits.expires > now
  ) {
    return cachedOwnerDigits.digits;
  }

  try {
    const raw = await listServerSessions();
    let list: unknown[] = [];
    if (Array.isArray(raw)) list = raw;
    else if (raw && typeof raw === "object") {
      const o = raw as Record<string, unknown>;
      if (Array.isArray(o.response)) list = o.response;
      else if (Array.isArray(o.instances)) list = o.instances;
    }

    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const name = String(row.instanceName ?? row.name ?? "")
        .trim()
        .toLowerCase();
      if (name !== instance) continue;
      const digits = extractOwnerDigitsFromInstance(row);
      if (digits) {
        cachedOwnerDigits = { session: instance, digits, expires: now + 120_000 };
        return digits;
      }
    }
  } catch {
    /* opcional */
  }
  return null;
}

export type ConnectedInstanceProfile = {
  instanceName: string;
  profileName: string | null;
  profilePictureUrl: string | null;
  phone: string | null;
  connected: boolean;
};

let cachedProfile: {
  session: string;
  profile: ConnectedInstanceProfile;
  expires: number;
} | null = null;

export function clearEvolutionInstanceCache(): void {
  cachedOwnerDigits = null;
  cachedProfile = null;
}

function parseInstanceList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (Array.isArray(o.response)) return o.response;
    if (Array.isArray(o.instances)) return o.instances;
  }
  return [];
}

function findInstanceRow(list: unknown[], instance: string): Record<string, unknown> | null {
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const name = String(row.instanceName ?? row.name ?? "")
      .trim()
      .toLowerCase();
    if (name === instance) return row;
  }
  return null;
}

/** Nome e foto do WhatsApp conectado na instância Evolution. */
export async function getConnectedInstanceProfile(): Promise<ConnectedInstanceProfile> {
  const instance = (await getInstanceName()).trim().toLowerCase();
  const now = Date.now();
  if (cachedProfile && cachedProfile.session === instance && cachedProfile.expires > now) {
    return cachedProfile.profile;
  }

  const fallback: ConnectedInstanceProfile = {
    instanceName: instance,
    profileName: null,
    profilePictureUrl: null,
    phone: null,
    connected: false
  };

  let connected = false;
  try {
    connected = parseConnectionCheck(await checkConnection());
  } catch {
    /* opcional */
  }

  try {
    const row = findInstanceRow(parseInstanceList(await listServerSessions()), instance);
    if (!row) {
      const profile = { ...fallback, connected };
      cachedProfile = { session: instance, profile, expires: now + 120_000 };
      return profile;
    }

    const profileName =
      String(row.profileName ?? row.pushName ?? row.ownerName ?? "").trim() || null;
    let profilePictureUrl =
      String(row.profilePicUrl ?? row.profilePictureUrl ?? row.picture ?? "").trim() || null;
    const phone = extractOwnerDigitsFromInstance(row);

    if (!profilePictureUrl && phone && connected) {
      try {
        const res = await evoFetch(
          `/chat/fetchProfilePictureUrl/${encodeURIComponent(instance)}`,
          {
            method: "POST",
            body: JSON.stringify({ number: phone })
          }
        );
        const data = await readJson(res);
        if (res.ok && data && typeof data === "object") {
          const d = data as Record<string, unknown>;
          profilePictureUrl =
            String(d.profilePictureUrl ?? d.url ?? d.picture ?? "").trim() || profilePictureUrl;
        }
      } catch {
        /* opcional */
      }
    }

    const profile: ConnectedInstanceProfile = {
      instanceName: instance,
      profileName,
      profilePictureUrl,
      phone,
      connected
    };
    cachedProfile = { session: instance, profile, expires: now + 120_000 };
    return profile;
  } catch {
    return { ...fallback, connected };
  }
}

export async function purgeWppSessionFromServer(
  sessionName: string
): Promise<{ ok: boolean; detail: string; stillOnServer?: boolean }> {
  const name = sessionName.trim().toLowerCase();
  try {
    await evoFetch(`/instance/logout/${encodeURIComponent(name)}`, { method: "DELETE" }).catch(
      () => {}
    );
    const res = await evoFetch(`/instance/delete/${encodeURIComponent(name)}`, {
      method: "DELETE"
    });
    if (!res.ok && res.status !== 404) {
      const body = await readJson(res);
      return { ok: false, detail: formatWppError(res.status, body), stillOnServer: true };
    }
    await new Promise((r) => setTimeout(r, 400));
    const names = parseWppServerSessionNames(await listServerSessions());
    if (names.includes(name)) {
      return {
        ok: false,
        stillOnServer: true,
        detail: `Instância "${name}" ainda listada na Evolution.`
      };
    }
    return { ok: true, detail: "Instância removida da Evolution." };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, detail: msg, stillOnServer: true };
  }
}

export async function purgeOrphanWppSessions(keepNames: string[]): Promise<{
  purged: string[];
  failed: Array<{ name: string; error: string }>;
}> {
  const keep = new Set(keepNames.map((n) => n.trim().toLowerCase()));
  let server: string[] = [];
  try {
    server = parseWppServerSessionNames(await listServerSessions());
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { purged: [], failed: [{ name: "*", error: msg }] };
  }
  const purged: string[] = [];
  const failed: Array<{ name: string; error: string }> = [];
  for (const name of server) {
    if (keep.has(name)) continue;
    const r = await purgeWppSessionFromServer(name);
    if (r.ok) purged.push(name);
    else failed.push({ name, error: r.detail });
  }
  return { purged, failed };
}

export async function runWppDiagnostics() {
  const instance = await getInstanceName();
  const base = evolutionBaseUrl();
  const steps: Array<{ step: string; ok: boolean; detail: string }> = [];
  steps.push({
    step: "Evolution URL",
    ok: true,
    detail: env.EVOLUTION_INTERNAL_URL ? `${base} (interna)` : base
  });
  try {
    await listServerSessions();
    steps.push({ step: "Listar instâncias", ok: true, detail: "OK" });
  } catch (e: unknown) {
    steps.push({
      step: "Listar instâncias",
      ok: false,
      detail: e instanceof Error ? e.message : String(e)
    });
  }
  try {
    await refreshWppToken();
    steps.push({ step: "API Key / instância", ok: true, detail: instance });
  } catch (e: unknown) {
    steps.push({
      step: "API Key / instância",
      ok: false,
      detail: e instanceof Error ? e.message : String(e)
    });
  }
  const { getLastWppWebhookAt } = await import("../wppWebhook.js");
  return {
    baseUrl: base,
    publicUrl: env.EVOLUTION_BASE_URL,
    session: instance,
    webhook: inboundWebhookUrl(),
    webhookPublic: getInboundWebhookDiagnostics().webhookPublic,
    zapInternalUrl: env.ZAP_INTERNAL_URL ?? null,
    lastWebhookAt: getLastWppWebhookAt(),
    steps,
    provider: "evolution"
  };
}

export function validateProxyPath(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (!/^\/[a-zA-Z0-9/_.@+%?=&-]+$/.test(p)) {
    throw new Error("Caminho da API inválido");
  }
  return p;
}

export async function callSessionApi(
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  body?: unknown
): Promise<unknown> {
  const safe = validateProxyPath(path);
  const instance = await getInstanceName();

  if (safe === "/list-chats" || safe.startsWith("/list-chats")) {
    const res = await evoFetch(`/chat/findChats/${encodeURIComponent(instance)}`, {
      method: "POST",
      body: JSON.stringify({})
    });
    const data = await readJson(res);
    if (!res.ok) throw new Error(formatWppError(res.status, data));
    return data;
  }

  if (safe.startsWith("/all-groups")) {
    const res = await evoFetch(`/chat/findChats/${encodeURIComponent(instance)}`, {
      method: "POST",
      body: JSON.stringify({})
    });
    const data = await readJson(res);
    if (!res.ok) throw new Error(formatWppError(res.status, data));
    const list = extractEvolutionChatList(data);
    const groups = list.filter((item) => {
      const o = item as Record<string, unknown>;
      const jid = String(
        (o.key as Record<string, unknown> | undefined)?.remoteJid ??
          o.remoteJid ??
          o.id ??
          ""
      );
      return jid.includes("@g.us");
    });
    return { response: groups };
  }

  if (safe.startsWith("/profile-pic/")) {
    const phone = safe.split("/profile-pic/")[1]?.split("?")[0] ?? "";
    const number = decodeURIComponent(phone);
    const resolved = isLikelyInternalLidJid(number)
      ? await resolveEvolutionSendNumber(number).catch(() => number)
      : evolutionSendNumber(number, false);
    const res = await evoFetch(
      `/chat/fetchProfilePictureUrl/${encodeURIComponent(instance)}`,
      {
        method: "POST",
        body: JSON.stringify({ number: resolved })
      }
    );
    const data = await readJson(res);
    if (!res.ok) throw new Error(formatWppError(res.status, data));
    return data;
  }

  if (safe === "/find-contacts" || safe.startsWith("/find-contacts")) {
    const res = await evoFetch(`/chat/findContacts/${encodeURIComponent(instance)}`, {
      method: "POST",
      body: JSON.stringify({})
    });
    const data = await readJson(res);
    if (!res.ok) throw new Error(formatWppError(res.status, data));
    return data;
  }

  if (safe.startsWith("/get-messages/")) {
    const phone = safe.split("/get-messages/")[1]?.split("?")[0] ?? "";
    const res = await evoFetch(`/chat/findMessages/${encodeURIComponent(instance)}`, {
      method: "POST",
      body: JSON.stringify({
        where: { key: { remoteJid: decodeURIComponent(phone) } },
        page: 1,
        offset: 40
      })
    });
    const data = await readJson(res);
    if (!res.ok) throw new Error(formatWppError(res.status, data));
    return data;
  }

  if (safe === "/send-message" && method === "POST" && body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    const phone = phoneFromCallBody(b);
    const message = String(b.message ?? "");
    const waMessageId = await sendText(phone, message);
    return { success: true, id: waMessageId, key: waMessageId ? { id: waMessageId } : undefined };
  }

  if (
    (safe === "/send-voice" || safe === "/send-voice-base64") &&
    method === "POST" &&
    body &&
    typeof body === "object"
  ) {
    const b = body as Record<string, unknown>;
    await sendAudio(phoneFromCallBody(b), mediaUrlFromCallBody(b));
    return { success: true };
  }

  if (safe === "/send-image" && method === "POST" && body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    const { media, mimeType, fileName } = mediaFromCallBody(b);
    const waMessageId = await sendImage(phoneFromCallBody(b), media, String(b.caption ?? ""), {
      mimeType,
      fileName
    });
    return { success: true, id: waMessageId, key: waMessageId ? { id: waMessageId } : undefined };
  }

  if (safe === "/send-file" && method === "POST" && body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    const phone = phoneFromCallBody(b);
    const { media, mimeType, fileName } = mediaFromCallBody(b);
    const filename = fileName.toLowerCase();
    const caption = String(b.caption ?? "");
    const opts = { mimeType, fileName };
    let waMessageId: string | null = null;
    const sendAs = String(b.sendAs ?? "auto").toLowerCase();
    if (sendAs === "document") {
      waMessageId = await sendDocument(phone, media, caption, fileName, opts);
    } else if (
      (sendAs === "video" || sendAs === "auto") &&
      /\.(mp4|webm|mov|mkv)(\?|$)/.test(filename)
    ) {
      waMessageId = await sendVideo(phone, media, caption, opts);
    } else if (
      (sendAs === "image" || sendAs === "auto") &&
      /\.(jpe?g|png|gif|webp)(\?|$)/.test(filename)
    ) {
      waMessageId = await sendImage(phone, media, caption, opts);
    } else {
      waMessageId = await sendDocument(phone, media, caption, fileName, opts);
    }
    return { success: true, id: waMessageId, key: waMessageId ? { id: waMessageId } : undefined };
  }

  if (safe === "/download-media" && method === "POST" && body && typeof body === "object") {
    return downloadEvolutionInboundMedia(body as Record<string, unknown>);
  }

  throw new Error(`Rota Evolution não mapeada: ${method} ${safe}`);
}

function extractBase64FromEvolutionResponse(raw: unknown): { base64: string; mime: string } | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const base64 = String(o.base64 ?? o.data ?? "").replace(/\s/g, "");
  const mime = String(o.mimetype ?? o.mimeType ?? "application/octet-stream");
  if (!base64 || base64.length < 32) return null;
  return { base64, mime };
}

function extractEvolutionChatList(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    return data.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object");
  }
  if (!data || typeof data !== "object") return [];
  const o = data as Record<string, unknown>;
  for (const key of ["response", "chats", "data", "records"]) {
    const val = o[key];
    if (Array.isArray(val)) {
      return val.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object");
    }
  }
  if (o.response && typeof o.response === "object" && !Array.isArray(o.response)) {
    return Object.values(o.response as Record<string, unknown>).filter(
      (x): x is Record<string, unknown> => Boolean(x) && typeof x === "object"
    );
  }
  return [];
}

function extractEvolutionMessageRecords(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    return data.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object");
  }
  if (!data || typeof data !== "object") return [];
  const o = data as Record<string, unknown>;
  if (Array.isArray(o.records)) {
    return o.records.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object");
  }
  if (o.messages && typeof o.messages === "object") {
    const m = o.messages as Record<string, unknown>;
    if (Array.isArray(m.records)) {
      return m.records.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object");
    }
    if (Array.isArray(m)) {
      return m.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object");
    }
  }
  if (Array.isArray(o.messages)) {
    return o.messages.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object");
  }
  return [];
}

/** Localiza payload completo da mensagem para download sob demanda. */
export async function findEvolutionMessageByKey(
  remoteJid: string,
  messageId: string
): Promise<Record<string, unknown> | null> {
  const instance = await getInstanceName();
  const res = await evoFetch(`/chat/findMessages/${encodeURIComponent(instance)}`, {
    method: "POST",
    body: JSON.stringify({
      where: {
        key: {
          remoteJid,
          id: messageId
        }
      },
      page: 1,
      offset: 5
    })
  });
  const data = await readJson(res);
  if (!res.ok) return null;

  for (const item of extractEvolutionMessageRecords(data)) {
    const key = (item.key ?? {}) as Record<string, unknown>;
    if (String(key.id ?? "") === messageId) return item;
  }
  return null;
}

/** Baixa mídia de mensagem recebida (webhook sem base64 inline). */
export async function downloadEvolutionInboundMedia(
  messagePayload: Record<string, unknown>
): Promise<unknown> {
  const instance = await getInstanceName();
  const res = await evoFetch(`/chat/getBase64FromMediaMessage/${encodeURIComponent(instance)}`, {
    method: "POST",
    body: JSON.stringify({
      message: messagePayload,
      convertToMp4: true
    })
  });
  const data = await readJson(res);
  if (!res.ok) throw new Error(formatWppError(res.status, data));
  return data;
}

/** Grupos em que o telefone participa (Evolution fetchAllGroups + participantes). */
let groupsCatalogCache: {
  at: number;
  list: Record<string, unknown>[];
} | null = null;
const GROUPS_CATALOG_TTL_MS = 5 * 60_000;

export async function fetchGroupsForPhone(
  phone: string
): Promise<Array<{ id: string; name: string }>> {
  const { phoneDedupeKey, phoneDigits, expandPhoneLookupKeys, canonicalBrazilPhone } = await import(
    "../../utils/phone.js"
  );
  const targetKeys = new Set(
    expandPhoneLookupKeys(canonicalBrazilPhone(phone.replace(/\D/g, ""))).map((k) =>
      phoneDedupeKey(phoneDigits(k))
    )
  );
  if (targetKeys.size === 0) return [];

  try {
    const now = Date.now();
    let list = groupsCatalogCache && now - groupsCatalogCache.at < GROUPS_CATALOG_TTL_MS
      ? groupsCatalogCache.list
      : null;

    if (!list) {
      const instance = await getInstanceName();
      const res = await evoFetch(
        `/group/fetchAllGroups/${encodeURIComponent(instance)}?getParticipants=true`
      );
      const data = await readJson(res);
      if (!res.ok) return [];
      list = extractEvolutionChatList(data);
      groupsCatalogCache = { at: now, list };
    }

    const out: Array<{ id: string; name: string }> = [];

    for (const item of list) {
      const id = String(
        item.id ??
          item.jid ??
          (item.key as Record<string, unknown> | undefined)?.remoteJid ??
          ""
      ).trim();
      if (!id.includes("@g.us")) continue;

      const participants = item.participants;
      if (!Array.isArray(participants)) continue;

      let member = false;
      for (const p of participants) {
        const pid =
          typeof p === "string"
            ? p
            : String((p as Record<string, unknown>).id ?? (p as Record<string, unknown>).jid ?? "");
        const pk = phoneDedupeKey(digitsOnly(pid.replace(/@.*/, "")));
        if (pk && targetKeys.has(pk)) {
          member = true;
          break;
        }
      }
      if (!member) continue;

      const name = String(
        item.subject ?? item.name ?? item.pushName ?? item.formattedTitle ?? ""
      ).trim();
      out.push({ id, name: name || id.replace(/@.*/, "") });
    }

    return out.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  } catch {
    return [];
  }
}
