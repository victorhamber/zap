import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api/client";

type WppSettings = {
  wppBaseUrl: string;
  wppSession: string;
  hasToken: boolean;
  connectionStatus: string | null;
};

type NoticeKind = "idle" | "checking" | "connected" | "no_device" | "info" | "warn";

export function WppConnectPanel({ compact = false }: { compact?: boolean }) {
  const [settings, setSettings] = useState<WppSettings | null>(null);
  const [state, setState] = useState("");
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [noticeKind, setNoticeKind] = useState<NoticeKind>("idle");
  const [noticeText, setNoticeText] = useState(
    'Clique em "Verificar status" para ver se há um aparelho conectado.'
  );
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isConnected = noticeKind === "connected";

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
      }>("/api/settings/wpp/qrcode");
      if (!r.ok) return;
      if (r.state) setState(r.state);
      if (r.qrImage) setQrImage(r.qrImage);
    } catch {
      /* ignora */
    }
  }, []);

  const applyVerifyResult = useCallback(
    (r: {
      connected?: boolean;
      noSession?: boolean;
      state?: string;
      message?: string;
      wppReachable?: boolean;
    }) => {
      if (r.state) setState(r.state);
      const text = r.message ?? "";

      if (r.connected) {
        setNoticeKind("connected");
        setNoticeText(
          text ||
            `Aparelho conectado na instância "${settings?.wppSession ?? ""}".`
        );
        setQrImage(null);
        return;
      }

      setNoticeKind(r.wppReachable === false ? "warn" : "no_device");
      setNoticeText(
        text ||
          'Nenhum aparelho WhatsApp conectado. Clique em "Conectar / Mostrar QR" para vincular um novo dispositivo.'
      );
    },
    [settings?.wppSession]
  );

  const verifyConnection = useCallback(
    async (showLoading = true) => {
      if (showLoading) setLoading(true);
      setNoticeKind("checking");
      setNoticeText("Verificando se há aparelho conectado…");

      try {
        const r = await api<{
          ok: boolean;
          connected?: boolean;
          noSession?: boolean;
          state?: string;
          message?: string;
          wppReachable?: boolean;
          error?: string;
        }>("/api/settings/wpp/verify");

        if (!r.ok) {
          setNoticeKind("no_device");
          setNoticeText(
            r.error ??
              'Nenhum aparelho conectado. Use "Conectar / Mostrar QR" para vincular um novo dispositivo.'
          );
          return;
        }

        applyVerifyResult(r);
      } catch (e: any) {
        setNoticeKind("warn");
        setNoticeText(e?.message ?? "Não foi possível verificar o status.");
      } finally {
        if (showLoading) setLoading(false);
      }
    },
    [applyVerifyResult]
  );

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const startPolling = useCallback(() => {
    stopPolling();
    pollRef.current = setInterval(() => refreshQr(), 4000);
  }, [stopPolling, refreshQr]);

  useEffect(() => {
    loadSettings();
    verifyConnection(false);
    return () => stopPolling();
  }, [loadSettings, verifyConnection, stopPolling]);

  useEffect(() => {
    if (qrImage && !isConnected) startPolling();
    else stopPolling();
  }, [qrImage, isConnected, startPolling, stopPolling]);

  async function connect() {
    setLoading(true);
    setNoticeKind("checking");
    setNoticeText("Iniciando sessão…");
    try {
      await api("/api/settings/wpp/refresh-token", {
        method: "POST",
        body: JSON.stringify({})
      });
      const r = await api<{
        ok: boolean;
        qrImage?: string | null;
        state?: string;
        message?: string;
      }>("/api/settings/wpp/start-session", {
        method: "POST",
        body: JSON.stringify({})
      });
      if (!r.ok) throw new Error(r.message ?? "Falha ao iniciar sessão");
      if (r.state) setState(r.state);
      if (r.qrImage) {
        setQrImage(r.qrImage);
        setNoticeKind("info");
        setNoticeText(
          "Escaneie o QR no celular (WhatsApp → Aparelhos conectados → Conectar aparelho)."
        );
        startPolling();
      } else {
        await refreshQr();
        setNoticeKind("info");
        setNoticeText("Aguardando QR Code…");
        startPolling();
      }
    } catch (e: any) {
      setNoticeKind("warn");
      setNoticeText(e?.message ?? "Erro ao conectar.");
    } finally {
      setLoading(false);
    }
  }

  async function refreshQrNow() {
    setLoading(true);
    try {
      await refreshQr();
      setNoticeKind("info");
      setNoticeText("QR atualizado — escaneie para vincular o aparelho.");
    } catch (e: any) {
      setNoticeKind("warn");
      setNoticeText(e?.message ?? "Erro ao buscar QR.");
    } finally {
      setLoading(false);
    }
  }

  async function closeSession() {
    if (
      !confirm(
        "Fechar sessão? Pausa o WhatsApp no servidor (a sessão fica salva no WPP)."
      )
    )
      return;
    setLoading(true);
    try {
      const r = await api<{
        ok: boolean;
        noSession?: boolean;
        message?: string;
      }>("/api/settings/wpp/close-session", {
        method: "POST",
        body: JSON.stringify({})
      });
      setQrImage(null);
      setState("CLOSED");
      stopPolling();
      if (r.noSession || !r.ok) {
        setNoticeKind("no_device");
        setNoticeText(
          r.message ??
            'Não há sessão ativa. Use "Conectar / Mostrar QR" para vincular um aparelho.'
        );
      } else {
        setNoticeKind("info");
        setNoticeText(r.message ?? "Sessão fechada.");
      }
      await verifyConnection(false);
    } catch (e: any) {
      setNoticeKind("warn");
      setNoticeText(e?.message ?? "Erro ao fechar sessão.");
    } finally {
      setLoading(false);
    }
  }

  async function logoutSession() {
    if (
      !confirm(
        "Desconectar completamente? Será necessário escanear o QR Code novamente."
      )
    )
      return;
    setLoading(true);
    try {
      const r = await api<{
        ok: boolean;
        noSession?: boolean;
        message?: string;
      }>("/api/settings/wpp/logout-session", {
        method: "POST",
        body: JSON.stringify({})
      });
      setQrImage(null);
      setState("LOGOUT");
      stopPolling();
      if (r.noSession || !r.ok) {
        setNoticeKind("no_device");
        setNoticeText(
          r.message ??
            'Nenhum aparelho vinculado. Use "Conectar / Mostrar QR" para conectar de novo.'
        );
      } else {
        setNoticeKind("no_device");
        setNoticeText(
          r.message ??
            "Desconectado. Escaneie o QR em Conectar / Mostrar QR para vincular de novo."
        );
      }
    } catch (e: any) {
      setNoticeKind("warn");
      setNoticeText(e?.message ?? "Erro ao desconectar.");
    } finally {
      setLoading(false);
    }
  }

  const noticeClass =
    noticeKind === "connected"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-100"
      : noticeKind === "no_device"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-50"
        : noticeKind === "warn"
          ? "border-red-500/35 bg-red-500/10 text-red-100"
          : noticeKind === "checking"
            ? "border-zinc-600 bg-zinc-900/80 text-zinc-300"
            : noticeKind === "info"
              ? "border-sky-500/30 bg-sky-500/10 text-sky-100"
              : "border-zinc-700 bg-zinc-900/50 text-zinc-400";

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
            isConnected
              ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/25"
              : noticeKind === "no_device"
                ? "bg-amber-500/15 text-amber-200 border border-amber-500/30"
                : "bg-zinc-800 text-zinc-400 border border-zinc-700"
          }`}
        >
          {isConnected
            ? "Conectado"
            : noticeKind === "checking"
              ? "Verificando…"
              : state || "Sem aparelho"}
        </span>
        {settings?.hasToken && (
          <span className="text-xs text-zinc-600" title="Token da API salvo no banco (persiste no deploy do Zap)">
            token salvo
          </span>
        )}
      </div>

      <div className={`mt-4 rounded-xl border px-4 py-3 text-sm ${noticeClass}`}>
        <p className="font-medium leading-snug">{noticeText}</p>
      </div>

      <p className="mt-3 text-xs text-zinc-500 leading-relaxed">
        <strong className="text-zinc-400">Fechar sessão</strong> — pausa no WPP.{" "}
        <strong className="text-zinc-400">Desconectar</strong> — logout (novo QR depois).
      </p>

      {qrImage && !isConnected && (
        <div className="mt-5 flex flex-col items-center">
          <div className="rounded-2xl bg-white p-3 shadow-lg">
            <img src={qrImage} alt="QR Code WhatsApp" className="h-56 w-56 object-contain" />
          </div>
          <p className="mt-3 text-xs text-zinc-500 text-center max-w-sm">
            Escaneie em até ~60s. O QR atualiza sozinho enquanto esta tela estiver aberta.
          </p>
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        {!isConnected && (
          <button
            type="button"
            disabled={loading}
            onClick={connect}
            className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
          >
            {loading ? "Aguarde…" : qrImage ? "Gerar novo QR" : "Conectar / Mostrar QR"}
          </button>
        )}
        {qrImage && !isConnected && (
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
          className="rounded-xl border border-emerald-700/50 bg-emerald-950/30 px-4 py-2 text-sm text-emerald-200 hover:bg-emerald-950/50 disabled:opacity-50"
        >
          {loading && noticeKind === "checking" ? "Verificando…" : "Verificar status"}
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
          Webhook:{" "}
          <code className="text-zinc-400 break-all">
            {typeof window !== "undefined"
              ? `${window.location.origin}/api/webhooks/wppconnect`
              : "/api/webhooks/wppconnect"}
          </code>
        </p>
      )}
    </div>
  );
}
