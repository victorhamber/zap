const TOKEN_KEY = "zap_token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

function sanitizeErrorMessage(text: string, status: number): string {
  const lower = text.toLowerCase();
  if (lower.includes("<html") || lower.includes("<!doctype")) {
    if (status === 502 || lower.includes("bad gateway")) {
      return "WhatsApp indisponível (502). Confira se o WAHA está no ar e se WAHA_BASE_URL está certo no EasyPanel.";
    }
    return `Erro HTTP ${status} no servidor. Tente novamente em instantes.`;
  }
  if (text.length > 280) return `${text.slice(0, 280)}…`;
  return text;
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const hasBody =
    init?.body !== undefined && init?.body !== null && String(init.body).length > 0;
  const res = await fetch(path, {
    ...init,
    headers: {
      ...(hasBody ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {})
    }
  });

  const isLogin = path === "/api/auth/login";

  if (res.status === 401 && !isLogin) {
    clearToken();
    window.location.href = "/login";
    throw new Error("Sessão expirada");
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message = text || `HTTP ${res.status}`;
    try {
      const json = JSON.parse(text) as { error?: string; message?: string };
      if (json.error) message = json.error;
      else if (json.message) message = json.message;
    } catch {
      /* texto puro */
    }
    throw new Error(sanitizeErrorMessage(message, res.status));
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

function filenameFromContentDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const match = /filename="?([^";\n]+)"?/i.exec(header);
  return match?.[1]?.trim() || fallback;
}

/** Baixa arquivo de rota autenticada (export CSV/JSON etc.). */
export async function downloadApiFile(path: string, fallbackFilename: string): Promise<void> {
  const token = getToken();
  const res = await fetch(path, {
    headers: token ? { authorization: `Bearer ${token}` } : {}
  });

  if (res.status === 401) {
    clearToken();
    window.location.href = "/login";
    throw new Error("Sessão expirada");
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(sanitizeErrorMessage(text || `HTTP ${res.status}`, res.status));
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filenameFromContentDisposition(res.headers.get("content-disposition"), fallbackFilename);
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
