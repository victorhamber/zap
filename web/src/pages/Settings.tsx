import { useEffect, useState } from "react";
import { api } from "../api/client";

type WppSettings = {
  wppBaseUrl: string;
  wppSession: string;
  hasToken: boolean;
  connectionStatus: string | null;
};

export function Settings() {
  const [settings, setSettings] = useState<WppSettings | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [session, setSession] = useState("");
  const [status, setStatus] = useState("");
  const [msg, setMsg] = useState("");

  async function load() {
    const s = await api<WppSettings>("/api/settings/wpp");
    setSettings(s);
    setBaseUrl(s.wppBaseUrl);
    setSession(s.wppSession);
  }

  useEffect(() => {
    load();
  }, []);

  async function save() {
    setMsg("Salvando…");
    await api("/api/settings/wpp", {
      method: "PUT",
      body: JSON.stringify({ wppBaseUrl: baseUrl, wppSession: session })
    });
    setMsg("Salvo.");
    load();
  }

  async function refreshToken() {
    setMsg("Atualizando token…");
    await api("/api/settings/wpp/refresh-token", { method: "POST" });
    setMsg("Token atualizado.");
    load();
  }

  async function checkStatus() {
    setStatus("Verificando…");
    const r = await api<{ ok: boolean; status?: unknown; error?: string }>(
      "/api/settings/wpp/status"
    );
    setStatus(r.ok ? "OK" : r.error ?? "Erro");
    load();
  }

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold">Configurações</h1>
      <p className="text-sm text-zinc-400 mt-1">Integração WPPConnect</p>

      {msg && <p className="mt-4 text-sm text-zinc-400">{msg}</p>}

      <div className="mt-6 space-y-4 rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5">
        <div>
          <label className="text-xs text-zinc-500">URL base</label>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm font-mono"
          />
        </div>
        <div>
          <label className="text-xs text-zinc-500">Sessão</label>
          <input
            value={session}
            onChange={(e) => setSession(e.target.value)}
            className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm font-mono"
          />
        </div>
        <div className="text-xs text-zinc-500">
          Token salvo: {settings?.hasToken ? "sim" : "não"}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={save}
            className="rounded-lg bg-emerald-400 px-3 py-2 text-sm font-semibold text-zinc-950"
          >
            Salvar
          </button>
          <button
            onClick={refreshToken}
            className="rounded-lg border border-zinc-700 px-3 py-2 text-sm"
          >
            Renovar token
          </button>
          <button
            onClick={checkStatus}
            className="rounded-lg border border-zinc-700 px-3 py-2 text-sm"
          >
            Testar conexão
          </button>
        </div>
        {status && <p className="text-sm text-zinc-400">Status: {status}</p>}
      </div>

      <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-950/40 p-4 text-sm text-zinc-400">
        <p>
          QR Code: abra{" "}
          <a
            href={`${baseUrl}/api-docs`}
            target="_blank"
            rel="noreferrer"
            className="text-emerald-400 underline"
          >
            Swagger do WPPConnect
          </a>{" "}
          e use <code className="text-zinc-300">qrcode-session</code> para a sessão{" "}
          <code className="text-zinc-300">{session}</code>.
        </p>
        <p className="mt-2">
          Webhook inbound (mensagens recebidas): configure no start-session do WPP:
        </p>
        <code className="block mt-1 text-xs text-zinc-300 break-all">
          {typeof window !== "undefined"
            ? `${window.location.origin}/api/webhooks/wppconnect`
            : "/api/webhooks/wppconnect"}
        </code>
      </div>
    </div>
  );
}
