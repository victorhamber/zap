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
