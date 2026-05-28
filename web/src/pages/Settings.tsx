import { useEffect, useState } from "react";
import { api } from "../api/client";
import { WppConnectPanel } from "../components/wpp/WppConnectPanel";

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
    setMsg("Salvo. Reconecte o WhatsApp se mudou URL ou sessão.");
    load();
  }

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Configurações</h1>
        <p className="text-sm text-zinc-400 mt-1">Servidor WPPConnect e integração</p>
      </div>

      <WppConnectPanel />

      {msg && <p className="text-sm text-zinc-400">{msg}</p>}

      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-zinc-300">Servidor (avançado)</h2>
        <div>
          <label className="text-xs text-zinc-500">URL base do WPPConnect</label>
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm font-mono text-white"
          />
        </div>
        <div>
          <label className="text-xs text-zinc-500">Nome da sessão</label>
          <input
            value={session}
            onChange={(e) => setSession(e.target.value)}
            className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm font-mono text-white"
          />
        </div>
        <div className="text-xs text-zinc-500">
          Token API: {settings?.hasToken ? "configurado" : "será gerado ao conectar"}
        </div>
        <button
          type="button"
          onClick={save}
          className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400"
        >
          Salvar servidor
        </button>
      </div>
    </div>
  );
}
