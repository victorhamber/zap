/**
 * Cliente HTTP do WAHA. Único motor de WhatsApp do Zap.
 * Sessão NOWEB com store ligado. Não regrava a sessão a cada poll de QR.
 */
import { prisma } from "../prisma.js";
import { defaultWhatsAppSession, env } from "../env.js";

export const MSG_NO_DEVICE =
  "Nenhum aparelho conectado. Abra Configurações e escaneie o QR do WAHA.";
export const MSG_NO_SESSION_CLOSE = "Não havia sessão WAHA para encerrar.";
export const MSG_NO_SESSION_LOGOUT = "Não havia sessão WAHA para desconectar.";
export const MSG_QR_TIMEOUT =
  "O QR ainda não apareceu. A sessão está iniciando — aguarde e atualize.";
export const MSG_WPP_NO_QR = MSG_QR_TIMEOUT;
export const MSG_WPP_AGGREGATE_BOOT = MSG_QR_TIMEOUT;
export const MSG_BROWSER_PROFILE_LOCK = MSG_NO_DEVICE;

type WahaSession = {
  name?: string;
  status?: string;
  me?: { id?: string; pushName?: string } | null;
};

type SendOpts = { isGroup?: boolean; mimeType?: string; fileName?: string };

function baseUrl(): string {
  const raw = env.WAHA_BASE_URL.trim().replace(/\/$/, "");
  if (!raw) throw new Error("WAHA_BASE_URL não configurada.");
  return raw;
}

function apiKey(): string {
  const key = env.WAHA_API_KEY.trim();
  if (!key) throw new Error("WAHA_API_KEY não configurada.");
  return key;
}

function reachableBaseUrl(): string {
  const internal = env.ZAP_INTERNAL_URL?.trim().replace(/\/$/, "") ?? "";
  if (internal) {
    try {
      if (!new URL(internal).hostname.includes("_")) return internal;
    } catch {
      /* hostname inválido: cai no site público */
    }
  }
  return env.APP_PUBLIC_URL.replace(/\/$/, "");
}

export function webhookUrl(): string {
  return `${reachableBaseUrl()}/api/webhooks/waha`;
}

function sessionConfig() {
  const secret = env.WHATSAPP_WEBHOOK_SECRET?.trim();
  return {
    webhooks: [
      {
        url: webhookUrl(),
        events: ["message", "session.status"],
        ...(secret
          ? { customHeaders: [{ name: "x-webhook-secret", value: secret }] }
          : {})
      }
    ],
    noweb: {
      store: {
        enabled: true,
        fullSync: false
      }
    }
  };
}

async function waha(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers);
  headers.set("X-Api-Key", apiKey());
  headers.set("Accept", headers.get("Accept") ?? "application/json");
  if (init?.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}${path}`, { ...init, headers });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Zap não alcançou o WAHA em ${baseUrl()}. ${msg}`);
  }
  return res;
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export function formatWppError(status: number, body: unknown): string {
  if (body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    const message = o.message ?? o.error ?? o.detail;
    if (typeof message === "string" && message.trim()) {
      return `WAHA HTTP ${status}: ${message}`;
    }
  }
  if (typeof body === "string" && body.trim()) return `WAHA HTTP ${status}: ${body.slice(0, 300)}`;
  return `WAHA HTTP ${status}`;
}

async function wahaJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await waha(path, init);
  const body = await readBody(res);
  if (!res.ok) throw new Error(formatWppError(res.status, body));
  return body as T;
}

function normalizeSessionName(name: string): string {
  return name.trim().toLowerCase();
}

async function sessionName(): Promise<string> {
  return getActiveWppSessionName();
}

export async function getActiveWppSessionName(): Promise<string> {
  if (!prisma) return defaultWhatsAppSession();
  const s = await prisma.appSettings.findUnique({ where: { id: "default" } });
  const name = s?.wppSession?.trim() || defaultWhatsAppSession();
  return normalizeSessionName(name);
}

