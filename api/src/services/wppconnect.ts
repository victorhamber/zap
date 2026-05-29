import { env } from "../env.js";
import { prisma } from "../prisma.js";
import { wppHumanDelay } from "./wppHumanize.js";

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

/** Chrome/Puppeteer no WPP não abre — perfil travado no volume (SingletonLock). */
export const MSG_BROWSER_PROFILE_LOCK =
  "O navegador do WPP não abriu: perfil Chrome travado (SingletonLock). " +
  "Pare o serviço wppconnect no EasyPanel, no volume apague em userDataDir/<sessão> os arquivos " +
  "SingletonLock, SingletonSocket e SingletonCookie (ou a pasta inteira da sessão), " +
  "suba o WPP de novo e use só 1 réplica. Depois: Conectar / Mostrar QR no painel.";

export function isWppBrowserLockError(message: string): boolean {
  return /profile appears to be in use|process_singleton|singletonlock|singletonsocket|failed to launch the browser|code:\s*21|error no open browser/i.test(
    message
  );
}

export function isWppBrokenClientError(message: string): boolean {
  return /req\.client\.[a-z]+ is not a function|client\.(close|logout) is not a function/i.test(
    message
  );
}

export function mapWppErrorMessage(message: string): string {
  if (isWppBrowserLockError(message)) return MSG_BROWSER_PROFILE_LOCK;
  if (isWppBrokenClientError(message)) {
    return (
      "A sessão no WPP está corrompida (browser não iniciou). " +
      MSG_BROWSER_PROFILE_LOCK
    );
  }
  return message;
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

/** Status enviados pelo WPP em `status-find` quando o aparelho foi removido no celular. */
export function isPhoneUnlinkedStatus(status: string): boolean {
  const s = status.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!s) return false;
  return (
    (s.includes("disconnect") && s.includes("mobile")) ||
    s === "notlogged" ||
    s === "unpaired" ||
    s === "browserclose" ||
    s === "qrreadfail" ||
    s === "autoclosecalled" ||
    s.includes("deletetoken") ||
    s === "logout" ||
    s === "logoutsession" ||
    s.includes("phoneunlink")
  );
}

/** Remove token JWT salvo no Postgres — sem isso o watchdog reabre sessão “fantasma”. */
export async function clearWppStoredAuth(connectionStatus: string): Promise<void> {
  if (!prisma) return;
  await prisma.appSettings.update({
    where: { id: "default" },
    data: {
      wppToken: null,
      wppTokenFull: null,
      connectionStatus
    }
  });
}

/** Janela em que o Zap não deve logout/start/check agressivo (QR + sync após scan). */
let pairingQuietUntil = 0;
const PAIRING_GRACE_MS = 180_000;
const QR_SUCCESS_GRACE_MS = 300_000;

function extendPairingQuiet(extraMs = PAIRING_GRACE_MS): void {
  pairingQuietUntil = Math.max(pairingQuietUntil, Date.now() + extraMs);
}

export function isPairingQuiet(): boolean {
  return Date.now() < pairingQuietUntil;
}

function clearPairingQuiet(): void {
  pairingQuietUntil = 0;
}

function touchQrReadSuccess(): void {
  pairingQuietUntil = Math.max(pairingQuietUntil, Date.now() + QR_SUCCESS_GRACE_MS);
}

/** Estado estável com aparelho pareado (não QR / CONNECTING). */
export function isStablePhoneConnectionState(state: string): boolean {
  const s = state.toUpperCase();
  if (!s || sessionNeedsQr(s)) return false;
  if (
    s.includes("CONNECTING") ||
    s.includes("SYNCING") ||
    s.includes("OPENING") ||
    s.includes("QRREAD") ||
    s === "PAIRING"
  ) {
    return false;
  }
  const stable = new Set(["MAIN", "INCHAT", "CONNECTED", "SUCCESS", "NORMAL", "ISLOGGED"]);
  return stable.has(s);
}

