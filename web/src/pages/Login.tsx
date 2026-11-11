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
    <div className="relative flex min-h-full items-center justify-center p-6">
      <div className="zap-enter relative w-full max-w-[380px]">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-zinc-900 text-emerald-400 shadow-md">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-6 w-6"
            >
              <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-100">Zap Workspace</h1>
          <p className="mt-1 text-xs text-zinc-400">Automações, CRM e atendimento WhatsApp</p>
        </div>

        <form
          onSubmit={submit}
          className="rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-6 shadow-xl shadow-black/40"
        >
          {error && (
            <div className="mb-4">
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
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 text-sm font-medium text-white shadow-xs transition-colors hover:bg-emerald-500 active:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? (
              <>
                <Icon name="refresh" className="h-4 w-4 animate-spin" />
                Entrando…
              </>
            ) : (
              "Acessar painel"
            )}
          </button>
        </form>

        <p className="mt-5 text-center text-xs leading-relaxed text-zinc-500">
          Credenciais definidas em <span className="font-mono text-zinc-400">ADMIN_EMAIL</span> e{" "}
          <span className="font-mono text-zinc-400">ADMIN_PASSWORD</span>.
        </p>
      </div>
    </div>
  );
}