export async function setActiveSession(sessionNameValue: string): Promise<void> {
  const name = normalizeSessionName(sessionNameValue);
  if (!/^[\w-]{2,64}$/i.test(name)) {
    throw new Error("Nome da sessão inválido (use letras, números, _ ou -)");
  }
  if (!prisma) return;
  await prisma.appSettings.upsert({
    where: { id: "default" },
    update: { wppSession: name, wppBaseUrl: baseUrl() },
    create: {
      id: "default",
      wppBaseUrl: baseUrl(),
      wppSession: name
    }
  });
}

export function isWppNetworkError(message: string): boolean {
  return /econnrefused|fetch failed|enotfound|não alcançou o waha|bad gateway|timed out/i.test(
    message
  );
}

export function isWppBrowserLockError(_message: string): boolean {
  return false;
}

export function isWppBrokenClientError(_message: string): boolean {
  return false;
}

export function mapWppErrorMessage(message: string): string {
  return message;
}

export function isDisconnectedState(state: string): boolean {
  const s = state.toUpperCase();
  return (
    s === "STOPPED" ||
    s === "FAILED" ||
    s === "CLOSED" ||
    s === "LOGOUT" ||
    s.includes("DISCONNECTED")
  );
}

export function isPhoneUnlinkedStatus(status: string): boolean {
  return /unpair|logout|stopped|failed/i.test(status);
}

export function isPairingQuiet(): boolean {
  return false;
}

export function isStablePhoneConnectionState(state: string): boolean {
  const s = state.toUpperCase();
  return s === "WORKING" || s === "OPEN" || s.includes("CONNECTED");
}

export function isWppConnectedState(state: string): boolean {
  return isStablePhoneConnectionState(state);
}

export function sessionNeedsQr(state: string): boolean {
  const s = state.toUpperCase();
  return s.includes("QR") || s === "STARTING";
}

export function extractSessionState(data: unknown): string {
  if (!data || typeof data !== "object") return "UNKNOWN";
  const o = data as Record<string, unknown>;
  const status = o.status ?? o.state;
  return typeof status === "string" ? status.toUpperCase() : "UNKNOWN";
}

export function parseConnectionCheck(data: unknown): boolean {
  return isWppConnectedState(extractSessionState(data));
}

export function extractQrImage(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  for (const key of ["qrcode", "qr", "base64"] as const) {
    const v = o[key];
    if (typeof v === "string" && v.startsWith("data:image")) return v;
  }
  return null;
}

export function httpErrorMeansNoSession(status: number): boolean {
  return status === 404;
}

export async function clearWppStoredAuth(connectionStatus: string): Promise<void> {
  if (!prisma) return;
  await prisma.appSettings.update({
    where: { id: "default" },
    data: { connectionStatus, wppToken: "waha" }
  });
}

export async function markSessionRequiresQr(reason: string): Promise<void> {
  await clearWppStoredAuth(`AWAITING_QR:${reason}`);
}

export async function handleWppLifecycleWebhook(body: Record<string, unknown>): Promise<boolean> {
  const event = String(body.event ?? "").toLowerCase();
  if (event !== "session.status") return false;
  const payload = (body.payload ?? {}) as Record<string, unknown>;
  const status = String(payload.status ?? "").toUpperCase();
  if (!status || !prisma) return true;
  const label = isWppConnectedState(status)
    ? `CONNECTED:${status}`
    : sessionNeedsQr(status)
      ? `AWAITING_QR:${status}`
      : `DISCONNECTED:${status}`;
  await prisma.appSettings.update({
    where: { id: "default" },
    data: { connectionStatus: label, wppToken: "waha" }
  });
  return true;
}

export async function refreshWppToken(_sessionOverride?: string): Promise<string> {
  apiKey();
  return "waha";
}

export async function getWppToken(): Promise<string> {
  return refreshWppToken();
}

