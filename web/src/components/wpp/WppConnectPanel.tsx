import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api/client";

type WppSettings = {
  wppBaseUrl: string;
  wppSession: string;
  hasToken: boolean;
  connectionStatus: string | null;
};

const CONNECTED_STATES = new Set([
  "CONNECTED",
  "ISCONNECTED",
  "SUCCESS",
  "INCHAT",
  "MAIN",
  "NORMAL"
]);

function isConnectedState(state: string): boolean {
  const s = state.toUpperCase();
  if (CONNECTED_STATES.has(s)) return true;
  return s.includes("CONNECTED") && !s.includes("DIS");
}

export function WppConnectPanel({ compact = false }: { compact?: boolean }) {
  const [settings, setSettings] = useState<WppSettings | null>(null);
  const [state, setState] = useState("");
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [diag, setDiag] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadSettings = useCallback(async () => {
    const s = await api<WppSettings>("/api/settings/wpp");
    setSettings(s);
  }, []);

  const refreshSession = useCallback(async () => {
    try {
      const r = await api<{ ok: boolean; state?: string; status?: unknown; error?: string }>(
        "/api/settings/wpp/session"
      );
      if (r.ok && r.state) {
        setState(r.state);
        if (isConnectedState(r.state)) {
          setQrImage(null);
          setMsg("WhatsApp conectado.");
        }
      }
    } catch {
      /* ignora entre polls */
    }
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
        setMsg("WhatsApp conectado.");
      }
    } catch {
      /* sessão pode ainda não ter QR */
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
      refreshSession();
      refreshQr();
    }, 4000);
  }, [stopPolling, refreshSession, refreshQr]);

  useEffect(() => {
    loadSettings();
    refreshSession();
    return () => stopPolling();
  }, [loadSettings, refreshSession, stopPolling]);

  useEffect(() => {
    if (qrImage && !isConnectedState(state)) startPolling();
    else stopPolling();
  }, [qrImage, state, startPolling, stopPolling]);

  async function connect() {
    setLoading(true);
    setError("");
    setMsg("Iniciando sessão…");
    try {
      await api("/api/settings/wpp/refresh-token", { method: "POST" });
      const r = await api<{
        ok: boolean;
        qrImage?: string | null;
        state?: string;
        error?: string;
      }>("/api/settings/wpp/start-session", { method: "POST" });
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
    setLoading(true);
    setError("");
    try {
      await api("/api/settings/wpp/close-session", { method: "POST" });
      setQrImage(null);
      setState("CLOSED");
      setMsg("Sessão fechada.");
      stopPolling();
    } catch (e: any) {
      setError(e?.message ?? "Erro ao fechar");
    } finally {
      setLoading(false);
    }
  }

  async function logoutSession() {
    setLoading(true);
    setError("");
    try {
      await api("/api/settings/wpp/logout-session", { method: "POST" });
      setQrImage(null);
      setState("LOGOUT");
      setMsg("Desconectado. Conecte de novo para gerar novo QR.");
      stopPolling();
    } catch (e: any) {
      setError(e?.message ?? "Erro ao desconectar");
    } finally {
      setLoading(false);
    }
  }

  async function runDiagnostics() {
    setLoading(true);
    setError("");
    setDiag(null);
    try {
      const r = await api<{
        ok: boolean;
        steps?: Array<{ step: string; ok: boolean; detail: string }>;
        baseUrl?: string;
        error?: string;
      }>("/api/settings/wpp/diagnostics");
      if (r.error) throw new Error(r.error);
      const lines = (r.steps ?? []).map((s) => `${s.ok ? "✓" : "✗"} ${s.step}: ${s.detail}`);
      setDiag(lines.join("\n"));
      if (!r.ok) setError("Diagnóstico encontrou falhas — veja abaixo.");
    } catch (e: any) {
      setError(e?.message ?? "Diagnóstico falhou");
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
        <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}
      {msg && <p className="mt-3 text-sm text-zinc-400">{msg}</p>}

      {qrImage && !connected && (
        <div className="mt-5 flex flex-col items-center">
          <div className="rounded-2xl bg-white p-3 shadow-lg">
            <img src={qrImage} alt="QR Code WhatsApp" className="h-56 w-56 object-contain" />
          </div>
          <p className="mt-3 text-xs text-zinc-500 text-center max-w-sm">
            O QR expira em ~60s. Atualizamos automaticamente a cada poucos segundos.
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
          onClick={refreshSession}
          className="rounded-xl border border-zinc-700 px-4 py-2 text-sm hover:bg-zinc-900 disabled:opacity-50"
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
        <button
          type="button"
          disabled={loading}
          onClick={runDiagnostics}
          className="rounded-xl border border-amber-700/50 px-4 py-2 text-sm text-amber-200/90 hover:bg-amber-950/30 disabled:opacity-50"
        >
          Testar ligação Zap → WPP
        </button>
      </div>

      {diag && (
        <pre className="mt-4 max-h-48 overflow-auto rounded-xl border border-zinc-800 bg-black/40 p-3 text-xs text-zinc-400 whitespace-pre-wrap">
          {diag}
        </pre>
      )}

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
