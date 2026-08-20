import { useEffect, useState } from "react";
import { api } from "../../api/client";

type EmailSettings = {
  hasApiKey: boolean;
  apiKeyMasked: string | null;
  emailFrom: string;
  emailFromName: string;
  encryptionReady: boolean;
};

export function EmailSettingsPanel() {
  const [settings, setSettings] = useState<EmailSettings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [emailFrom, setEmailFrom] = useState("");
  const [emailFromName, setEmailFromName] = useState("");
  const [testTo, setTestTo] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const data = await api<EmailSettings>("/api/settings/email");
    setSettings(data);
    setEmailFrom(data.emailFrom);
    setEmailFromName(data.emailFromName);
  }

  useEffect(() => {
    void load().catch((e) => setMessage(e instanceof Error ? e.message : String(e)));
  }, []);

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const data = await api<EmailSettings>("/api/settings/email", {
        method: "PUT",
        body: JSON.stringify({
          emailFrom,
          emailFromName,
          ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {})
        })
      });
      setSettings(data);
      setApiKey("");
      setMessage("Configurações de e-mail salvas.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function removeKey() {
    if (!window.confirm("Remover a API key do Resend?")) return;
    setBusy(true);
    setMessage(null);
    try {
      const data = await api<EmailSettings>("/api/settings/email", {
        method: "PUT",
        body: JSON.stringify({ removeApiKey: true })
      });
      setSettings(data);
      setMessage("API key removida.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function sendTest() {
    setBusy(true);
    setMessage(null);
    try {
      await api("/api/settings/email/test", {
        method: "POST",
        body: JSON.stringify({ to: testTo.trim() })
      });
      setMessage(`E-mail de teste enviado para ${testTo.trim()}.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5 rounded-2xl border border-[var(--line)] bg-[var(--surface-1)] p-5">
      <div>
        <h2 className="text-base font-semibold text-white">E-mail (Resend)</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Configure a API do Resend para o bloco &quot;Enviar e-mail&quot; nos fluxos. O domínio do
          remetente precisa estar verificado no painel da Resend.
        </p>
      </div>

      {!settings?.encryptionReady && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          Criptografia indisponível — defina AI_ENCRYPTION_KEY ou JWT_SECRET no ambiente da API.
        </div>
      )}

      <div className="space-y-3">
        <div>
          <label className="text-xs text-zinc-500">API key Resend</label>
          <div className="mt-1 flex gap-2">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={settings?.apiKeyMasked || "re_…"}
              className="flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
              autoComplete="off"
            />
            {settings?.hasApiKey && (
              <button
                type="button"
                onClick={() => void removeKey()}
                disabled={busy}
                className="rounded-xl border border-zinc-700 px-3 py-2 text-sm text-zinc-400 hover:bg-zinc-800"
              >
                Remover
              </button>
            )}
          </div>
          {settings?.hasApiKey && (
            <p className="mt-1 text-[11px] text-zinc-600">
              Chave atual: {settings.apiKeyMasked} — deixe em branco para manter.
            </p>
          )}
        </div>

        <div>
          <label className="text-xs text-zinc-500">Nome do remetente</label>
          <input
            value={emailFromName}
            onChange={(e) => setEmailFromName(e.target.value)}
            placeholder="Equipe Trajettu"
            className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
          />
        </div>

        <div>
          <label className="text-xs text-zinc-500">E-mail remetente (From)</label>
          <input
            value={emailFrom}
            onChange={(e) => setEmailFrom(e.target.value)}
            placeholder="ola@seudominio.com"
            className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
          />
        </div>

        <button
          type="button"
          onClick={() => void save()}
          disabled={busy}
          className="rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
        >
          Salvar
        </button>
      </div>

      <div className="border-t border-zinc-800 pt-4 space-y-3">
        <div className="text-sm font-medium text-zinc-300">Enviar e-mail de teste</div>
        <div className="flex gap-2">
          <input
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            placeholder="seu@email.com"
            className="flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
          />
          <button
            type="button"
            onClick={() => void sendTest()}
            disabled={busy || !testTo.trim()}
            className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50"
          >
            Testar
          </button>
        </div>
      </div>

      {message && (
        <p className="text-xs text-zinc-400" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