export async function ensureSession(): Promise<WahaSession> {
  const name = await sessionName();
  let session: WahaSession | null = null;
  try {
    session = await wahaJson<WahaSession>(`/api/sessions/${encodeURIComponent(name)}`);
  } catch {
    session = null;
  }

  if (!session?.name) {
    await wahaJson("/api/sessions", {
      method: "POST",
      body: JSON.stringify({
        name,
        start: true,
        config: sessionConfig()
      })
    });
    return wahaJson<WahaSession>(`/api/sessions/${encodeURIComponent(name)}`);
  }

  const status = session.status ?? "";
  if (status && !["WORKING", "SCAN_QR_CODE", "STARTING"].includes(status)) {
    await waha(`/api/sessions/${encodeURIComponent(name)}/start`, { method: "POST" });
    session = await wahaJson<WahaSession>(`/api/sessions/${encodeURIComponent(name)}`);
  }
  return session;
}

export async function checkConnection(): Promise<unknown> {
  const name = await sessionName();
  return wahaJson(`/api/sessions/${encodeURIComponent(name)}`);
}

export async function getSessionStatus(): Promise<unknown> {
  return checkConnection();
}

export async function startSession(_options?: {
  waitQrCode?: boolean;
  force?: boolean;
}): Promise<unknown> {
  const session = await ensureSession();
  const status = String(session.status ?? "UNKNOWN").toUpperCase();
  if (status === "WORKING") return { status, state: status };
  const qr = status === "SCAN_QR_CODE" ? await fetchQrImage() : null;
  return { status, state: status, ...(qr ? { qrcode: qr } : {}) };
}

async function fetchQrImage(): Promise<string | null> {
  const name = await sessionName();
  const res = await waha(`/api/${encodeURIComponent(name)}/auth/qr?format=image`, {
    headers: { Accept: "image/png" }
  });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 32) return null;
  return `data:image/png;base64,${buf.toString("base64")}`;
}

export async function getQrCode(): Promise<{ qrImage: string | null; raw: unknown }> {
  const session = await ensureSession();
  const status = String(session.status ?? "UNKNOWN").toUpperCase();
  if (status !== "SCAN_QR_CODE") {
    return { qrImage: null, raw: { status } };
  }
  const qrImage = await fetchQrImage();
  return { qrImage, raw: { status, ...(qrImage ? { qrcode: qrImage } : {}) } };
}

export async function fetchQrFromSessionStatus(): Promise<string | null> {
  const { qrImage } = await getQrCode();
  return qrImage;
}

export async function waitForQrImageAfterStart(): Promise<{
  qrImage: string | null;
  state: string;
  raw: unknown;
}> {
  let last = await getQrCode();
  let state = extractSessionState(last.raw);
  for (let i = 0; i < 6 && !last.qrImage && !isWppConnectedState(state); i++) {
    await new Promise((r) => setTimeout(r, 2000));
    last = await getQrCode();
    state = extractSessionState(last.raw);
  }
  return { qrImage: last.qrImage, state, raw: last.raw };
}

export async function registerInboundWebhook(): Promise<{
  url: string;
  ok: boolean;
  detail?: string;
}> {
  const url = webhookUrl();
  try {
    await ensureSession();
    const name = await sessionName();
    await wahaJson(`/api/sessions/${encodeURIComponent(name)}`, {
      method: "PUT",
      body: JSON.stringify({ config: sessionConfig() })
    });
    return { url, ok: true, detail: baseUrl() };
  } catch (e: unknown) {
    const detail = e instanceof Error ? e.message : String(e);
    return { url, ok: false, detail };
  }
}

export function getInboundWebhookDiagnostics() {
  const internal = env.ZAP_INTERNAL_URL?.trim() ?? "";
  const internalRejected = internal.includes("_");
  return {
    webhookUrl: webhookUrl(),
    needsInternalUrl: !internal || internalRejected,
    provider: "waha" as const,
    baseUrl: env.WAHA_BASE_URL
  };
}

