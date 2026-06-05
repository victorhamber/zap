import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";

type Step = {
  id: string;
  nodeId: string;
  nodeType: string;
  status: string;
  message: string | null;
  createdAt: string;
};

type RunSummary = {
  id: string;
  status: string;
  contactPhone: string;
  triggerType: string;
  createdAt: string;
};

type RunDetail = {
  id: string;
  status: string;
  contactPhone: string;
  triggerType: string;
  errorMessage: string | null;
  createdAt: string;
  steps: Step[];
  flow: { name: string };
};

export function FlowRuns() {
  const { id: flowId } = useParams();
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selected, setSelected] = useState<RunDetail | null>(null);

  useEffect(() => {
    const q = flowId ? `?flowId=${flowId}&limit=30` : "?limit=30";
    api<any[]>(`/api/runs${q}`).then(setRuns);
  }, [flowId]);

  async function openRun(runId: string) {
    setSelected(await api<RunDetail>(`/api/runs/${runId}`));
  }

  return (
    <div>
      <Link to={flowId ? "/flows" : "/"} className="text-sm text-zap-orange hover:underline">
        ← {flowId ? "Voltar aos fluxos" : "Voltar ao dashboard"}
      </Link>
      <h1 className="text-2xl font-semibold mt-2">Execuções</h1>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-2">
          {runs.map((r) => (
            <button
              key={r.id}
              onClick={() => openRun(r.id)}
              className="w-full text-left rounded-xl border border-zinc-800 bg-zinc-950/40 px-4 py-3 hover:border-zinc-600"
            >
              <div className="text-sm font-medium">{r.contactPhone}</div>
              <div className="text-xs text-zinc-500">
                {r.status} · {new Date(r.createdAt).toLocaleString("pt-BR")}
              </div>
            </button>
          ))}
        </div>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4 min-h-[200px]">
          {selected ? (
            <>
              <div className="text-sm font-semibold">{selected.flow.name}</div>
              <div className="text-xs text-zinc-500 mt-1">{selected.id}</div>
              {selected.errorMessage && (
                <div className="mt-2 text-sm text-red-300">{selected.errorMessage}</div>
              )}
              <div className="mt-4 space-y-2">
                {selected.steps.map((s) => (
                  <div key={s.id} className="text-xs border-l-2 border-zinc-700 pl-3 py-1">
                    <span className="text-zinc-400">{s.nodeType}</span> — {s.status}
                    {s.message && <div className="text-zinc-500">{s.message}</div>}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-zinc-500">Selecione uma execução.</p>
          )}
        </div>
      </div>
    </div>
  );
}
