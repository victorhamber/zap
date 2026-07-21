import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import {
  Badge,
  Card,
  EmptyState,
  ErrorNotice,
  Icon,
  PageHeader,
  Skeleton
} from "../components/ui";

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

const STATUS_LABELS: Record<string, string> = {
  completed: "Concluída",
  failed: "Falhou",
  running: "Executando",
  waiting: "Aguardando",
  ok: "OK",
  skipped: "Ignorado",
  scheduled: "Agendado"
};

const STATUS_TONES: Record<string, "success" | "danger" | "info" | "warning" | "neutral"> = {
  completed: "success",
  ok: "success",
  failed: "danger",
  running: "info",
  waiting: "warning",
  scheduled: "warning",
  skipped: "neutral"
};

const NODE_LABELS: Record<string, string> = {
  send_text: "Mensagem de texto",
  send_image: "Imagem",
  send_video: "Vídeo",
  send_audio: "Áudio",
  delay: "Espera",
  schedule_at: "Agendamento",
  tag_action: "Tag",
  start_flow: "Iniciar outro fluxo",
  condition_offer_code: "Código da oferta",
  condition_contact_tag: "Condição — tag",
  condition_contact_replied: "Condição — respondeu",
  split_round_robin: "Divisão round robin",
  error: "Erro"
};

function statusBadge(status: string) {
  return (
    <Badge tone={STATUS_TONES[status] ?? "neutral"} dot>
      {STATUS_LABELS[status] ?? status}
    </Badge>
  );
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function FlowRuns() {
  const { id: flowId } = useParams();
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selected, setSelected] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setLoading(true);
    setSelected(null);
    const q = flowId ? `?flowId=${flowId}&limit=30` : "?limit=30";
    api<RunSummary[]>(`/api/runs${q}`)
      .then((r) => {
        setRuns(r);
        setError("");
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Não foi possível carregar as execuções.")
      )
      .finally(() => setLoading(false));
  }, [flowId]);

  async function openRun(runId: string) {
    setLoadingDetail(true);
    try {
      setSelected(await api<RunDetail>(`/api/runs/${runId}`));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Não foi possível abrir a execução.");
    } finally {
      setLoadingDetail(false);
    }
  }

  return (
    <div className="space-y-6">
      <Link
        to={flowId ? "/flows" : "/"}
        className="inline-flex items-center gap-1.5 text-sm text-zinc-500 transition hover:text-brand-400"
      >
        <Icon name="chevronLeft" className="h-4 w-4" />
        {flowId ? "Voltar aos fluxos" : "Voltar ao dashboard"}
      </Link>

      <PageHeader
        title="Execuções"
        subtitle="Cada disparo de fluxo e o passo a passo do que aconteceu com o contato."
      />

      {error && <ErrorNotice>{error}</ErrorNotice>}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        {/* Lista */}
        <div className="space-y-2">
          {loading ? (
            <>
              <Skeleton className="h-[70px] rounded-xl" />
              <Skeleton className="h-[70px] rounded-xl" />
              <Skeleton className="h-[70px] rounded-xl" />
            </>
          ) : runs.length === 0 ? (
            <EmptyState
              icon="activity"
              title="Nenhuma execução"
              description="Assim que um gatilho disparar, o histórico aparece aqui."
            />
          ) : (
            runs.map((r) => {
              const active = selected?.id === r.id;
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => void openRun(r.id)}
                  className={`w-full rounded-xl border px-4 py-3 text-left transition ${
                    active
                      ? "border-brand-500/40 bg-brand-500/[0.07]"
                      : "border-[var(--line)] bg-[var(--surface-1)] hover:border-[var(--line-strong)] hover:bg-[var(--surface-2)]"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate font-mono text-sm text-zinc-100">
                      {r.contactPhone}
                    </span>
                    {statusBadge(r.status)}
                  </div>
                  <div className="mt-1.5 text-xs text-zinc-500">{formatDateTime(r.createdAt)}</div>
                </button>
              );
            })
          )}
        </div>

        {/* Detalhe */}
        <Card className="min-h-[280px]">
          {loadingDetail ? (
            <div className="space-y-3">
              <Skeleton className="h-5 w-48" />
              <Skeleton className="h-3 w-64" />
              <Skeleton className="mt-6 h-12" />
              <Skeleton className="h-12" />
            </div>
          ) : selected ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-white">{selected.flow.name}</h2>
                  <p className="mt-1 font-mono text-xs text-zinc-500">
                    {selected.contactPhone} · {formatDateTime(selected.createdAt)}
                  </p>
                </div>
                {statusBadge(selected.status)}
              </div>

              {selected.errorMessage && (
                <div className="mt-4">
                  <ErrorNotice>{selected.errorMessage}</ErrorNotice>
                </div>
              )}

              {/* Linha do tempo */}
              <ol className="mt-6 space-y-0">
                {selected.steps.map((s, i) => {
                  const tone = STATUS_TONES[s.status] ?? "neutral";
                  const dotColor = {
                    success: "bg-emerald-400",
                    danger: "bg-red-400",
                    info: "bg-sky-400",
                    warning: "bg-amber-400",
                    neutral: "bg-zinc-600"
                  }[tone];
                  const isLast = i === selected.steps.length - 1;

                  return (
                    <li key={s.id} className="relative flex gap-3.5 pb-5 last:pb-0">
                      <div className="flex flex-col items-center">
                        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dotColor}`} />
                        {!isLast && <span className="w-px flex-1 bg-[var(--line-strong)]" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm text-zinc-200">
                            {NODE_LABELS[s.nodeType] ?? s.nodeType}
                          </span>
                          {statusBadge(s.status)}
                        </div>
                        {s.message && (
                          <p className="mt-1 break-words text-xs leading-relaxed text-zinc-500">
                            {s.message}
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
                {selected.steps.length === 0 && (
                  <p className="text-sm text-zinc-600">Nenhum passo registrado.</p>
                )}
              </ol>
            </>
          ) : (
            <EmptyState
              icon="list"
              title="Selecione uma execução"
              description="Escolha um disparo na lista ao lado para ver o passo a passo."
            />
          )}
        </Card>
      </div>
    </div>
  );
}
