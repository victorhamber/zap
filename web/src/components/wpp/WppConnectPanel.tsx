import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api/client";

type WppSettings = {
  wppBaseUrl: string;
  wppSession: string;
  hasToken: boolean;
  connectionStatus: string | null;
};

function isConnectedState(state: string): boolean {
  const s = state.toUpperCase();
  const ok = new Set([
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
  if (ok.has(s)) return true;
  return s.includes("CONNECTED") && !s.includes("DIS");
}

export function WppConnectPanel({ compact = false }: { compact?: boolean }) {
  const [settings, setSettings] = useState<WppSettings | null>(null);
  const [state, setState] = useState("");
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadSettings = useCallback(async () => {
    const s = await api<WppSettings>("/api/settings/wpp");
    setSettings(s);
  }, []);

  const refreshQr = useCallback(async () => {
    try {
      const r = await api<{
        ok: boolean;
        qrImage?: string | null;
        state?: string;
        error?: string;
      }>("/api/settings/wpp/qrcode");
      if (!r.ok) return;
      if (r.state) setState(r.state);
      if (r.qrImage) setQrImage(r.qrImage);
      if (r.state && isConnectedState(r.state)) {
        setQrImage(null);
      }
    } catch {
      /* sessão pode ainda não ter QR */
    }
  }, []);

  const verifyConnection = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    setError("");
    try {
      const r = await api<{
        ok: boolean;
        connected?: boolean;
        state?: string;
        message?: string;
        error?: string;
      }>("/api/settings/wpp/verify");
      if (!r.ok) throw new Error(r.error ?? "Falha ao verificar");

      if (r.state) setState(r.state);
      if (r.connected) {
        setQrImage(null);
        setMsg(r.message ?? "WhatsApp conectado e operacional.");
      } else {
        setMsg(r.message ?? `Status atual: ${r.state ?? "desconhecido"}`);
      }
    } catch (e: any) {
      setError(e?.message ?? "Não foi possível verificar a conexão");
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(() => {
      refreshQr();
    }, 4000);
  }, [stopPolling, refreshQr]);

  useEffect(() => {
    loadSettings();
    verifyConnection(false);
    return () => stopPolling();
  }, [loadSettings, verifyConnection, stopPolling]);

  useEffect(() => {
    if (qrImage && !isConnectedState(state)) startPolling();
    else stopPolling();
  }, [qrImage, state, startPolling, stopPolling]);

  async function connect() {
    setLoading(true);
    setError("");
    setMsg("Iniciando sessão…");
    try {
      await api("/api/settings/wpp/refresh-token", {
        method: "POST",
        body: JSON.stringify({})
      });
      const r = await api<{
        ok: boolean;
        qrImage?: string | null;
        state?: string;
        error?: string;
      }>("/api/settings/wpp/start-session", {
        method: "POST",
        body: JSON.stringify({})
      });
      if (!r.ok) throw new Error(r.error ?? "Falha ao iniciar sessão");
      if (r.state) setState(r.state);
      if (r.qrImage) {
        setQrImage(r.qrImage);
        setMsg("Escaneie o QR Code no celular (WhatsApp → Aparelhos conectados).");
        startPolling();
      } else {
        await refreshQr();
        setMsg("Sessão iniciada. Aguardando QR…");
        startPolling();
      }
    } catch (e: any) {
      setError(e?.message ?? "Erro ao conectar");
    } finally {
      setLoading(false);
    }
  }

  async function refreshQrNow() {
    setLoading(true);
    setError("");
    try {
      await refreshQr();
      setMsg("QR atualizado.");
    } catch (e: any) {
      setError(e?.message ?? "Erro ao buscar QR");
    } finally {
      setLoading(false);
    }
  }

  async function closeSession() {
    if (!confirm("Fechar sessão? Pausa o WhatsApp no servidor (pode reconectar depois sem novo QR, se a sessão ainda existir)."))
      return;
    setLoading(true);
    setError("");
    try {
      const r = await api<{ ok: boolean; message?: string }>("/api/settings/wpp/close-session", {
        method: "POST",
        body: JSON.stringify({})
      });
      setQrImage(null);
      setState("CLOSED");
      setMsg(r.message ?? "Sessão fechada.");
      stopPolling();
    } catch (e: any) {
      setError(e?.message ?? "Erro ao fechar");
    } finally {
      setLoading(false);
    }
  }

  async function logoutSession() {
    if (
      !confirm(
        "Desconectar completamente? O WhatsApp será deslogado e você precisará escanear o QR Code de novo."
      )
    )
      return;
    setLoading(true);
    setError("");
    try {
      const r = await api<{ ok: boolean; message?: string }>("/api/settings/wpp/logout-session", {
        method: "POST",
        body: JSON.stringify({})
      });
      setQrImage(null);
      setState("LOGOUT");
      setMsg(r.message ?? "Desconectado. Escaneie o QR para conectar de novo.");
      stopPolling();
    } catch (e: any) {
      setError(e?.message ?? "Erro ao desconectar");
    } finally {
      setLoading(false);
    }
  }

  const connected = isConnectedState(state);

  return (
    <div className={compact ? "" : "rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5"}>
      {!compact && (
        <div className="mb-4">
          <h2 className="text-lg font-semibold text-white">Conexão WhatsApp</h2>
          <p className="text-sm text-zinc-400 mt-0.5">
            Conecte o número da instância ativa escaneando o QR abaixo.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-zinc-500">Sessão:</span>
        <code className="text-zinc-300">{settings?.wppSession ?? "…"}</code>
        <span
          className={`ml-2 rounded-full px-2.5 py-0.5 text-xs font-medium ${
            connected
              ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/25"
              : "bg-zinc-800 text-zinc-400"
          }`}
        >
          {connected ? "Conectado" : state || "Desconhecido"}
        </span>
      </div>

      {error && (
        <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200 max-h-32 overflow-auto">
          {error}
        </div>
      )}

      <p className="mt-3 text-xs text-zinc-500 leading-relaxed">
        <strong className="text-zinc-400">Fechar sessão</strong> — pausa o navegador no WPP (sessão
        fica salva).{" "}
        <strong className="text-zinc-400">Desconectar</strong> — logout total; exige novo QR para
        voltar.
      </p>
      {msg && (
        <p
          className={`mt-3 text-sm ${
            connected ? "text-emerald-400/90" : "text-zinc-400"
          }`}
        >
          {msg}
        </p>
      )}

      {qrImage && !connected && (
        <div className="mt-5 flex flex-col items-center">
          <div className="rounded-2xl bg-white p-3 shadow-lg">
            <img src={qrImage} alt="QR Code WhatsApp" className="h-56 w-56 object-contain" />
          </div>
          <p className="mt-3 text-xs text-zinc-500 text-center max-w-sm">
            Escaneie em até ~60s (o WPP fecha sozinho se demorar). Atualizamos o QR automaticamente.
          </p>
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        {!connected && (
          <button
            type="button"
            disabled={loading}
            onClick={connect}
            className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
          >
            {loading ? "Aguarde…" : qrImage ? "Gerar novo QR" : "Conectar / Mostrar QR"}
          </button>
        )}
        {qrImage && !connected && (
          <button
            type="button"
            disabled={loading}
            onClick={refreshQrNow}
            className="rounded-xl border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-900 disabled:opacity-50"
          >
            Atualizar QR
          </button>
        )}
        <button
          type="button"
          disabled={loading}
          onClick={() => verifyConnection(true)}
          className="rounded-xl border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-900 disabled:opacity-50"
          title="Confere se o WhatsApp desta instância ainda está conectado"
        >
          Verificar status
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={closeSession}
          className="rounded-xl border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-900 disabled:opacity-50"
        >
          Fechar sessão
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={logoutSession}
          className="rounded-xl border border-red-900/50 px-4 py-2 text-sm text-red-300 hover:bg-red-950/40 disabled:opacity-50"
        >
          Desconectar
        </button>
      </div>

      {!compact && (
        <p className="mt-4 text-xs text-zinc-500">
          Webhook de mensagens recebidas:{" "}
          <code className="text-zinc-400 break-all">
            {typeof window !== "undefined"
              ? `${window.location.origin}/api/webhooks/wppconnect`
              : "/api/webhooks/wppconnect"}
          </code>
          <br />
          Configurado automaticamente ao iniciar a sessão.
        </p>
      )}
    </div>
  );
}