export async function closeSession(): Promise<{
  ok: boolean;
  message: string;
  noSession?: boolean;
  raw: unknown;
}> {
  const name = await sessionName();
  const res = await waha(`/api/sessions/${encodeURIComponent(name)}/stop`, { method: "POST" });
  const raw = await readBody(res);
  if (res.status === 404) {
    await clearWppStoredAuth("DISCONNECTED:STOPPED");
    return { ok: true, noSession: true, message: MSG_NO_SESSION_CLOSE, raw };
  }
  if (!res.ok) throw new Error(formatWppError(res.status, raw));
  await clearWppStoredAuth("DISCONNECTED:STOPPED");
  return { ok: true, message: "Sessão WAHA parada.", raw };
}

export async function logoutSession(): Promise<{
  ok: boolean;
  message: string;
  noSession?: boolean;
  raw: unknown;
}> {
  const name = await sessionName();
  const res = await waha(`/api/sessions/${encodeURIComponent(name)}/logout`, { method: "POST" });
  const raw = await readBody(res);
  if (res.status === 404) {
    await clearWppStoredAuth("DISCONNECTED:LOGOUT");
    return { ok: true, noSession: true, message: MSG_NO_SESSION_LOGOUT, raw };
  }
  if (!res.ok) throw new Error(formatWppError(res.status, raw));
  await clearWppStoredAuth("DISCONNECTED:LOGOUT");
  return { ok: true, message: "WhatsApp desconectado. Escaneie o QR de novo.", raw };
}

export async function listServerSessions(): Promise<unknown> {
  return wahaJson("/api/sessions");
}

export function parseWppServerSessionNames(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [];
  const names: string[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const name = String((item as Record<string, unknown>).name ?? "").trim().toLowerCase();
    if (name) names.push(name);
  }
  return names;
}