function isSessionOpeningState(state: string): boolean {
  const s = state.toUpperCase();
  if (s === "CLOSED" || s === "LOGOUT" || s === "PAUSED" || s === "NOSESSION") {
    return false;
  }
  return (
    s.includes("CONNECTING") ||
    s.includes("SYNCING") ||
    s.includes("OPENING") ||
    s === "PAIRING" ||
    s === "INITIALIZING" ||
    s === "QRCODE" ||
    s === "QR" ||
    s.includes("QRREAD")
  );
}

/**
 * Aparelho desvinculado no celular ou logout: limpa credenciais e exige novo QR.
 */
export async function markSessionRequiresQr(reason: string): Promise<void> {
  const reasonNorm = reason.toLowerCase();
  if (isPairingQuiet() && /browserclose|qrreadsuccess|pairing|islogged|syncing/.test(reasonNorm)) {
    return;
  }

  /* Não chamar POST /logout-session no WPP durante QR — o middleware statusConnection
   * encadeia logOutSession e quebra com req.client.logout is not a function. */
  await clearWppStoredAuth(`AWAITING_QR:${reason}`);
  const { resetInboxCapture } = await import("./inboxStore.js");
  await resetInboxCapture(true);
}

function normalizeStatusFind(status: string): string {
  return status.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Webhook WPP: logout, desconexão do celular, QR, etc. */
export async function handleWppLifecycleWebhook(body: Record<string, unknown>): Promise<boolean> {
  const ev = String(body.event ?? "").toLowerCase();
  const status = String(body.status ?? body.state ?? "").trim();
  const st = normalizeStatusFind(status);

  const webhookSession = String(body.session ?? "").trim().toLowerCase();
  const settings = await getSettings();
  const activeSession = settings.wppSession.trim().toLowerCase();
  if (webhookSession && webhookSession !== activeSession) {
    return true;
  }

  if (ev === "logoutsession") {
    if (!isPairingQuiet()) await markSessionRequiresQr("LOGOUT");
    return true;
  }
  if (ev === "status-find" || ev === "disconnected") {
    if (st === "qrreadsuccess" || st === "islogged") {
      touchQrReadSuccess();
      await persistConnectionStatus(
        st === "islogged" ? "CONNECTED:ISLOGGED" : "CONNECTED:QRREADSUCCESS",
        body
      );
      const { ensureInboxCaptureStarted } = await import("./inboxStore.js");
      await ensureInboxCaptureStarted();
      void registerInboundWebhook().catch(() => {});
      return true;
    }
    if (st === "browserclose" && isPairingQuiet()) {
      return true;
    }
    if (
      st === "qrreadfail" ||
      st === "autoclosecalled" ||
      st === "browserclose" ||
      isPhoneUnlinkedStatus(status)
    ) {
      await markSessionRequiresQr(status || st || ev);
      return true;
    }
  }
  if (ev === "qrcode" || ev === "qr") {
    if (prisma) {
      await prisma.appSettings.update({
        where: { id: "default" },
        data: { connectionStatus: "AWAITING_QR:QRCODE" }
      });
    }
    return true;
  }
  return false;
}

export const MSG_QR_TIMEOUT =
  "O WPP fechou a sessão antes de concluir o login (autoClose ~60s). No servidor WPP, defina createOptions.autoClose: 0 no config, reinicie o WPP e escaneie o QR de novo em até 30 segundos.";

export const MSG_WPP_NO_QR =
  "O WPP não devolveu QR Code. Confira: (1) wppconnect com WPP_START_ALL_SESSION=false e reiniciado; (2) clique Conectar / Mostrar QR e aguarde ~5s; (3) log do WPP com [sua-sessão] Waiting for QRCode Scan. Se o log mostrar AggregateError, a env do wppconnect não foi aplicada — Salvar + Implantar.";

export const MSG_WPP_AGGREGATE_BOOT =
  "Log do WPP com AggregateError em startAllSessions: desative startAllSession e webhook.url no dist/config.js do container wppconnect, reinicie o serviço, depois Conectar / Mostrar QR.";

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
  const method = (init.method ?? "GET").toUpperCase();
  if (method !== "GET") await wppHumanDelay();

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

  const controller = new AbortController();
  let timeoutMs = method === "GET" ? 25_000 : 60_000;
  if (path === "/start-session" && method === "POST") {
    timeoutMs = env.WPP_START_WAIT_QR ? 180_000 : 45_000;
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        ...headers,
        ...(init.headers as Record<string, string> | undefined)
      }
    });
  } catch (e: any) {
    const msg =
      e?.name === "AbortError"
        ? `Timeout (${timeoutMs / 1000}s) ao chamar WPP`
        : (e?.message ?? String(e));
    throw new Error(`Falha de rede ao chamar WPP (${base}): ${msg}`);
  } finally {
    clearTimeout(timer);
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

/** Resposta de /check-connection-session — evita falso positivo ("Disconnected" contém "connected"). */
export function parseConnectionCheck(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  const o = data as Record<string, unknown>;

  if (o.connected === true || o.isConnected === true) return true;
  if (o.connected === false || o.isConnected === false) return false;

  if (o.status === true) return true;
  if (o.status === false) return false;

  const statusStr = typeof o.status === "string" ? o.status.toLowerCase().trim() : "";
  if (statusStr === "connected" || statusStr === "success" || statusStr === "islogged") {
    return true;
  }
  if (statusStr && /disconnect|closed|qr|fail|error|not.?log|unpair/i.test(statusStr)) {
    return false;
  }

  const msg = (typeof o.message === "string" ? o.message : "").toLowerCase().trim();
  if (!msg) return false;
  if (/disconnect|not.?log|closed|qr|fail|unpair|error/i.test(msg)) return false;
  if (msg === "connected" || msg.startsWith("conectad")) return true;

  return false;
}

/** Sessão ainda exige escanear QR (não considerar “aparelho conectado”). */
export function sessionNeedsQr(state: string): boolean {
  const s = state.toUpperCase();
  if (isDisconnectedState(s)) return true;
  if (s.includes("QR")) return true;
  return s === "NOTLOGGED" || s === "UNPAIRED" || s === "PHONECODE";
}

export async function verifyActiveSession() {
  const settings = await getSettings();
  const sessionName = settings.wppSession;
  const wppUrlUsed = wppBaseUrl(settings);

  try {
    await getWppToken();
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
  let statusError = "";
  try {
    sessionStatus = await getSessionStatus({ persist: false });
    state = extractSessionState(sessionStatus);
  } catch (e: any) {
    statusError = e?.message ?? String(e);
    state = "INDISPONÍVEL";
  }

  if (statusError && isWppBrowserLockError(statusError)) {
    return {
      connected: false,
      connecting: false,
      ghostSession: false,
      browserLock: true,
      noSession: true,
      state: "BROWSER_LOCK",
      session: sessionName,
      wppUrlUsed,
      wppReachable: true,
      message: mapWppErrorMessage(statusError),
      phoneConnected: false,
      sessionAlive: false,
      sessionStatus: null,
      connection: null
    };
  }

  let connection: unknown = null;
  let phoneConnected = false;
  const skipPhoneCheck =
    isPairingQuiet() ||
    state.includes("CONNECTING") ||
    state.includes("SYNCING") ||
    sessionNeedsQr(state);
  if (!skipPhoneCheck) {
    try {
      connection = await checkConnection();
      phoneConnected = parseConnectionCheck(connection);
    } catch {
      phoneConnected = false;
    }
  }

  const sessionAlive = isWppConnectedState(state);
  const disconnected = isDisconnectedState(state);
  const stablePhone = isStablePhoneConnectionState(state);
  const pairingStates = new Set(["OPENING", "PAIRING", "SYNCING", "INITIALIZING"]);
  const isPairing = pairingStates.has(state);
  const isConnecting =
    isPairing ||
    state.includes("CONNECTING") ||
    state === "QRCODE" ||
    state === "QR";
  /** Browser aberto no WPP mas aparelho já removido em “Aparelhos conectados”. */
  const syncedStates = new Set(["MAIN", "INCHAT", "CONNECTED", "SUCCESS", "NORMAL"]);
  const needsQr = sessionNeedsQr(state);
  const connected =
    !disconnected &&
    !needsQr &&
    (phoneConnected || stablePhone || (isPairingQuiet() && sessionAlive && !disconnected));
  const ghostSession =
    !stablePhone &&
    !isPairingQuiet() &&
    sessionAlive &&
    !phoneConnected &&
    !isConnecting &&
    !disconnected &&
    syncedStates.has(state);
  const connecting = !disconnected && (isConnecting || needsQr) && !connected;
  const noSession = !connected && !connecting;

  if (connected) {
    clearPairingQuiet();
  }

  let message: string;
  if (connected) {
    message = `Aparelho conectado na instância "${sessionName}". Pronto para enviar mensagens e automações.`;
  } else if (ghostSession) {
    message =
      `O WhatsApp foi removido no celular, mas o servidor ainda tentava usar a sessão antiga. ` +
      `Use "Desconectar" ou "Conectar / Mostrar QR" para vincular de novo.`;
  } else if (connected && !phoneConnected && stablePhone) {
    message = `Aparelho pareado na instância "${sessionName}" (${state}). Sincronizando com o servidor…`;
  } else if (connecting) {
    message = `Conectando instância "${sessionName}" (${state})…`;
  } else if (disconnected || state === "INDISPONÍVEL" || state === "DESCONHECIDO") {
    message = MSG_NO_DEVICE;
  } else {
    message = `Instância "${sessionName}" com status "${state}". ${MSG_NO_DEVICE}`;
  }

  return {
    connected,
    connecting,
    ghostSession,
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
  const internal = env.ZAP_INTERNAL_URL?.replace(/\/$/, "");
  if (internal) return `${internal}/api/webhooks/wppconnect`;
  const base = env.APP_PUBLIC_URL.replace(/\/$/, "");
  return `${base}/api/webhooks/wppconnect`;
}

function inboundWebhookUrlFallback(): string | null {
  if (!env.ZAP_INTERNAL_URL) return null;
  const base = env.APP_PUBLIC_URL.replace(/\/$/, "");
  return `${base}/api/webhooks/wppconnect`;
}

async function postStartSessionWithWebhook(
  webhookUrl: string
): Promise<{ res: Response; body: unknown }> {
  return postStartSession(webhookUrl, false);
}

/**
 * Registra URL de webhook no WPP sem derrubar a sessão (quando possível).
 * Mensagens recebidas só chegam ao Inbox se o WPP conseguir POSTar nesta URL.
 */
export async function registerInboundWebhook(options?: {
  forceRestart?: boolean;
}): Promise<{ url: string; ok: boolean; detail?: string }> {
  const primary = inboundWebhookUrl();
  const fallback = inboundWebhookUrlFallback();

  if (!env.ZAP_INTERNAL_URL?.trim()) {
    return {
      url: primary,
      ok: false,
      detail:
        "ZAP_INTERNAL_URL não está definido no serviço zap. O WPP precisa alcançar o Zap pela rede Docker (ex.: http://zap_zap:3000)."
    };
  }

  const state = await readSessionStateSafe();
  if (
    !state ||
    sessionNeedsQr(state) ||
    state.includes("CONNECTING") ||
    state.includes("SYNCING") ||
    isPairingQuiet()
  ) {
    return { url: primary, ok: true, detail: "deferred_until_stable_session" };
  }

  const tryUrls = [primary, ...(fallback && fallback !== primary ? [fallback] : [])];

  if (!options?.forceRestart) {
    for (const url of tryUrls) {
      const attempt = await postStartSessionWithWebhook(url);
      if (attempt.res.ok) {
        return { url, ok: true, detail: "webhook_registered_without_restart" };
      }
    }
  }

  if (!isStablePhoneConnectionState(state)) {
    return { url: primary, ok: true, detail: "session_not_stable_yet" };
  }

  try {
    const connection = await checkConnection();
    if (!parseConnectionCheck(connection)) {
      return { url: primary, ok: false, detail: "phone_not_connected" };
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { url: primary, ok: false, detail: msg };
  }

  if (state && !isDisconnectedState(state)) {
    try {
      await wppFetch("/close-session", { method: "POST", body: JSON.stringify({}) });
      await sleepMs(1200);
    } catch {
      /* tenta start mesmo assim */
    }
  }

  let lastDetail = "";
  for (const url of tryUrls) {
    const attempt = await postStartSessionWithWebhook(url);
    if (attempt.res.ok) {
      const newState = extractSessionState(attempt.body);
      if (isWppConnectedState(newState)) {
        await persistConnectionStatus(`CONNECTED:${newState}`, attempt.body);
      }
      return { url, ok: true, detail: "webhook_registered_after_restart" };
    }
    lastDetail = formatWppError(attempt.res.status, attempt.body);
  }

  return { url: primary, ok: false, detail: lastDetail || "start-session com webhook falhou" };
}

export function getInboundWebhookDiagnostics(): {
  webhookUrl: string;
  webhookPublic: string | null;
  zapInternalUrl: string | null;
  needsInternalUrl: boolean;
} {
  return {
    webhookUrl: inboundWebhookUrl(),
    webhookPublic: inboundWebhookUrlFallback(),
    zapInternalUrl: env.ZAP_INTERNAL_URL?.trim() || null,
    needsInternalUrl: !env.ZAP_INTERNAL_URL?.trim()
  };
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

  if (label.startsWith("CONNECTED:")) {
    const connState = label
      .slice("CONNECTED:".length)
      .split("|")[0]
      .trim();
    const { ensureInboxCaptureStarted } = await import("./inboxStore.js");
    await ensureInboxCaptureStarted();
    if (isStablePhoneConnectionState(connState)) {
      void registerInboundWebhook().catch(() => {});
    }
  }
  if (label === "LOGOUT" || label.startsWith("LOGOUT:")) {
    const { resetInboxCapture } = await import("./inboxStore.js");
    await resetInboxCapture(true);
    await clearWppStoredAuth(label);
  }
  if (label.startsWith("AWAITING_QR:")) {
    const { resetInboxCapture } = await import("./inboxStore.js");
    await resetInboxCapture(true);
  }
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

export async function startSession(options?: {
  waitQrCode?: boolean;
  force?: boolean;
}): Promise<unknown> {
  const waitQr =
    options?.waitQrCode !== undefined ? options.waitQrCode : env.WPP_START_WAIT_QR;

  if (!options?.force) {
    const live = await readSessionStateSafe();
    if (live) {
      if (isSessionOpeningState(live) || isPairingQuiet() || isStablePhoneConnectionState(live)) {
        return getSessionStatus({ persist: false });
      }
    }
  }

  const urls = [inboundWebhookUrl()];
  const fallback = inboundWebhookUrlFallback();
  if (fallback && !urls.includes(fallback)) urls.push(fallback);

  let res!: Response;
  let body: unknown = {};
  for (const webhook of urls) {
    const attempt = await postStartSession(webhook, waitQr);
    res = attempt.res;
    body = attempt.body;
    if (res.ok) break;
    if (res.status !== 400 && res.status !== 422) break;
  }

  if (!res.ok) {
    throw new Error(`start-session: ${mapWppErrorMessage(formatWppError(res.status, body))}`);
  }
  const state = extractSessionState(body);
  if (isStablePhoneConnectionState(state)) {
    touchQrReadSuccess();
    await persistConnectionStatus(`CONNECTED:${state}`, body);
    const { ensureInboxCaptureStarted } = await import("./inboxStore.js");
    await ensureInboxCaptureStarted();
    void registerInboundWebhook().catch(() => {});
  } else if (isWppConnectedState(state) && !sessionNeedsQr(state)) {
    extendPairingQuiet();
    await persistConnectionStatus(`CONNECTED:${state}`, body);
  } else {
    extendPairingQuiet();
    await persistConnectionStatus("AWAITING_QR:start_session", body);
  }
  return body;
}

export async function getQrCode(): Promise<{ qrImage: string | null; raw: unknown }> {
  const res = await wppFetch("/qrcode-session", { method: "GET" });
  const contentType = res.headers.get("content-type") ?? "";

  if (contentType.includes("image/")) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (!res.ok) {
      throw new Error(`qrcode-session: HTTP ${res.status}`);
    }
    const mime = contentType.split(";")[0].trim() || "image/png";
    return {
      qrImage: `data:${mime};base64,${buf.toString("base64")}`,
      raw: { contentType, bytes: buf.length }
    };
  }

  const body = await readWppJson(res);
  if (!res.ok) {
    throw new Error(`qrcode-session: ${formatWppError(res.status, body)}`);
  }
  return { qrImage: extractQrImage(body), raw: body };
}

/** Algumas versões do WPP devolvem o QR no JSON de status-session (campo qrcode). */
export async function fetchQrFromSessionStatus(): Promise<string | null> {
  try {
    const status = await getSessionStatus({ persist: false });
    return extractQrImage(status);
  } catch {
    return null;
  }
}

/**
 * O WPP demora alguns segundos para abrir o Chrome e expor o QR na API.
 * start-session com waitQrCode:false retorna antes do QR existir.
 */
export async function waitForQrImageAfterStart(options?: {
  maxWaitMs?: number;
  intervalMs?: number;
}): Promise<{ qrImage: string | null; state: string; raw: unknown }> {
  const maxWait = options?.maxWaitMs ?? 40_000;
  const interval = options?.intervalMs ?? 2_000;
  const deadline = Date.now() + maxWait;
  let lastRaw: unknown = null;
  let state = "UNKNOWN";

  while (Date.now() < deadline) {
    try {
      const status = await getSessionStatus({ persist: false });
      lastRaw = status;
      state = extractSessionState(status);
      if (isStablePhoneConnectionState(state)) {
        return { qrImage: null, state, raw: status };
      }
      const fromStatus = extractQrImage(status);
      if (fromStatus) return { qrImage: fromStatus, state, raw: status };
    } catch {
      /* browser ainda abrindo */
    }

    try {
      const qr = await getQrCode();
      lastRaw = qr.raw;
      if (qr.qrImage) {
        try {
          state = extractSessionState(await getSessionStatus({ persist: false }));
        } catch {
          /* */
        }
        return { qrImage: qr.qrImage, state, raw: qr.raw };
      }
    } catch {
      /* qrcode-session ainda indisponível */
    }

    await sleepMs(interval);
  }

  try {
    state = extractSessionState(await getSessionStatus({ persist: false }));
  } catch {
    /* */
  }

  return { qrImage: null, state, raw: lastRaw };
}

export async function getSessionStatus(options?: { persist?: boolean }): Promise<unknown> {
  const res = await wppFetch("/status-session", { method: "GET" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`status-session falhou: ${res.status} ${JSON.stringify(body)}`);
  }
  const state = extractSessionState(body);
  if (options?.persist !== false) {
    const label = isWppConnectedState(state) && !sessionNeedsQr(state)
      ? `CONNECTED:${state}`
      : sessionNeedsQr(state)
        ? `AWAITING_QR:${state}`
        : state;
    await persistConnectionStatus(label, body);
  }
  return body;
}

async function readSessionStateSafe(): Promise<string | null> {
  try {
    const status = await getSessionStatus({ persist: false });
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
    const errText = formatWppError(res.status, body);
    if (httpErrorMeansNoSession(res.status, body) || isWppBrokenClientError(errText)) {
      await persistConnectionStatus("PAUSED:CLOSED");
      return { noSession: true };
    }
    throw new Error(`close-session: ${mapWppErrorMessage(errText)}`);
  }
  await persistConnectionStatus("PAUSED:CLOSED", body);
  return { noSession: false, raw: body };
}

export async function logoutSession(): Promise<{ raw?: unknown; noSession: boolean }> {
  const state = await readSessionStateSafe();
  if (state && isDisconnectedState(state)) {
    await markSessionRequiresQr(state);
    return { noSession: true };
  }

  const res = await wppFetch("/logout-session", { method: "POST", body: JSON.stringify({}) });
  const body = await readWppJson(res);
  if (!res.ok) {
    const errText = formatWppError(res.status, body);
    if (httpErrorMeansNoSession(res.status, body) || isWppBrokenClientError(errText)) {
      await markSessionRequiresQr("LOGOUT");
      return { noSession: true };
    }
    throw new Error(`logout-session: ${mapWppErrorMessage(errText)}`);
  }
  await persistConnectionStatus("LOGOUT", body);
  return { noSession: false, raw: body };
}

function sessionNameFromTokenEntry(entry: unknown): string | null {
  if (typeof entry === "string") {
    const t = entry.trim().toLowerCase();
    return t || null;
  }
  if (entry && typeof entry === "object") {
    const o = entry as Record<string, unknown>;
    for (const key of ["session", "name", "sessionName"] as const) {
      const v = o[key];
      if (typeof v === "string" && v.trim()) return v.trim().toLowerCase();
    }
  }
  return null;
}

export function parseWppServerSessionNames(serverPayload: unknown): string[] {
  const names = new Set<string>();

  const collect = (value: unknown) => {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const item of value) {
        const n = sessionNameFromTokenEntry(item);
        if (n) names.add(n);
      }
      return;
    }
    if (typeof value === "object") {
      const o = value as Record<string, unknown>;
      if (Array.isArray(o.response)) collect(o.response);
      else if (Array.isArray(o.sessions)) collect(o.sessions);
      else if (typeof o.response === "string") {
        const n = o.response.trim().toLowerCase();
        if (n) names.add(n);
      } else if (o.response && typeof o.response === "object") {
        for (const key of Object.keys(o.response as object)) {
          const n = key.trim().toLowerCase();
          if (n) names.add(n);
        }
      } else {
        for (const key of Object.keys(o)) {
          const n = sessionNameFromTokenEntry(o[key]) ?? key.trim().toLowerCase();
          if (n && n !== "response" && n !== "status") names.add(n);
        }
      }
    }
  };

  collect(serverPayload);
  return [...names];
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

const PURGE_GAP_MS = 600;

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const WPP_TOKEN_PATH_BUG_HINT =
  "O WPPConnect não apagou tokens/<sessão>.data.json (bug 2.x sem patch). " +
  "No console EasyPanel do wppconnect, cole o arquivo inteiro deploy/COLE-NO-CONSOLE-WPPCONNECT.sh " +
  "(GitHub victorhamber/zap), reinicie o WPP e tente de novo. " +
  "Emergência: deploy/APAGAR-TOKENS-MANUAL.sh no mesmo repo (apaga .data.json à mão). " +
  "Build permanente: deploy/Dockerfile.wppconnect.";

/** Sessão com browser aberto no WPP (não só arquivo em tokens/). */
function isSessionBrowserOpenState(state: string): boolean {
  const s = state.toUpperCase();
  if (!s || s === "CLOSED" || s === "NOSESSION" || s === "UNKNOWN") return false;
  return !isDisconnectedState(s);
}

async function fetchSessionStateOnServer(sessionName: string): Promise<string | null> {
  const name = sessionName.trim().toLowerCase();
  const settings = await getSettings();
  const base = wppBaseUrl(settings);
  const secret = env.WPP_SECRET_KEY;
  const tokenUrl = `${base}/api/${encodeURIComponent(name)}/${encodeURIComponent(secret)}/generate-token`;
  let tokenRes: Response;
  try {
    tokenRes = await fetch(tokenUrl, { method: "POST", headers: { accept: "application/json" } });
  } catch {
    return null;
  }
  const tokenBody = await readWppJson(tokenRes);
  if (!tokenRes.ok) return null;
  const token = (tokenBody as TokenResponse).token;
  if (!token) return null;

  try {
    const res = await fetch(`${base}/api/${encodeURIComponent(name)}/status-session`, {
      method: "GET",
      headers: { accept: "application/json", authorization: `Bearer ${token}` }
    });
    const body = await readWppJson(res);
    if (!res.ok) return null;
    return extractSessionState(body);
  } catch {
    return null;
  }
}

/** Fecha o browser de uma sessão específica sem trocar a instância ativa no Postgres. */
async function closeWppSessionOnServer(sessionName: string): Promise<void> {
  const name = sessionName.trim().toLowerCase();
  const settings = await getSettings();
  const base = wppBaseUrl(settings);
  const secret = env.WPP_SECRET_KEY;
  const tokenUrl = `${base}/api/${encodeURIComponent(name)}/${encodeURIComponent(secret)}/generate-token`;
  let tokenRes: Response;
  try {
    tokenRes = await fetch(tokenUrl, { method: "POST", headers: { accept: "application/json" } });
  } catch {
    return;
  }
  const tokenBody = await readWppJson(tokenRes);
  if (!tokenRes.ok) return;
  const token = (tokenBody as TokenResponse).token;
  if (!token) return;

  try {
    await fetch(`${base}/api/${encodeURIComponent(name)}/close-session`, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: "{}"
    });
  } catch {
    /* ignora */
  }
}

async function sessionStillOnServer(sessionName: string): Promise<boolean> {
  try {
    const names = parseWppServerSessionNames(await listServerSessions());
    return names.includes(sessionName.trim().toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Remove tokens, userDataDir e referências da sessão no WPPConnect (clear-session-data).
 */
export async function purgeWppSessionFromServer(
  sessionName: string
): Promise<{ ok: boolean; detail: string; stillOnServer?: boolean }> {
  const name = sessionName.trim().toLowerCase();
  if (!name) return { ok: false, detail: "Nome de sessão vazio" };
  if (!/^[\w-]{2,64}$/i.test(name)) {
    return { ok: false, detail: "Nome de sessão inválido" };
  }

  const settings = await getSettings();
  const isActive = settings.wppSession.toLowerCase() === name;

  if (isActive) {
    try {
      await closeSession();
    } catch {
      /* browser pode já estar fechado */
    }
    await clearWppStoredAuth("REMOVED");
  } else {
    const remoteState = await fetchSessionStateOnServer(name);
    if (remoteState && isSessionBrowserOpenState(remoteState)) {
      await closeWppSessionOnServer(name);
      await sleepMs(300);
    }
  }

  const base = wppBaseUrl(settings);
  const url = `${base}/api/${encodeURIComponent(name)}/${encodeURIComponent(env.WPP_SECRET_KEY)}/clear-session-data`;

  try {
    const res = await fetch(url, { method: "POST", headers: { accept: "application/json" } });
    const body = await readWppJson(res);
    if (!res.ok) {
      return { ok: false, detail: formatWppError(res.status, body) };
    }
    await sleepMs(500);

    const still = await sessionStillOnServer(name);
    if (still) {
      return {
        ok: false,
        stillOnServer: true,
        detail: WPP_TOKEN_PATH_BUG_HINT
      };
    }

    return { ok: true, detail: "Sessão removida do servidor WPP (tokens e perfil Chrome)." };
  } catch (e: any) {
    return { ok: false, detail: e?.message ?? String(e) };
  }
}

/** Apaga no WPP todas as sessões que não estão na lista keepNames (nomes do painel + sessão ativa). */
export async function purgeOrphanWppSessions(keepNames: string[]): Promise<{
  purged: string[];
  failed: Array<{ name: string; error: string }>;
}> {
  const keep = new Set(keepNames.map((n) => n.trim().toLowerCase()).filter(Boolean));
  let server: string[] = [];
  try {
    server = parseWppServerSessionNames(await listServerSessions());
  } catch (e: any) {
    return { purged: [], failed: [{ name: "*", error: e?.message ?? String(e) }] };
  }

  const purged: string[] = [];
  const failed: Array<{ name: string; error: string }> = [];

  for (const name of server) {
    if (keep.has(name.toLowerCase())) continue;
    const result = await purgeWppSessionFromServer(name);
    if (result.ok) purged.push(name);
    else failed.push({ name, error: result.detail });
    await sleepMs(PURGE_GAP_MS);
  }

  return { purged, failed };
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
    const detail = mapWppErrorMessage(e?.message ?? String(e));
    steps.push({ step: "Status da sessão", ok: false, detail });
    if (isWppBrowserLockError(detail)) {
      steps.push({
        step: "Chrome travado (SingletonLock)",
        ok: false,
        detail: MSG_BROWSER_PROFILE_LOCK
      });
    }
  }

  const { getLastWppWebhookAt } = await import("./wppWebhook.js");

  return {
    baseUrl: base,
    publicUrl: publicBase,
    session: settings.wppSession,
    webhook: inboundWebhookUrl(),
    webhookPublic: inboundWebhookUrlFallback(),
    zapInternalUrl: env.ZAP_INTERNAL_URL ?? null,
    lastWebhookAt: getLastWppWebhookAt(),
    steps
  };
}

const BLOCKED_PROXY_PATHS = ["/generate-token", "/show-all-sessions"];

export function validateProxyPath(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  if (!/^\/[a-zA-Z0-9/_.@+%?=&-]+$/.test(p)) {
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
