import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";

type Flow = {
  id: string;
  name: string;
  enabled: boolean;
  updatedAt: string;
};

export function FlowsList() {
  const nav = useNavigate();
  const [flows, setFlows] = useState<Flow[]>([]);

  async function refresh() {
    setFlows(await api<Flow[]>("/api/flows"));
  }

  useEffect(() => {
    refresh();
  }, []);

  async function createFlow() {
    const f = await api<Flow>("/api/flows", {
      method: "POST",
      body: JSON.stringify({ name: "Novo fluxo" })
    });
    nav(`/flows/${f.id}/edit`);
  }

  async function toggle(id: string, enabled: boolean) {
    await api(`/api/flows/${id}`, {
      method: "PUT",
      body: JSON.stringify({ enabled: !enabled })
    });
    refresh();
  }

  async function removeFlow(id: string, flowName: string) {
    if (!confirm(`Excluir o fluxo "${flowName}"? Esta ação não pode ser desfeita.`)) return;
    await api(`/api/flows/${id}`, { method: "DELETE" });
    refresh();
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Fluxos</h1>
          <p className="text-sm text-zinc-400 mt-1">Automações visuais</p>
        </div>
        <button onClick={createFlow} className="zap-btn-primary px-4 py-2 text-sm">
          + Novo fluxo
        </button>
      </div>

      <div className="mt-6 space-y-2">
        {flows.map((f) => (
          <div
            key={f.id}
            className="zap-card p-4 flex items-center justify-between gap-4 hover:border-zap-orange/20 transition"
          >
            <div>
              <div className="font-medium">{f.name}</div>
              <div className="text-xs text-zinc-500 font-mono mt-0.5">ID: {f.id}</div>
              <div className="text-xs text-zinc-500 mt-1">
                Webhook Hotmart:{" "}
                <span className="text-zinc-300">
                  /api/webhooks/hotmart/{f.id}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => toggle(f.id, f.enabled)}
                className={`text-xs rounded-full px-3 py-1 font-medium ${
                  f.enabled
                    ? "bg-zap-orange-muted text-zap-orange"
                    : "bg-zap-surface text-zap-muted border border-zap-border"
                }`}
              >
                {f.enabled ? "● Publicado" : "Rascunho"}
              </button>
              <Link
                to={`/flows/${f.id}/edit`}
                className="zap-btn-ghost px-3 py-1.5 text-sm"
              >
                Editar
              </Link>
              <Link
                to={`/flows/${f.id}/runs`}
                className="zap-btn-ghost px-3 py-1.5 text-sm"
              >
                Logs
              </Link>
              <button
                type="button"
                onClick={() => removeFlow(f.id, f.name)}
                className="rounded-lg border border-red-900/50 px-3 py-1.5 text-sm text-red-300 hover:bg-red-950/40"
              >
                Excluir
              </button>
            </div>
          </div>
        ))}
        {flows.length === 0 && (
          <p className="text-zinc-500 text-sm">Crie seu primeiro fluxo.</p>
        )}
      </div>
    </div>
  );
}
