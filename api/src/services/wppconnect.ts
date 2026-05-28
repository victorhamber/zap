import { env } from "../env.js";
import { prisma } from "../prisma.js";

function wppBaseUrl(settings: { wppBaseUrl: string }): string {
  const internal = env.WPP_INTERNAL_URL?.trim().replace(/\/$/, "");
  if (internal) return internal;
  return settings.wppBaseUrl.replace(/\/$/, "");
}

export const MSG_NO_DEVICE =
  'Nenhum aparelho WhatsApp conectado. Clique em "Conectar / Mostrar QR" para vincular um novo dispositivo.';

export const MSG_NO_SESSION_CLOSE =
  "Não há sessão ativa para fechar. O WhatsApp já está desconectado — use \"Conectar / Mostrar QR\" para vincular de novo.";

export const MSG_NO_SESSION_LOGOUT =
  "Não há sessão ativa para desconectar. O aparelho já não está vinculado — use \"Conectar / Mostrar QR\" se quiser conectar de novo.";

export function isWppNetworkError(message: string): boolean {
  return /502|bad gateway|econnrefused|fetch failed|falha de rede|não alcançou o wppconnect/i.test(
    message
  );
}

export function isDisconnectedState(state: string): boolean {
  const s = state.toUpperCase();
  return (
    s === "CLOSED" ||
    s === "LOGOUT" ||
    s === "NOTLOGGED" ||
    s === "QRCODE" ||
    s === "DISCONNECTED" ||
    s === "NOSESSION" ||
    s === "UNPAIRED" ||
    s === "INDISPONÍVEL" ||
    s.includes("QR") ||
    (s.includes("NOT") && s.includes("LOG"))
  );
}

export function httpErrorMeansNoSession(status: number, body: unknown): boolean {
  if (status === 404) return true;
  const text = JSON.stringify(body ?? "").toLowerCase();
  return (
    status === 400 &&
    /session|closed|not found|not started|logout|desconect|no session|sem sessão/i.test(text)
  );
}

export function formatWppError(status: number, body: unknown): string {
  if (typeof body === "string" && body.trim()) return body.slice(0, 400);
  if (body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    const msg = o.message ?? o.error ?? o.status;
    if (typeof msg === "string") return msg;
    if (Array.isArray(o.errors)) return JSON.stringify(o.errors).slice(0, 400);
  }
  return `HTTP ${status}`;
}

type TokenResponse = {
  status: string;
  session: string;
  token: string;
  full: string;
};

async function getSettings() {
  if (!prisma) {
    return {
      wppBaseUrl: env.WPP_BASE_URL,
      wppSession: env.WPP_SESSION,
      wppToken: null as string | null,
      wppTokenFull: null as string | null
    };
  }
  let s = await prisma.appSettings.findUnique({ where: { id: "default" } });
  if (!s) {
    s = await prisma.appSettings.create({
      data: {
        id: "default",
        wppBaseUrl: env.WPP_BASE_URL,
        wppSession: env.WPP_SESSION
      }
    });
  }
  return s;
}

export async function setActiveSession(sessionName: string): Promise<void> {
  const name = sessionName.trim();
  if (!/^[\w-]{2,64}$/i.test(name)) {
    throw new Error("Nome da sessão inválido (use letras, números, _ ou -)");
  }
  if (prisma) {
    await prisma.appSettings.upsert({
      where: { id: "default" },
      update: { wppSession: name, wppToken: null, wppTokenFull: null },
      create: {
        id: "default",
        wppBaseUrl: env.WPP_BASE_URL,
        wppSession: name
      }
    });
  }
}

export async function refreshWppToken(sessionOverride?: string): Promise<string> {
  const settings = await getSettings();
  const base = wppBaseUrl(settings);
  const session = sessionOverride ?? settings.wppSession;
  const secret = env.WPP_SECRET_KEY;

  const url = `${base}/api/${encodeURIComponent(session)}/${encodeURIComponent(secret)}/generate-token`;
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { accept: "application/json" } });
  } catch (e: any) {
    throw new Error(
      `Zap não alcançou o WPPConnect em ${base}. Defina WPP_INTERNAL_URL (rede Docker) ou WPP_BASE_URL com porta correta. ${e?.message ?? e}`
    );
  }
  const rawText = await res.text().catch(() => "");
  let parsed: unknown = rawText;
  try {
    parsed = rawText ? JSON.parse(rawText) : {};
  } catch {
    /* texto */
  }
  if (!res.ok) {
    throw new Error(`generate-token: ${formatWppError(res.status, parsed)}`);
  }
  const data = parsed as TokenResponse;
  const token = data.token;
  if (!token) throw new Error("generate-token não retornou token — confira WPP_SECRET_KEY");

  if (prisma) {
    await prisma.appSettings.update({
      where: { id: "default" },
      data: { wppToken: token, wppTokenFull: data.full, connectionStatus: "token_ok" }
    });
  }

  return token;
}

