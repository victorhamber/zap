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
  tags: Tag[];
};
type FlowOpt = { id: string; name: string };

const FALLBACK_STAGES: Stage[] = [
  { id: "novo", label: "Novo" },
  { id: "em_conversa", label: "Em conversa" },
  { id: "comprou", label: "Comprou" },
  { id: "perdido", label: "Perdido" }
];

export function Funnel() {
  const [stages, setStages] = useState<Stage[]>(FALLBACK_STAGES);
  const [contacts, setContacts] = useState<BoardContact[]>([]);
  const [hours, setHours] = useState(24);
  const [flowId, setFlowId] = useState("");
  const [flows, setFlows] = useState<FlowOpt[]>([]);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  async function load() {
    const board = await api<{ stages?: Stage[]; contacts?: BoardContact[] }>("/api/crm/board");
    if (board.stages?.length) setStages(board.stages);
    setContacts(board.contacts ?? []);
    const follow = await api<{ hours?: number; flowId?: string; flows?: FlowOpt[] }>(
      "/api/crm/follow-up"
    );
    setHours(follow.hours ?? 24);
    setFlowId(follow.flowId ?? "");
    setFlows(follow.flows ?? []);
  }

  useEffect(() => {
    void load().catch((e: unknown) =>
      setError(e instanceof Error ? e.message : "Não foi possível carregar o funil")
    );
  }, []);

  async function move(phone: string, stage: string) {
    setError("");
    await api(`/api/contacts/${encodeURIComponent(phone)}`, {
      method: "PUT",
      body: JSON.stringify({ stage })
    });
    setContacts((prev) => prev.map((c) => (c.phone === phone ? { ...c, stage } : c)));
  }

  async function saveFollowUp() {
    setError("");
    setSaved("");
    await api("/api/crm/follow-up", {
      method: "PUT",
      body: JSON.stringify({ hours, flowId })
    });
    setSaved(hours < 1 || !flowId ? "Retomada desligada." : "Retomada salva.");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Funil"
        subtitle="Novo, em conversa, comprou ou perdido. A compra na Hotmart move para Comprou. Quem fica em conversa sem falar recebe o fluxo escolhido."
      />

      {error && <p className="text-sm text-red-300">{error}</p>}

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm text-zinc-300">
            Horas em silêncio
            <input
              type="number"
              min={0}
              max={720}
              value={hours}
              onChange={(e) => setHours(Number(e.target.value))}
              className="mt-1 block w-28 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
            />
          </label>
          <label className="min-w-[16rem] flex-1 text-sm text-zinc-300">
            Fluxo da retomada
            <select
              value={flowId}
              onChange={(e) => setFlowId(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
            >
              <option value="">Não retomar</option>
              {flows.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => void saveFollowUp().catch((e: unknown) => setError(e instanceof Error ? e.message : "Erro ao salvar"))}
            className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950"
          >
            Salvar retomada
          </button>
          {saved && <span className="text-sm text-emerald-300">{saved}</span>}
        </div>
        <p className="mt-3 text-xs text-zinc-500">
          Zero horas ou nenhum fluxo desliga a retomada. Ela só dispara para quem está em conversa e ainda não respondeu.
        </p>
      </Card>

      <div className="grid gap-3 lg:grid-cols-4">
        {stages.map((stage) => {
          const column = contacts.filter((c) => (c.stage || "novo") === stage.id);
          return (
            <Card key={stage.id} padded={false} className="min-h-[280px]">
              <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
                <h2 className="text-sm font-medium text-white">{stage.label}</h2>
                <span className="text-xs text-zinc-500">{column.length}</span>
              </div>
              <ul className="space-y-2 p-3">
                {column.map((c) => (
                  <li key={c.id} className="rounded-xl bg-zinc-900/80 p-3">
                    <p className="truncate text-sm text-white">{c.name || c.phone}</p>
                    <p className="truncate text-xs text-zinc-500">{c.phone}</p>
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
                  </li>
                ))}
              </ul>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
