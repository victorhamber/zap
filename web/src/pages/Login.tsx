import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, setToken } from "../api/client";

export function Login() {
  const nav = useNavigate();
  const [email, setEmail] = useState("");
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
      setError(err?.message ?? "Falha no login");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950/80 p-8 shadow-xl backdrop-blur"
      >
        <h1 className="text-2xl font-semibold tracking-tight">Zap Automação</h1>
        <p className="mt-1 text-sm text-zinc-400">Login administrador</p>

        {error && (
          <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        )}

        <label className="mt-6 block text-xs text-zinc-400">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-emerald-500/50"
          required
        />

        <label className="mt-4 block text-xs text-zinc-400">Senha</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm outline-none focus:border-emerald-500/50"
          required
        />

        <button
          type="submit"
          disabled={loading}
          className="mt-6 w-full rounded-xl bg-emerald-400 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-emerald-300 disabled:opacity-50"
        >
          {loading ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