export async function getWppToken(): Promise<string> {
  const settings = await getSettings();
  if (settings.wppToken) return settings.wppToken;
  return refreshWppToken();
}

async function wppFetch(path: string, init: RequestInit, retry = true): Promise<Response> {
  const settings = await getSettings();
  const base = wppBaseUrl(settings);
  const session = settings.wppSession;
  const token = await getWppToken();

  const url = `${base}/api/${encodeURIComponent(session)}${path}`;
  const headers: Record<string, string> = {
    accept: "application/json",
    authorization: `Bearer ${token}`
  };
  const hasBody =
    init.body !== undefined && init.body !== null && String(init.body).length > 0;
  if (hasBody) {
    headers["content-type"] = "application/json";
  }

  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        ...headers,
        ...(init.headers as Record<string, string> | undefined)
      }
    });
  } catch (e: any) {
    throw new Error(`Falha de rede ao chamar WPP (${base}): ${e?.message ?? e}`);
  }

  if (res.status === 401 && retry) {
    await refreshWppToken();
    return wppFetch(path, init, false);
  }

  return res;
}

async function readWppJson(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => "");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return text;
  }
}

export async function sendText(phone: string, message: string) {
  const res = await wppFetch("/send-message", {
    method: "POST",
    body: JSON.stringify({ phone, message, isGroup: false })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`send-message falhou: ${res.status} ${body}`);
  }
  return res.json().catch(() => ({}));
}

export async function sendImage(phone: string, url: string, caption?: string) {
  const res = await wppFetch("/send-image", {
    method: "POST",
    body: JSON.stringify({
      phone,
      path: url,
      caption: caption ?? ""
    })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`send-image falhou: ${res.status} ${body}`);
  }
  return res.json().catch(() => ({}));
}

export async function sendVideo(phone: string, url: string, caption?: string) {
  const res = await wppFetch("/send-file", {
    method: "POST",
    body: JSON.stringify({
      phone,
      path: url,
      caption: caption ?? ""
    })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`send-file (video) falhou: ${res.status} ${body}`);
  }
  return res.json().catch(() => ({}));
}

export async function sendAudio(phone: string, url: string) {
  const res = await wppFetch("/send-voice", {
    method: "POST",
    body: JSON.stringify({
      phone,
      path: url
    })
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`send-voice falhou: ${res.status} ${body}`);
  }
  return res.json().catch(() => ({}));
}

export async function checkConnection(): Promise<unknown> {
  const res = await wppFetch("/check-connection-session", { method: "GET" });
  const body = await readWppJson(res);
  if (!res.ok) {
    throw new Error(`check-connection: ${formatWppError(res.status, body)}`);
  }
  return body;
}

const CONNECTED_STATES = new Set([
  "CONNECTED",
  "ISCONNECTED",
  "SUCCESS",
  "INCHAT",
  "MAIN",
  "NORMAL",
  "OPENING",
  "PAIRING",
  "SYNCING"
]);

export function isWppConnectedState(state: string): boolean {
  const s = state.toUpperCase();
  if (CONNECTED_STATES.has(s)) return true;
  if (s.includes("CONNECTED") && !s.includes("DIS")) return true;
  return false;
}

function parseConnectionCheck(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const o = data as Record<string, unknown>;
  if (o.status === true || o.connected === true || o.isConnected === true) return true;
  const msg = typeof o.message === "string" ? o.message : "";
  if (/connected|conectad|inchats|main|normal|true/i.test(msg)) return true;
  return false;
}

