import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, setToken } from "../api/client";

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
    } catch (err: any) {
      setError(
        err?.message?.includes("401") || err?.message?.includes("Credenciais")
          ? "Email ou senha incorretos. Use o ADMIN_EMAIL e ADMIN_PASSWORD do EasyPanel."
          : err?.message ?? "Não foi possível entrar. Verifique se o app subiu com o banco."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15 border border-emerald-500/30 text-2xl font-bold text-emerald-400">
            Z
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-white">Zap Automação</h1>
          <p className="mt-1 text-sm text-zinc-400">WhatsApp + fluxos visuais</p>
        </div>

        <form
          onSubmit={submit}
          className="rounded-2xl border border-zinc-800/80 bg-zinc-950/80 p-6 shadow-2xl shadow-black/40 backdrop-blur"
        >
          {error && (
            <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2.5 text-sm text-red-200">
              {error}
            </div>
          )}

          <label className="block text-xs font-medium text-zinc-400 mb-1.5">Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mb-4 w-full rounded-xl border border-zinc-700 bg-zinc-900/80 px-3 py-2.5 text-sm text-white outline-none transition focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-500/20"
            required
            autoComplete="email"
          />

          <label className="block text-xs font-medium text-zinc-400 mb-1.5">Senha</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mb-6 w-full rounded-xl border border-zinc-700 bg-zinc-900/80 px-3 py-2.5 text-sm text-white outline-none transition focus:border-emerald-500/60 focus:ring-2 focus:ring-emerald-500/20"
            required
            autoComplete="current-password"
          />

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-emerald-500 py-2.5 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-50"
          >
            {loading ? "Entrando…" : "Entrar"}
          </button>

          <p className="mt-4 text-center text-xs text-zinc-500">
            Use as variáveis <span className="text-zinc-400">ADMIN_EMAIL</span> e{" "}
            <span className="text-zinc-400">ADMIN_PASSWORD</span> do EasyPanel.
          </p>
        </form>
      </div>
    </div>
  );
}