export async function purgeWppSessionFromServer(name: string): Promise<{
  ok: boolean;
  detail: string;
  stillOnServer: boolean;
}> {
  const session = name.trim().toLowerCase();
  const res = await waha(`/api/sessions/${encodeURIComponent(session)}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    const body = await readBody(res);
    return { ok: false, detail: formatWppError(res.status, body), stillOnServer: true };
  }
  return { ok: true, detail: "Sessão removida no WAHA.", stillOnServer: false };
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
  const steps: Array<{ step: string; ok: boolean; detail: string }> = [];
  steps.push({ step: "WAHA URL", ok: true, detail: baseUrl() });
  try {
    const sessions = parseWppServerSessionNames(await listServerSessions());
    steps.push({
      step: "Listar sessões",
      ok: true,
      detail: sessions.length ? sessions.join(", ") : "nenhuma"
    });
  } catch (e: unknown) {
    steps.push({
      step: "Listar sessões",
      ok: false,
      detail: e instanceof Error ? e.message : String(e)
    });
  }
  try {
    const raw = await checkConnection();
    steps.push({
      step: "Sessão ativa",
      ok: parseConnectionCheck(raw),
      detail: extractSessionState(raw)
    });
  } catch (e: unknown) {
    steps.push({
      step: "Sessão ativa",
      ok: false,
      detail: e instanceof Error ? e.message : String(e)
    });
  }
  steps.push({ step: "Webhook", ok: true, detail: webhookUrl() });
  return { provider: "waha", steps };
}

export async function verifyActiveSession() {
  try {
    const raw = await checkConnection();
    const state = extractSessionState(raw);
    const connected = parseConnectionCheck(raw);
    return {
      connected,
      connecting: state === "STARTING",
      ghostSession: false,
      wppReachable: true,
      message: connected ? "Conectado (WAHA)" : `Estado: ${state}`,
      phoneConnected: connected,
      sessionAlive: state !== "FAILED" && state !== "STOPPED",
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

export function toChatId(phone: string, isGroup?: boolean): string {
  const raw = phone.trim();
  if (raw.includes("@")) return raw;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return raw;
  if (isGroup) return `${digits}@g.us`;
  return `${digits}@c.us`;
}

function messageIdFrom(raw: unknown): string | null {
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

function publicFileUrl(url: string): string {
  if (/^https?:\/\//i.test(url) || url.startsWith("data:")) return url;
  const base = reachableBaseUrl();
  return `${base}${url.startsWith("/") ? url : `/${url}`}`;
}

function extractHttpUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>"']+/i);
  return match ? match[0].replace(/[),.\]]+$/, "") : null;
}

function isYoutubeUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host === "youtu.be" ||
      host.endsWith(".youtu.be") ||
      host === "youtube.com" ||
      host.endsWith(".youtube.com")
    );
  } catch {
    return false;
  }
}

async function youtubeOEmbed(
  url: string
): Promise<{ title: string; description: string; imageUrl: string } | null> {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as {
      title?: string;
      author_name?: string;
      thumbnail_url?: string;
    };
    if (!data.title || !data.thumbnail_url) return null;
    return {
      title: data.title,
      description: data.author_name || "YouTube",
      imageUrl: data.thumbnail_url
    };
  } catch {
    return null;
  }
}

function mentionAll(chatId: string): { mentions: ["all"] } | Record<string, never> {
  return chatId.endsWith("@g.us") ? { mentions: ["all"] } : {};
}

async function postSend(path: string, body: Record<string, unknown>): Promise<string | null> {
  const raw = await wahaJson<unknown>(path, {
    method: "POST",
    body: JSON.stringify(body)
  });
  return messageIdFrom(raw);
}

export async function sendText(
  phone: string,
  message: string,
  opts?: { isGroup?: boolean }
): Promise<string | null> {
  const text = String(message ?? "").trim();
  if (!text) throw new Error("sendText: mensagem vazia");
  const name = await sessionName();
  const chatId = toChatId(phone, opts?.isGroup);
  const mentions = mentionAll(chatId);
  const url = extractHttpUrl(text);
  if (url && isYoutubeUrl(url)) {
    const preview = await youtubeOEmbed(url);
    if (preview) {
      try {
        return await postSend("/api/send/link-custom-preview", {
          session: name,
          chatId,
          text,
          linkPreviewHighQuality: true,
          preview: {
            url,
            title: preview.title,
            description: preview.description,
            image: { url: preview.imageUrl }
          },
          ...mentions
        });
      } catch {
        /* oEmbed ou o endpoint falhou: segue o sendText com prévia automática */
      }
    }
  }
  return postSend("/api/sendText", {
    session: name,
    chatId,
    text,
    linkPreview: true,
    linkPreviewHighQuality: true,
    ...mentions
  });
}

function fileMeta(url: string, opts: SendOpts | undefined, video: boolean) {
  const filename =
    opts?.fileName ||
    url.split(/[/\\]/).pop()?.split("?")[0] ||
    (video ? "video.mp4" : "image.jpg");
  const lower = filename.toLowerCase();
  let mimetype = opts?.mimeType || (video ? "video/mp4" : "image/jpeg");
  if (!opts?.mimeType) {
    if (lower.endsWith(".png")) mimetype = "image/png";
    else if (lower.endsWith(".webp")) mimetype = "image/webp";
    else if (lower.endsWith(".gif")) mimetype = "image/gif";
    else if (lower.endsWith(".webm")) mimetype = "video/webm";
    else if (lower.endsWith(".ogg")) mimetype = "audio/ogg";
    else if (lower.endsWith(".mp3")) mimetype = "audio/mpeg";
  }
  return { filename, mimetype };
}

export async function sendImage(
  phone: string,
  url: string,
  caption?: string,
  opts?: SendOpts
): Promise<string | null> {
  const name = await sessionName();
  const file = fileMeta(url, opts, false);
  const chatId = toChatId(phone, opts?.isGroup);
  return postSend("/api/sendImage", {
    session: name,
    chatId,
    caption: caption ?? "",
    file: { url: publicFileUrl(url), ...file },
    ...mentionAll(chatId)
  });
}

export async function sendVideo(
  phone: string,
  url: string,
  caption?: string,
  opts?: SendOpts
): Promise<string | null> {
  const name = await sessionName();
  const file = fileMeta(url, opts, true);
  const chatId = toChatId(phone, opts?.isGroup);
  return postSend("/api/sendVideo", {
    session: name,
    chatId,
    caption: caption ?? "",
    convert: true,
    file: { url: publicFileUrl(url), ...file },
    ...mentionAll(chatId)
  });
}

export async function sendAudio(
  phone: string,
  media: string,
  opts?: { isGroup?: boolean }
): Promise<string | null> {
  const name = await sessionName();
  const file = fileMeta(media, undefined, false);
  return postSend("/api/sendVoice", {
    session: name,
    chatId: toChatId(phone, opts?.isGroup),
    file: { url: publicFileUrl(media), filename: file.filename, mimetype: file.mimetype }
  });
}

export async function sendDocument(
  phone: string,
  url: string,
  caption?: string,
  fileName?: string,
  opts?: { mimeType?: string; isGroup?: boolean }
): Promise<string | null> {
  const name = await sessionName();
  const file = fileMeta(url, { ...opts, fileName }, false);
  return postSend("/api/sendFile", {
    session: name,
    chatId: toChatId(phone, opts?.isGroup),
    caption: caption ?? "",
    file: { url: publicFileUrl(url), ...file }
  });
}

export async function listChats(): Promise<unknown> {
  const name = await sessionName();
  return wahaJson(`/api/${encodeURIComponent(name)}/chats`);
}

export async function listGroups(): Promise<unknown> {
  const name = await sessionName();
  try {
    return await wahaJson(`/api/${encodeURIComponent(name)}/groups?exclude=participants`);
  } catch {
    return wahaJson(`/api/${encodeURIComponent(name)}/chats`);
  }
}

export async function listContacts(): Promise<unknown> {
  const name = await sessionName();
  return wahaJson(`/api/contacts?session=${encodeURIComponent(name)}&limit=500`);
}

export async function listChatMessages(chatId: string, limit = 40): Promise<unknown[]> {
  const name = await sessionName();
  const id = encodeURIComponent(toChatId(chatId));
  const raw = await wahaJson<unknown>(
    `/api/${encodeURIComponent(name)}/chats/${id}/messages?limit=${Math.min(limit, 50)}&downloadMedia=false`
  );
  return Array.isArray(raw) ? raw : [];
}

export async function fetchGroupSubjectMap(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const raw = await listGroups();
  const list = Array.isArray(raw) ? raw : [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = String(o.id ?? "").trim();
    const subject = String(o.subject ?? o.name ?? "").trim();
    if (id && subject) map.set(id, subject);
  }
  return map;
}

export async function listAllGroups(): Promise<Array<{ id: string; name: string }>> {
  const map = await fetchGroupSubjectMap();
  return [...map.entries()].map(([id, name]) => ({ id, name }));
}

export async function fetchGroupsForPhone(
  phoneDigits: string
): Promise<Array<{ id: string; name: string }>> {
  const name = await sessionName();
  let raw: unknown;
  try {
    raw = await wahaJson(`/api/${encodeURIComponent(name)}/groups`);
  } catch {
    return [];
  }
  const list = Array.isArray(raw) ? raw : [];
  const out: Array<{ id: string; name: string }> = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const id = String(o.id ?? "").trim();
    const title = String(o.subject ?? o.name ?? id).trim();
    const participants = Array.isArray(o.participants) ? o.participants : [];
    const hit = participants.some((p) => {
      const value =
        p && typeof p === "object"
          ? String((p as Record<string, unknown>).id ?? "")
          : String(p ?? "");
      return value.replace(/\D/g, "").includes(phoneDigits);
    });
    if (hit && id) out.push({ id, name: title });
  }
  return out;
}

export async function getConnectedOwnerDigits(): Promise<string | null> {
  try {
    const session = await wahaJson<WahaSession>(
      `/api/sessions/${encodeURIComponent(await sessionName())}`
    );
    const id = session.me?.id ?? "";
    const digits = id.replace(/\D/g, "");
    return digits || null;
  } catch {
    return null;
  }
}

export function clearEvolutionInstanceCache(): void {}

export async function getConnectedInstanceProfile(): Promise<{
  instanceName: string;
  profileName: string | null;
  profilePictureUrl: string | null;
  phone: string | null;
  connected: boolean;
}> {
  const instanceName = await sessionName();
  try {
    const session = await wahaJson<WahaSession>(
      `/api/sessions/${encodeURIComponent(instanceName)}`
    );
    const connected = String(session.status ?? "").toUpperCase() === "WORKING";
    const phone = (session.me?.id ?? "").replace(/\D/g, "") || null;
    let profilePictureUrl: string | null = null;
    if (connected && session.me?.id) {
      profilePictureUrl = await getChatPictureDataUrl(session.me.id);
    }
    return {
      instanceName,
      profileName: session.me?.pushName ?? null,
      profilePictureUrl,
      phone,
      connected
    };
  } catch {
    return {
      instanceName,
      profileName: null,
      profilePictureUrl: null,
      phone: null,
      connected: false
    };
  }
}

export async function getChatPictureDataUrl(chatId: string): Promise<string | null> {
  const name = await sessionName();
  const res = await waha(
    `/api/${encodeURIComponent(name)}/chats/${encodeURIComponent(chatId)}/picture`,
    { headers: { Accept: "image/jpeg" } }
  );
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 32) return null;
  const mime = res.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

export async function markChatAsRead(chatId: string): Promise<void> {
  const name = await sessionName();
  await wahaJson("/api/sendSeen", {
    method: "POST",
    body: JSON.stringify({ session: name, chatId: toChatId(chatId) })
  });
}

export async function resolvePeerJid(chatId: string): Promise<string | null> {
  if (!chatId.includes("@lid")) return null;
  const name = await sessionName();
  try {
    const data = await wahaJson<Record<string, unknown>>(
      `/api/${encodeURIComponent(name)}/lids/${encodeURIComponent(chatId)}`
    );
    const pn = data.pn ?? data.id;
    return typeof pn === "string" && pn.includes("@") ? pn : null;
  } catch {
    return null;
  }
}

export async function saveRemoteMedia(
  url: string
): Promise<{ dataUrl: string; mime: string } | null> {
  const headers = new Headers();
  if (url.startsWith(baseUrl())) headers.set("X-Api-Key", apiKey());
  const res = await fetch(url, { headers });
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) return null;
  const mime = res.headers.get("content-type")?.split(";")[0] || "application/octet-stream";
  return { dataUrl: `data:${mime};base64,${buf.toString("base64")}`, mime };
}

export async function mediaUrlForMessage(
  chatId: string,
  waMessageId: string
): Promise<string | null> {
  const messages = await listChatMessages(chatId, 50);
  for (const item of messages) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (String(o.id ?? "") !== waMessageId) continue;
    const media = o.media;
    if (media && typeof media === "object") {
      const url = (media as Record<string, unknown>).url;
      if (typeof url === "string" && url) return url;
    }
  }
  return null;
}

export function validateProxyPath(path: string): string {
  const p = path.trim();
  if (!p.startsWith("/") || p.includes("..")) {
    throw new Error("Caminho inválido");
  }
  return p;
}

export async function callSessionApi(
  path: string,
  method: string,
  payload?: unknown
): Promise<unknown> {
  const safe = validateProxyPath(path.split("?")[0] ?? path);
  if (safe === "/list-chats") return listChats();
  if (safe === "/all-groups") return listGroups();
  if (safe === "/find-contacts") return listContacts();
  if (safe === "/send-message" && payload && typeof payload === "object") {
    const b = payload as Record<string, unknown>;
    return sendText(String(b.phone ?? b.chatId ?? ""), String(b.message ?? b.text ?? ""), {
      isGroup: b.isGroup === true
    });
  }
  if (safe.startsWith("/profile-pic/")) {
    const phone = decodeURIComponent(safe.slice("/profile-pic/".length));
    const url = await getChatPictureDataUrl(toChatId(phone));
    return url ? { url } : null;
  }
  const name = await sessionName();
  const res = await waha(`/api/${encodeURIComponent(name)}${path}`, {
    method,
    body: method === "GET" || method === "HEAD" ? undefined : JSON.stringify(payload ?? {})
  });
  const body = await readBody(res);
  if (!res.ok) throw new Error(formatWppError(res.status, body));
  return body;
}