export async function verifyActiveSession() {
  const settings = await getSettings();
  const sessionName = settings.wppSession;
  const wppUrlUsed = wppBaseUrl(settings);

  try {
    await refreshWppToken();
  } catch (e: any) {
    const msg = e?.message ?? String(e);
    return {
      connected: false,
      noSession: true,
      state: "WPP_OFFLINE",
      session: sessionName,
      wppUrlUsed,
      wppReachable: false,
      message: isWppNetworkError(msg)
        ? `Não foi possível contactar o WPPConnect (${wppUrlUsed}). Confira se o serviço WPP está online e o WPP_INTERNAL_URL no EasyPanel.`
        : msg,
      phoneConnected: false,
      sessionAlive: false,
      sessionStatus: null,
      connection: null
    };
  }

  let state = "DESCONHECIDO";
  let sessionStatus: unknown = null;
  try {
    sessionStatus = await getSessionStatus();
    state = extractSessionState(sessionStatus);
  } catch {
    state = "INDISPONÍVEL";
  }

  let connection: unknown = null;
  let phoneConnected = false;
  try {
    connection = await checkConnection();
    phoneConnected = parseConnectionCheck(connection);
  } catch {
    phoneConnected = false;
  }

  const sessionAlive = isWppConnectedState(state);
  const disconnected = isDisconnectedState(state);
  const connected = !disconnected && (phoneConnected || sessionAlive);
  const noSession = !connected;

  let message: string;
  if (connected) {
    message = `Aparelho conectado na instância "${sessionName}". Pronto para enviar mensagens e automações.`;
  } else if (disconnected || state === "INDISPONÍVEL" || state === "DESCONHECIDO") {
    message = MSG_NO_DEVICE;
  } else {
    message = `Instância "${sessionName}" com status "${state}". ${MSG_NO_DEVICE}`;
  }

  return {
    connected,
    noSession,
    state,
    session: sessionName,
    wppUrlUsed,
    wppReachable: true,
    message,
    phoneConnected,
    sessionAlive,
    sessionStatus,
    connection
  };
}

function inboundWebhookUrl(): string {
  const base = env.APP_PUBLIC_URL.replace(/\/$/, "");
  return `${base}/api/webhooks/wppconnect`;
}

function qrImageFromTextCode(text: string): string {
  return `https://api.qrserver.com/v1/create-qr-code/?size=320x320&margin=10&data=${encodeURIComponent(text)}`;
}

export function extractQrImage(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;

  if (o.response && typeof o.response === "object") {
    const nested = extractQrImage(o.response);
    if (nested) return nested;
  }

  const imageFields = [o.qrcode, o.qrCode, o.base64, o.QRCode];
  for (const c of imageFields) {
    if (typeof c !== "string" || !c.trim()) continue;
    if (c.startsWith("data:image")) return c;
    if (c.startsWith("http")) return qrImageFromTextCode(c);
    return `data:image/png;base64,${c.replace(/^data:image\/[a-z]+;base64,/, "")}`;
  }

  const codeFields = [o.code, o.urlcode, o.pairingCode];
  for (const c of codeFields) {
    if (typeof c !== "string" || !c.trim()) continue;
    return qrImageFromTextCode(c);
  }

  return null;
}

export function extractSessionState(data: unknown): string {
  if (!data || typeof data !== "object") return "unknown";
  const o = data as Record<string, unknown>;
  const raw =
    o.status ??
    o.state ??
    (typeof o.message === "string" ? o.message : null) ??
    (o.response && typeof o.response === "object"
      ? (o.response as Record<string, unknown>).status
      : null);
  return String(raw ?? "unknown").toUpperCase();
}

async function persistConnectionStatus(label: string, payload?: unknown) {
  if (!prisma) return;
  const extra = payload ? ` | ${JSON.stringify(payload).slice(0, 500)}` : "";
  await prisma.appSettings.update({
    where: { id: "default" },
    data: { connectionStatus: `${label}${extra}` }
  });
}

