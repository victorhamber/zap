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
    if (message === "Bad Request" && text.length > 20) {
      message = text.slice(0, 500);
    }
    throw new Error(message);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
