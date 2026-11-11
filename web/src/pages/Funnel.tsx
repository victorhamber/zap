import { useEffect, useState } from "react";
import { api } from "../api/client";
import { Card, PageHeader } from "../components/ui";

type Stage = { id: string; label: string };
type Tag = { id: string; name: string; color: string };
type BoardContact = {
  id: string;
  phone: string;
  name: string | null;
  stage?: string | null;
  lostReason?: string | null;
  productName?: string | null;
  tags: Tag[];
};
type FlowOpt = { id: string; name: string };
type FollowStep = { hours: number; flowId: string };

const LOST_REASONS = [
  { id: "preco", label: "Preço" },
  { id: "sumiu", label: "Sumiu" },
  { id: "ja_tem", label: "Já tem" },
  { id: "outro", label: "Outro" }
];

const EMPTY_STEPS: FollowStep[] = [
  { hours: 24, flowId: "" },
  { hours: 72, flowId: "" },
  { hours: 168, flowId: "" }
];

const PAGE_SIZE = 20;

const FALLBACK_STAGES: Stage[] = [
  { id: "novo", label: "Novo" },
  { id: "em_conversa", label: "Em conversa" },
  { id: "comprou", label: "Comprou" },
  { id: "perdido", label: "Perdido" }
];

export function Funnel() {
  const [stages, setStages] = useState<Stage[]>(FALLBACK_STAGES);
  const [contacts, setContacts] = useState<BoardContact[]>([]);
  const [steps, setSteps] = useState<FollowStep[]>(EMPTY_STEPS);
  const [flows, setFlows] = useState<FlowOpt[]>([]);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState<Record<string, number>>({});
  const [lostFor, setLostFor] = useState<string | null>(null);

  function reasonLabel(id?: string | null) {
    return LOST_REASONS.find((reason) => reason.id === id)?.label ?? "";
  }

  async function load() {
    const board = await api<{ stages?: Stage[]; contacts?: BoardContact[] }>("/api/crm/board");
    if (board.stages?.length) setStages(board.stages);
    setContacts(board.contacts ?? []);
    const follow = await api<{ steps?: FollowStep[]; flows?: FlowOpt[] }>("/api/crm/follow-up");
    const loaded = follow.steps ?? [];
    setSteps(EMPTY_STEPS.map((fallback, index) => loaded[index] ?? fallback));
    setFlows(follow.flows ?? []);
  }

  useEffect(() => {
    void load().catch((e: unknown) =>
      setError(e instanceof Error ? e.message : "Não foi possível carregar o funil")
    );
  }, []);

  async function move(phone: string, stage: string, lostReason?: string) {
    setError("");
    if (stage === "perdido" && !lostReason) {
      setLostFor(phone);
      return;
    }
    await api(`/api/contacts/${encodeURIComponent(phone)}`, {
      method: "PUT",
      body: JSON.stringify({ stage, ...(lostReason ? { lostReason } : {}) })
    });
    setLostFor(null);
    setContacts((prev) => prev.map((c) => (c.phone === phone ? { ...c, stage, lostReason: lostReason ?? null } : c)));
  }

  async function saveFollowUp() {
    setError("");
    setSaved("");
    const active = steps.filter((step) => step.flowId && step.hours >= 1);
    await api("/api/crm/follow-up", {
      method: "PUT",
      body: JSON.stringify({ steps: active })
    });
    setSaved(active.length === 0 ? "Retomada desligada." : "Retomada salva.");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Funil"
        subtitle="Novo, em conversa, comprou ou perdido. A compra na Hotmart move para Comprou e guarda o produto. A retomada manda até três fluxos e para quando a pessoa responde."
      />

      {error && <p className="text-sm text-red-300">{error}</p>}

      <Card>
        <div className="space-y-3">
          {steps.map((step, index) => (
            <div key={index} className="flex flex-wrap items-end gap-3">
              <label className="text-sm text-zinc-300">
                {index + 1}º passo, horas
                <input
                  type="number"
                  min={1}
                  max={720}
                  value={step.hours}
                  onChange={(e) =>
                    setSteps((prev) =>
                      prev.map((item, i) => (i === index ? { ...item, hours: Number(e.target.value) } : item))
                    )
                  }
                  className="mt-1 block w-28 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
                />
              </label>
              <label className="min-w-[16rem] flex-1 text-sm text-zinc-300">
                Fluxo
                <select
                  value={step.flowId}
                  onChange={(e) =>
                    setSteps((prev) =>
                      prev.map((item, i) => (i === index ? { ...item, flowId: e.target.value } : item))
                    )
                  }
                  className="mt-1 block w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
                >
                  <option value="">Não enviar</option>
                  {flows.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ))}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void saveFollowUp().catch((e: unknown) => setError(e instanceof Error ? e.message : "Erro ao salvar"))}
              className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950"
            >
              Salvar retomada
            </button>
            {saved && <span className="text-sm text-emerald-300">{saved}</span>}
          </div>
        </div>
        <p className="mt-3 text-xs text-zinc-500">
          O 1º passo conta a partir da nossa última mensagem. Os seguintes contam a partir do passo anterior. Uma resposta da pessoa zera a sequência. Passo sem fluxo não entra.
        </p>
      </Card>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Buscar por nome, telefone ou produto"
        className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
      />

      <div className="grid gap-3 lg:grid-cols-4">
        {stages.map((stage) => {
          const needle = query.trim().toLowerCase();
          const column = contacts.filter((c) => {
            if ((c.stage || "novo") !== stage.id) return false;
            if (!needle) return true;
            return (
              (c.name ?? "").toLowerCase().includes(needle) ||
              c.phone.includes(needle) ||
              (c.productName ?? "").toLowerCase().includes(needle)
            );
          });
          const limit = visible[stage.id] ?? PAGE_SIZE;
          const shown = column.slice(0, limit);
          return (
            <Card key={stage.id} padded={false} className="min-h-[280px]">
              <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
                <h2 className="text-sm font-medium text-white">{stage.label}</h2>
                <span className="text-xs text-zinc-500">{column.length}</span>
              </div>
              <ul className="space-y-2 p-3">
                {shown.map((c) => (
                  <li key={c.id} className="rounded-xl bg-zinc-900/80 p-3">
                    <p className="truncate text-sm text-white">{c.name || c.phone}</p>
                    <p className="truncate text-xs text-zinc-500">{c.phone}</p>
                    {c.stage === "comprou" && c.productName && (
                      <p className="truncate text-xs text-emerald-300">{c.productName}</p>
                    )}
                    {c.stage === "perdido" && reasonLabel(c.lostReason) && (
                      <p className="text-xs text-zinc-400">{reasonLabel(c.lostReason)}</p>
                    )}
                    <select
                      value={c.stage || "novo"}
                      onChange={(e) => void move(c.phone, e.target.value)}
                      className="mt-2 w-full rounded-lg border-0 bg-zinc-800 px-2 py-1 text-xs text-zinc-200"
                    >
                      {stages.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                    {lostFor === c.phone && (
                      <div className="mt-2 space-y-1">
                        <p className="text-[11px] text-zinc-400">Motivo, antes de mover</p>
                        <div className="flex flex-wrap gap-1">
                          {LOST_REASONS.map((reason) => (
                            <button
                              key={reason.id}
                              type="button"
                              onClick={() => void move(c.phone, "perdido", reason.id)}
                              className="rounded-md bg-zinc-800 px-2 py-1 text-[11px] text-zinc-200"
                            >
                              {reason.label}
                            </button>
                          ))}
                          <button
                            type="button"
                            onClick={() => setLostFor(null)}
                            className="rounded-md px-2 py-1 text-[11px] text-zinc-500"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              {column.length > shown.length && (
                <button
                  type="button"
                  onClick={() => setVisible((prev) => ({ ...prev, [stage.id]: limit + PAGE_SIZE }))}
                  className="w-full border-t border-[var(--line)] px-4 py-2 text-xs text-zinc-400"
                >
                  Ver mais {column.length - shown.length}
                </button>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
