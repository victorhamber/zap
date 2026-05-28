import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";

type Flow = { id: string; name: string; enabled: boolean };
type Run = {
  id: string;
  status: string;
  contactPhone: string;
  createdAt: string;
  flow?: { name: string };
};

export function Dashboard() {
  const [flows, setFlows] = useState<Flow[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [wppStatus, setWppStatus] = useState<string>("");

  useEffect(() => {
    api<Flow[]>("/api/flows").then(setFlows).catch(() => {});
    api<Run[]>("/api/runs?limit=10").then(setRuns).catch(() => {});
    api<{ ok: boolean; status?: unknown; error?: string }>("/api/settings/wpp/status")
      .then((r) => setWppStatus(r.ok ? "Conectado" : r.error ?? "Erro"))
      .catch(() => setWppStatus("Indisponível"));
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <p className="text-sm text-zinc-400 mt-1">Visão geral das automações</p>

      <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
          <div className="text-xs text-zinc-500">Fluxos</div>
          <div className="text-2xl font-semibold mt-1">{flows.length}</div>
          <div className="text-xs text-zinc-400 mt-1">
            {flows.filter((f) => f.enabled).length} ativos
          </div>
        </div>
        <Link
          to="/whatsapp"
          className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4 block hover:border-emerald-500/30 transition"
        >
          <div className="text-xs text-zinc-500">WhatsApp</div>
          <div className="text-lg font-medium mt-1 text-emerald-300">{wppStatus}</div>
          <div className="text-xs text-emerald-500/80 mt-1">Gerenciar conexão →</div>
        </Link>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
          <div className="text-xs text-zinc-500">Execuções recentes</div>
          <div className="text-2xl font-semibold mt-1">{runs.length}</div>
        </div>
      </div>

      <div className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Últimas execuções</h2>
          <Link to="/flows" className="text-xs text-emerald-400 hover:underline">
            Ver fluxos
          </Link>
        </div>
        <div className="mt-3 space-y-2">
          {runs.map((r) => (
            <div
              key={r.id}
              className="rounded-xl border border-zinc-800 bg-zinc-950/40 px-4 py-3 flex justify-between gap-4"
            >
              <div>
                <div className="text-sm font-medium">{r.flow?.name ?? "Fluxo"}</div>
                <div className="text-xs text-zinc-500">{r.contactPhone}</div>
              </div>
              <span className="text-xs rounded-full px-2 py-1 bg-zinc-800 text-zinc-300 h-fit">
                {r.status}
              </span>
            </div>
          ))}
          {runs.length === 0 && (
            <p className="text-sm text-zinc-500">Nenhuma execução ainda.</p>
          )}
        </div>
      </div>
    </div>
  );
}
