import { env } from "../env.js";
import { prisma } from "../prisma.js";

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

export async function refreshWppToken(): Promise<string> {
  const settings = await getSettings();
  const base = settings.wppBaseUrl.replace(/\/$/, "");
  const session = settings.wppSession;
  const secret = env.WPP_SECRET_KEY;

  const url = `${base}/api/${encodeURIComponent(session)}/${encodeURIComponent(secret)}/generate-token`;
  const res = await fetch(url, { method: "POST", headers: { accept: "application/json" } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`WPP generate-token falhou: ${res.status} ${body}`);
  }
  const data = (await res.json()) as TokenResponse;
  const token = data.token;

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
  const base = settings.wppBaseUrl.replace(/\/$/, "");
  const session = settings.wppSession;
  const token = await getWppToken();

  const url = `${base}/api/${encodeURIComponent(session)}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...(init.headers ?? {})
    }
  });

  if (res.status === 401 && retry) {
    await refreshWppToken();
    return wppFetch(path, init, false);
  }

  return res;
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
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`check-connection falhou: ${res.status} ${body}`);
  }
  return res.json().catch(() => ({}));
}

function inboundWebhookUrl(): string {
  const base = env.APP_PUBLIC_URL.replace(/\/$/, "");
  return `${base}/api/webhooks/wppconnect`;
}

export function extractQrImage(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const candidates = [o.qrcode, o.qrCode, o.base64, o.QRCode];
  for (const c of candidates) {
    if (typeof c !== "string" || !c.trim()) continue;
    if (c.startsWith("data:image")) return c;
    return `data:image/png;base64,${c.replace(/^data:image\/[a-z]+;base64,/, "")}`;
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

export async function startSession(): Promise<unknown> {
  const webhook = inboundWebhookUrl();
  const res = await wppFetch("/start-session", {
    method: "POST",
    body: JSON.stringify({
      webhook,
      waitQrCode: false
    })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`start-session falhou: ${res.status} ${JSON.stringify(body)}`);
  }
  await persistConnectionStatus("start_session", body);
  return body;
}

export async function getQrCode(): Promise<{ qrImage: string | null; raw: unknown }> {
  const res = await wppFetch("/qrcode-session", { method: "GET" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`qrcode-session falhou: ${res.status} ${JSON.stringify(body)}`);
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
  await persistConnectionStatus(state, body);
  return body;
}

export async function closeSession(): Promise<unknown> {
  const res = await wppFetch("/close-session", { method: "POST", body: JSON.stringify({}) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`close-session falhou: ${res.status} ${JSON.stringify(body)}`);
  }
  await persistConnectionStatus("CLOSED", body);
  return body;
}

export async function logoutSession(): Promise<unknown> {
  const res = await wppFetch("/logout-session", { method: "POST", body: JSON.stringify({}) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`logout-session falhou: ${res.status} ${JSON.stringify(body)}`);
  }
  await persistConnectionStatus("LOGOUT", body);
  return body;
}
