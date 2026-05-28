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
      return "Servidor WPP indisponível (502). Verifique se o WPPConnect está online e o WPP_INTERNAL_URL no EasyPanel.";
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
