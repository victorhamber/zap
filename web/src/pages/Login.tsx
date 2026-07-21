import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, setToken } from "../api/client";
import { ErrorNotice, Icon, inputClass } from "../components/ui";

export function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState("admin@trajettu.com");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await api<{ token: string }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password })
      });
      setToken(res.token);
      nav("/");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "";
      setError(
        message.includes("401") || message.includes("Credenciais")
          ? "Email ou senha incorretos. Use o ADMIN_EMAIL e ADMIN_PASSWORD do EasyPanel."
          : message || "Não foi possível entrar. Verifique se o app subiu com o banco."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden p-6">
      {/* halo de fundo */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-0 h-[520px] w-[720px] -translate-x-1/2 -translate-y-1/3 rounded-full bg-brand-500/10 blur-[120px]"
      />

      <div className="zap-enter relative w-full max-w-[400px]">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 text-2xl font-bold text-zinc-950 shadow-xl shadow-emerald-500/25">
            Z
          </div>
          <h1 className="text-[26px] font-semibold tracking-tight text-white">Zap Automação</h1>
          <p className="mt-1.5 text-sm text-zinc-500">WhatsApp, inbox e fluxos visuais</p>
        </div>

        <form
          onSubmit={submit}
          className="rounded-2xl border border-[var(--line)] bg-[var(--surface-1)]/90 p-6 shadow-2xl shadow-black/50 backdrop-blur-xl"
        >
          {error && (
            <div className="mb-5">
              <ErrorNotice>{error}</ErrorNotice>
            </div>
          )}

          <label htmlFor="login-email" className="mb-1.5 block text-xs font-medium text-zinc-400">
            Email
          </label>
          <input
            id="login-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={`${inputClass} mb-4`}
            required
            autoComplete="email"
          />

          <label htmlFor="login-password" className="mb-1.5 block text-xs font-medium text-zinc-400">
            Senha
          </label>
          <input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={`${inputClass} mb-6`}
            required
            autoComplete="current-password"
          />

          <button
            type="submit"
            disabled={loading}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand-500 text-sm font-semibold text-zinc-950 transition hover:bg-brand-400 active:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? (
              <>
                <Icon name="refresh" className="h-4 w-4 animate-spin" />
                Entrando…
              </>
            ) : (
              "Entrar"
            )}
          </button>
        </form>

        <p className="mt-5 text-center text-xs leading-relaxed text-zinc-600">
          Credenciais definidas em <span className="text-zinc-500">ADMIN_EMAIL</span> e{" "}
          <span className="text-zinc-500">ADMIN_PASSWORD</span> no EasyPanel.
        </p>
      </div>
    </div>
  );
}
