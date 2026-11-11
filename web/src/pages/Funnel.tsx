import { useEffect, useState } from "react";
import { api } from "../api/client";
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ErrorNotice,
  Icon,
  PageHeader,
  SearchInput,
  inputClass
} from "../components/ui";

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

const STAGE_DOTS: Record<string, string> = {
  novo: "bg-sky-400",
  em_conversa: "bg-amber-400",
  comprou: "bg-emerald-400",
  perdido: "bg-zinc-500"
};

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
  const [showConfig, setShowConfig] = useState(false);

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
    setSaved(active.length === 0 ? "Retomada desligada." : "Configurações de retomada salvas com sucesso.");
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Funil de Vendas"
        subtitle="Pipeline de contatos com atualização automática por compra da Hotmart e retomada programada."
        actions={
          <Button
            size="sm"
            icon="settings"
            variant={showConfig ? "primary" : "secondary"}
            onClick={() => setShowConfig((v) => !v)}
          >
            {showConfig ? "Ocultar automação" : "Configurar retomada"}
          </Button>
        }
      />

      {error && <ErrorNotice>{error}</ErrorNotice>}

      {showConfig && (
        <Card className="zap-enter">
          <CardHeader
            title="Automação de Retomada (Follow-up)"
            subtitle="Disparo de até 3 fluxos sequenciais se o contato parar de responder."
          />
          <div className="mt-4 space-y-3">
            {steps.map((step, index) => (
              <div key={index} className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface-2)]/40 p-3">
                <div className="w-28">
                  <label className="block text-[11px] font-medium text-zinc-400">
                    {index + 1}º disparo (horas)
                  </label>
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
                    className={`${inputClass} mt-1`}
                  />
                </div>
                <div className="min-w-[16rem] flex-1">
                  <label className="block text-[11px] font-medium text-zinc-400">
                    Fluxo a executar
                  </label>
                  <select
                    value={step.flowId}
                    onChange={(e) =>
                      setSteps((prev) =>
                        prev.map((item, i) => (i === index ? { ...item, flowId: e.target.value } : item))
                      )
                    }
                    className={`${inputClass} mt-1`}
                  >
                    <option value="">Nenhum (não enviar)</option>
                    {flows.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            ))}
            <div className="flex items-center gap-3 pt-2">
              <Button
                variant="primary"
                size="sm"
                onClick={() => void saveFollowUp().catch((e: unknown) => setError(e instanceof Error ? e.message : "Erro ao salvar"))}
              >
                Salvar automação
              </Button>
              {saved && <span className="text-xs font-medium text-emerald-400">{saved}</span>}
            </div>
            <p className="pt-1 text-xs text-zinc-500 leading-relaxed">
              O 1º passo inicia após a última mensagem da conversa. Se o contato responder qualquer mensagem, a sequência é cancelada automaticamente.
            </p>
          </div>
        </Card>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <SearchInput
          value={query}
          onChange={setQuery}
          placeholder="Buscar contato, telefone ou produto..."
          className="w-full sm:max-w-xs"
        />
        <span className="text-xs text-zinc-500 font-medium">
          {contacts.length} {contacts.length === 1 ? "contato no funil" : "contatos no funil"}
        </span>
      </div>

      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4 items-start">
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
          const dotColor = STAGE_DOTS[stage.id] ?? "bg-zinc-400";

          return (
            <div key={stage.id} className="rounded-xl border border-[var(--line)] bg-[var(--surface-1)] shadow-xs flex flex-col min-h-[320px]">
              <div className="flex items-center justify-between border-b border-[var(--line)] px-3.5 py-3">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${dotColor}`} />
                  <h2 className="text-xs font-semibold tracking-tight text-zinc-200">{stage.label}</h2>
                </div>
                <span className="rounded-md border border-[var(--line)] bg-[var(--surface-2)] px-2 py-0.5 text-[11px] font-medium tabular-nums text-zinc-400">
                  {column.length}
                </span>
              </div>

              <div className="space-y-2 p-2.5 flex-1">
                {shown.length === 0 ? (
                  <div className="flex h-32 items-center justify-center text-center">
                    <p className="text-xs text-zinc-500">Nenhum contato</p>
                  </div>
                ) : (
                  shown.map((c) => (
                    <div
                      key={c.id}
                      className="group rounded-lg border border-[var(--line)] bg-[var(--surface-2)]/50 p-3 transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--surface-2)]"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold text-zinc-100">
                            {c.name || c.phone}
                          </p>
                          <p className="truncate text-[11px] font-mono text-zinc-400">
                            {c.phone}
                          </p>
                        </div>
                      </div>

                      {c.stage === "comprou" && c.productName && (
                        <div className="mt-2">
                          <Badge tone="success">{c.productName}</Badge>
                        </div>
                      )}

                      {c.stage === "perdido" && reasonLabel(c.lostReason) && (
                        <div className="mt-2">
                          <Badge tone="neutral">Motivo: {reasonLabel(c.lostReason)}</Badge>
                        </div>
                      )}

                      <div className="mt-2.5 pt-2 border-t border-[var(--line)]/60">
                        <label className="block text-[10px] text-zinc-500 mb-1">Mover estágio</label>
                        <select
                          value={c.stage || "novo"}
                          onChange={(e) => void move(c.phone, e.target.value)}
                          className="w-full rounded-md border border-[var(--line)] bg-[var(--surface-3)] px-2 py-1 text-xs text-zinc-200 outline-none transition focus:border-emerald-500/50"
                        >
                          {stages.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                      </div>

                      {lostFor === c.phone && (
                        <div className="mt-2 rounded-md border border-[var(--line)] bg-[var(--surface-3)] p-2 space-y-1.5">
                          <p className="text-[10px] font-medium text-zinc-400">Qual foi o motivo da perda?</p>
                          <div className="flex flex-wrap gap-1">
                            {LOST_REASONS.map((reason) => (
                              <button
                                key={reason.id}
                                type="button"
                                onClick={() => void move(c.phone, "perdido", reason.id)}
                                className="rounded border border-[var(--line-strong)] bg-[var(--surface-2)] px-2 py-0.5 text-[10px] text-zinc-300 hover:border-zinc-500 hover:text-white"
                              >
                                {reason.label}
                              </button>
                            ))}
                            <button
                              type="button"
                              onClick={() => setLostFor(null)}
                              className="rounded px-2 py-0.5 text-[10px] text-zinc-500 hover:text-zinc-300"
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>

              {column.length > shown.length && (
                <button
                  type="button"
                  onClick={() => setVisible((prev) => ({ ...prev, [stage.id]: limit + PAGE_SIZE }))}
                  className="w-full border-t border-[var(--line)] px-3 py-2 text-center text-xs font-medium text-zinc-400 hover:bg-[var(--surface-2)]/40 hover:text-zinc-200 transition-colors"
                >
                  Ver mais {column.length - shown.length}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