async function postStartSession(
  webhook: string | null,
  waitQrCode = true
): Promise<{ res: Response; body: unknown }> {
  const payload: Record<string, unknown> = { waitQrCode };
  if (webhook) payload.webhook = webhook;
  const res = await wppFetch("/start-session", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  const body = await readWppJson(res);
  return { res, body };
}

export async function startSession(options?: { waitQrCode?: boolean }): Promise<unknown> {
  const webhook = inboundWebhookUrl();
  const waitQr = options?.waitQrCode !== false;
  let { res, body } = await postStartSession(webhook, waitQr);

  if (!res.ok && (res.status === 400 || res.status === 422)) {
    const second = await postStartSession(null, waitQr);
    res = second.res;
    body = second.body;
  }

  if (!res.ok) {
    throw new Error(`start-session: ${formatWppError(res.status, body)}`);
  }
  const state = extractSessionState(body);
  if (isWppConnectedState(state)) {
    await persistConnectionStatus(`CONNECTED:${state}`, body);
  } else {
    await persistConnectionStatus("start_session", body);
  }
  return body;
}

export async function getQrCode(): Promise<{ qrImage: string | null; raw: unknown }> {
  const res = await wppFetch("/qrcode-session", { method: "GET" });
  const body = await readWppJson(res);
  if (!res.ok) {
    throw new Error(`qrcode-session: ${formatWppError(res.status, body)}`);
  }
  return { qrImage: extractQrImage(body), raw: body };
}

export async function getSessionStatus(): Promise<unknown> {
  const res = await wppFetch("/status-session", { method: "GET" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`status-session falhou: ${res.status} ${JSON.stringify(body)}`);
  }
  const state = extractSessionState(body);
  const label = isWppConnectedState(state) ? `CONNECTED:${state}` : state;
  await persistConnectionStatus(label, body);
  return body;
}

async function readSessionStateSafe(): Promise<string | null> {
  try {
    const status = await getSessionStatus();
    return extractSessionState(status);
  } catch {
    return null;
  }
}

export async function closeSession(): Promise<{ raw?: unknown; noSession: boolean }> {
  const state = await readSessionStateSafe();
  if (state && isDisconnectedState(state)) {
    await persistConnectionStatus(`PAUSED:${state}`);
    return { noSession: true };
  }

  const res = await wppFetch("/close-session", { method: "POST", body: JSON.stringify({}) });
  const body = await readWppJson(res);
  if (!res.ok) {
    if (httpErrorMeansNoSession(res.status, body)) {
      await persistConnectionStatus("PAUSED:CLOSED");
      return { noSession: true };
    }
    throw new Error(`close-session: ${formatWppError(res.status, body)}`);
  }
  await persistConnectionStatus("PAUSED:CLOSED", body);
  return { noSession: false, raw: body };
}

export async function logoutSession(): Promise<{ raw?: unknown; noSession: boolean }> {
  const state = await readSessionStateSafe();
  if (state && isDisconnectedState(state)) {
    await persistConnectionStatus(`DISCONNECTED:${state}`);
    return { noSession: true };
  }

  const res = await wppFetch("/logout-session", { method: "POST", body: JSON.stringify({}) });
  const body = await readWppJson(res);
  if (!res.ok) {
    if (httpErrorMeansNoSession(res.status, body)) {
      await persistConnectionStatus("LOGOUT");
      return { noSession: true };
    }
    throw new Error(`logout-session: ${formatWppError(res.status, body)}`);
  }
  await persistConnectionStatus("LOGOUT", body);
  return { noSession: false, raw: body };
}

export async function listServerSessions(): Promise<unknown> {
  const settings = await getSettings();
  const base = wppBaseUrl(settings);
  const secret = env.WPP_SECRET_KEY;
  const url = `${base}/api/${encodeURIComponent(secret)}/show-all-sessions`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: "application/json" } });
  } catch (e: any) {
    throw new Error(`Não foi possível listar sessões em ${base}: ${e?.message ?? e}`);
  }
  const body = await readWppJson(res);
  if (!res.ok) {
    throw new Error(`show-all-sessions: ${formatWppError(res.status, body)}`);
  }
  return body;
}

export async function runWppDiagnostics() {
  const settings = await getSettings();
  const base = wppBaseUrl(settings);
  const publicBase = settings.wppBaseUrl.replace(/\/$/, "");
  const steps: Array<{ step: string; ok: boolean; detail: string }> = [];

  steps.push({
    step: "URL usada pelo Zap",
    ok: true,
    detail: env.WPP_INTERNAL_URL ? `${base} (interna)` : `${base} (pública)`
  });

  try {
    await listServerSessions();
    steps.push({ step: "Listar sessões (secret)", ok: true, detail: "OK" });
  } catch (e: any) {
    steps.push({ step: "Listar sessões (secret)", ok: false, detail: e.message });
  }

  try {
    await refreshWppToken();
    steps.push({ step: "Gerar token da sessão", ok: true, detail: `Sessão: ${settings.wppSession}` });
  } catch (e: any) {
    steps.push({ step: "Gerar token da sessão", ok: false, detail: e.message });
  }

  try {
    const st = await getSessionStatus();
    steps.push({
      step: "Status da sessão",
      ok: true,
      detail: extractSessionState(st)
    });
  } catch (e: any) {
    steps.push({ step: "Status da sessão", ok: false, detail: e.message });
  }

  return {
    baseUrl: base,
    publicUrl: publicBase,
    session: settings.wppSession,
    webhook: inboundWebhookUrl(),
    steps
  };
}

const BLOCKED_PROXY_PATHS = ["/generate-token", "/show-all-sessions"];

export function validateProxyPath(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (!/^\/[a-zA-Z0-9/_-]+$/.test(p)) {
    throw new Error("Caminho da API inválido");
  }
  if (BLOCKED_PROXY_PATHS.some((b) => p.includes(b))) {
    throw new Error("Caminho não permitido");
  }
  return p;
}

export async function callSessionApi(
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  body?: unknown
): Promise<unknown> {
  const safePath = validateProxyPath(path);
  const init: RequestInit = { method };
  if (body !== undefined && method !== "GET") {
    init.body = JSON.stringify(body);
  }
  const res = await wppFetch(safePath, init);
  const text = await res.text().catch(() => "");
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    /* texto */
  }
  if (!res.ok) {
    throw new Error(`${method} ${safePath} falhou: ${res.status} ${String(text).slice(0, 300)}`);
  }
  return parsed;
}
