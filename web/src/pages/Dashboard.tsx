import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorNotice,
  Icon,
  PageHeader,
  Skeleton
} from "../components/ui";

type DashboardStats = {
  flows: { total: number; active: number; inactive: number };
  contacts: number;
  tags: number;
  runs: {
    total: number;
    today: number;
    last7Days: number;
    byStatus: { status: string; count: number }[];
    byTrigger: { trigger: string; count: number }[];
    daily: { date: string; count: number }[];
  };
  messages: {
    sentToday: number;
    receivedToday: number;
    sentLast7Days: number;
    dailySent: { date: string; count: number }[];
  };
  scheduled: { pending: number };
  funnel?: { novo: number; em_conversa: number; comprou: number; perdido: number; radar: number };
  topFlows: { flowId: string; name: string; enabled: boolean; count: number }[];
};

const TRIGGER_LABELS: Record<string, string> = {
  trigger_hotmart: "Hotmart (aprovada)",
  trigger_hotmart_pending: "Hotmart (aguardando)",
  trigger_custom_webhook: "Webhook personalizado",
  trigger_wa_link: "Link WhatsApp",
  trigger_tag: "Tag",
  trigger_inbound: "Mensagem",
  trigger_broadcast: "Broadcast",
  trigger_groups: "Grupos",
  trigger_manual: "Manual"
};

const STATUS_LABELS: Record<string, string> = {
  completed: "Concluídas",
  failed: "Falhas",
  running: "Executando",
  waiting: "Aguardando"
};

const STATUS_COLORS: Record<string, string> = {
  completed: "#10b981",
  failed: "#ef4444",
  running: "#0ea5e9",
  waiting: "#f59e0b"
};

const AI_EVENT_LABELS: Record<string, string> = {
  replied: "Respondeu",
  replied_media: "Enviou resposta com mídia",
  learned: "Aprendeu",
  escalated: "Passou para humano",
  skipped_video: "Vídeo — aguardando humano",
  cancelled_human: "Cancelou (atendente ativo)",
  rule_softened: "Ajustou resposta (regra)",
  blocked_rule: "Bloqueou por regra",
  error: "Erro",
  history_backfill: "Backfill de histórico"
};

const AI_EVENT_TONES: Record<string, "success" | "danger" | "info" | "warning" | "neutral"> = {
  replied: "success",
  replied_media: "success",
  learned: "info",
  escalated: "warning",
  skipped_video: "warning",
  cancelled_human: "neutral",
  rule_softened: "neutral",
  blocked_rule: "danger",
  error: "danger",
  history_backfill: "neutral"
};

function formatEventTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

function formatDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "2-digit"
  });
}

function BarChart({
  data,
  from = "#10b981",
  to = "#059669"
}: {
  data: { date: string; count: number }[];
  from?: string;
  to?: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.count));

  return (
    <div className="flex h-40 items-end gap-2">
      {data.map((d) => (
        <div
          key={d.date}
          className="zap-bar-group group flex min-w-0 flex-1 flex-col items-center gap-2"
          title={`${formatDay(d.date)} — ${d.count}`}
        >
          <span
            className={`text-[11px] font-medium tabular-nums transition-colors ${
              d.count ? "text-zinc-400 group-hover:text-emerald-300" : "text-transparent"
            }`}
          >
            {d.count || "0"}
          </span>
          <div className="flex h-24 w-full items-end justify-center">
            <div
              className="zap-bar w-full max-w-[32px]"
              style={
                {
                  height: `${Math.max(3, (d.count / max) * 100)}%`,
                  opacity: d.count ? 1 : 0.15,
                  "--bar-top": from,
                  "--bar-bottom": to
                } as React.CSSProperties
              }
            />
          </div>
          <span className="w-full truncate text-center text-[10px] capitalize text-zinc-500">
            {formatDay(d.date)}
          </span>
        </div>
      ))}
    </div>
  );
}

function ChartSkeleton() {
  return (
    <div className="flex h-40 items-end gap-1.5">
      {[46, 72, 38, 90, 61, 30, 78].map((h, i) => (
        <div key={i} className="flex flex-1 flex-col items-center gap-2">
          <div className="flex h-24 w-full items-end justify-center">
            <div className="zap-skeleton w-full max-w-[34px]" style={{ height: `${h}%` }} />
          </div>
          <Skeleton className="h-2.5 w-8" />
        </div>
      ))}
    </div>
  );
}

function DistributionList({
  items,
  labels,
  colors
}: {
  items: { key: string; count: number }[];
  labels: Record<string, string>;
  colors?: Record<string, string>;
}) {
  const total = items.reduce((s, i) => s + i.count, 0) || 1;

  if (items.length === 0) {
    return <p className="py-6 text-sm text-zinc-600">Sem dados ainda.</p>;
  }

  return (
    <div className="space-y-3.5">
      {[...items]
        .sort((a, b) => b.count - a.count)
        .map((item) => {
          const pct = Math.round((item.count / total) * 100);
          const color = colors?.[item.key] ?? "#10b981";
          return (
            <div key={item.key}>
              <div className="mb-1.5 flex items-baseline justify-between gap-3 text-xs">
                <span className="truncate text-zinc-300">{labels[item.key] ?? item.key}</span>
                <span className="shrink-0 tabular-nums text-zinc-500">
                  <span className="font-medium text-zinc-300">{item.count}</span> · {pct}%
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-3)]">
                <div
                  className="h-full rounded-full transition-[width] duration-500 ease-out"
                  style={{ width: `${Math.max(2, pct)}%`, backgroundColor: color }}
                />
              </div>
            </div>
          );
        })}
    </div>
  );
}

/* ------------------------------------------------------------------ */

type AiStats = {
  repliesToday: number;
  knowledgeItems: number;
  errorsRecent: number;
  queuePending: number;
};

type AiEvent = {
  id: string;
  event: string;
  detail: string | null;
  chatId: string | null;
  createdAt: string;
};

export function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [ai, setAi] = useState<AiStats | null>(null);
  const [aiEvents, setAiEvents] = useState<AiEvent[]>([]);
  const [wpp, setWpp] = useState<{ label: string; connected: boolean }>({
    label: "Verificando…",
    connected: false
  });

  useEffect(() => {
    api<DashboardStats>("/api/dashboard/stats")
      .then((r) => {
        setStats(r);
        setError("");
      })
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : "Não foi possível carregar as estatísticas.")
      )
      .finally(() => setLoading(false));

    // IA é opcional (pode não estar configurada) — falha silenciosa, sem quebrar o painel
    api<AiStats>("/api/ai/stats")
      .then(setAi)
      .catch(() => setAi(null));
    api<{ items: AiEvent[] }>("/api/ai/events?limit=12")
      .then((r) => setAiEvents(r.items ?? []))
      .catch(() => setAiEvents([]));

    // `ok` só diz que a checagem respondeu; quem sabe do aparelho é `connected`
    api<{ ok: boolean; connected?: boolean; message?: string }>("/api/settings/wpp/status")
      .then((r) => {
        if (r.connected) return setWpp({ label: "Conectado", connected: true });
        setWpp({
          label: r.ok ? "Desconectado" : r.message ?? "Desconectado",
          connected: false
        });
      })
      .catch(() => setWpp({ label: "Indisponível", connected: false }));
  }, []);

  const successRate =
    stats && stats.runs.total > 0
      ? Math.round(
          ((stats.runs.byStatus.find((s) => s.status === "completed")?.count ?? 0) /
            stats.runs.total) *
            100
        )
      : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        subtitle="Métricas do funil em tempo real, volume de mensagens e saúde da automação."
        actions={
          <Link
            to="/runs"
            className="inline-flex items-center gap-1.5 text-xs md:text-sm font-medium text-emerald-400 transition-colors hover:text-emerald-300"
          >
            Ver execuções
            <Icon name="chevronRight" className="h-4 w-4" />
          </Link>
        }
      />

      {error && <ErrorNotice>{error}</ErrorNotice>}

      {wpp.label !== "Verificando…" && !wpp.connected && (
        <div className="flex items-center justify-between gap-4 rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm">
          <div className="flex items-center gap-3">
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-400"></span>
            </span>
            <div>
              <p className="font-medium text-amber-200">WhatsApp desconectado</p>
              <p className="text-xs text-amber-300/80">Escaneie o QR Code na aba de configurações para reativar o atendimento.</p>
            </div>
          </div>
          <Link
            to="/settings"
            className="shrink-0 rounded-lg border border-amber-500/30 bg-amber-500/20 px-3 py-1.5 text-xs font-medium text-amber-200 transition-colors hover:bg-amber-500/30"
          >
            Abrir QR
          </Link>
        </div>
      )}

      {/* Funil */}
      <section>
        <div className="mb-2.5 flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold tracking-tight text-zinc-200">Visão Geral do Funil</h2>
          <Link to="/funil" className="text-xs font-medium text-emerald-400 transition-colors hover:text-emerald-300">
            Abrir funil →
          </Link>
        </div>
        <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-[var(--line)] bg-[var(--surface-1)] shadow-xs sm:grid-cols-5">
          {(
            [
              ["novo", "Novo", "/funil"],
              ["em_conversa", "Em conversa", "/funil"],
              ["comprou", "Comprou", "/funil"],
              ["perdido", "Perdido", "/funil"],
              ["radar", "Radar", "/whatsapp"]
            ] as const
          ).map(([key, label, to]) => (
            <Link
              key={key}
              to={to}
              title={key === "radar" ? "Esperando resposta há mais de 2 horas" : undefined}
              className="border-[var(--line)] px-4 py-3.5 transition-colors hover:bg-[var(--surface-2)]/60 max-sm:odd:border-r max-sm:[&:nth-child(-n+4)]:border-b sm:border-r sm:last:border-r-0"
            >
              <p className="text-2xl font-bold tracking-tight tabular-nums text-zinc-100">
                {loading ? "—" : (stats?.funnel?.[key] ?? 0)}
              </p>
              <p className="mt-1 text-xs text-zinc-400 font-medium">{label}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* Indicadores rápidos */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
        <Link
          to="/flows"
          className="rounded-lg border border-[var(--line)] bg-[var(--surface-1)] px-3.5 py-2.5 shadow-xs transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--surface-2)]/50"
        >
          <span className="text-xs text-zinc-400">Fluxos ativos</span>
          <p className="mt-1 text-lg font-semibold tabular-nums text-zinc-100">{stats?.flows.active ?? 0}</p>
        </Link>
        <Link
          to="/runs"
          className="rounded-lg border border-[var(--line)] bg-[var(--surface-1)] px-3.5 py-2.5 shadow-xs transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--surface-2)]/50"
        >
          <span className="text-xs text-zinc-400">Execuções hoje</span>
          <p className="mt-1 text-lg font-semibold tabular-nums text-zinc-100">{stats?.runs.today ?? 0}</p>
        </Link>
        <Link
          to="/whatsapp"
          className="rounded-lg border border-[var(--line)] bg-[var(--surface-1)] px-3.5 py-2.5 shadow-xs transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--surface-2)]/50"
        >
          <span className="text-xs text-zinc-400">Enviadas hoje</span>
          <p className="mt-1 text-lg font-semibold tabular-nums text-zinc-100">{stats?.messages.sentToday ?? 0}</p>
        </Link>
        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-1)] px-3.5 py-2.5 shadow-xs">
          <span className="text-xs text-zinc-400">Taxa de sucesso</span>
          <p className="mt-1 text-lg font-semibold tabular-nums text-emerald-400">{successRate}%</p>
        </div>
        <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-1)] px-3.5 py-2.5 shadow-xs">
          <span className="text-xs text-zinc-400">Base de contatos</span>
          <p className="mt-1 text-lg font-semibold tabular-nums text-zinc-100">{stats?.contacts ?? 0}</p>
        </div>
      </div>

      {/* Gráficos */}
      <section className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Execuções"
            subtitle="Fluxos disparados por dia"
            action={<Badge tone="success">7 dias</Badge>}
          />
          <div className="mt-5">
            {loading || !stats ? <ChartSkeleton /> : <BarChart data={stats.runs.daily} />}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Mensagens enviadas"
            subtitle="Pelo inbox e pelas automações"
            action={<Badge tone="info">7 dias</Badge>}
          />
          <div className="mt-5">
            {loading || !stats ? (
              <ChartSkeleton />
            ) : (
              <BarChart data={stats.messages.dailySent} from="#38bdf8" to="#0284c7" />
            )}
          </div>
        </Card>
      </section>

      {/* Distribuições */}
      <section className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Por gatilho" subtitle="Como os fluxos foram iniciados" />
          <div className="mt-5">
            {loading || !stats ? (
              <div className="space-y-4">
                <Skeleton className="h-8" />
                <Skeleton className="h-8" />
                <Skeleton className="h-8" />
              </div>
            ) : (
              <DistributionList
                items={stats.runs.byTrigger.map((t) => ({ key: t.trigger, count: t.count }))}
                labels={TRIGGER_LABELS}
              />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Por status" subtitle="Resultado das execuções" />
          <div className="mt-5">
            {loading || !stats ? (
              <div className="space-y-4">
                <Skeleton className="h-8" />
                <Skeleton className="h-8" />
                <Skeleton className="h-8" />
              </div>
            ) : (
              <DistributionList
                items={stats.runs.byStatus.map((s) => ({ key: s.status, count: s.count }))}
                labels={STATUS_LABELS}
                colors={STATUS_COLORS}
              />
            )}
          </div>
        </Card>
      </section>

      {/* Assistente IA */}
      {ai && (
        <section className="space-y-4">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
            <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-1)] px-3.5 py-2.5 shadow-xs">
              <span className="text-xs text-zinc-400">Respostas hoje</span>
              <p className="mt-1 text-lg font-semibold tabular-nums text-zinc-100">{ai.repliesToday}</p>
            </div>
            <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-1)] px-3.5 py-2.5 shadow-xs">
              <span className="text-xs text-zinc-400">Aprendizados</span>
              <p className="mt-1 text-lg font-semibold tabular-nums text-zinc-100">{ai.knowledgeItems}</p>
            </div>
            <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-1)] px-3.5 py-2.5 shadow-xs">
              <span className="text-xs text-zinc-400">Erros em 24h</span>
              <p className="mt-1 text-lg font-semibold tabular-nums text-zinc-100">{ai.errorsRecent}</p>
            </div>
            <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-1)] px-3.5 py-2.5 shadow-xs">
              <span className="text-xs text-zinc-400">Na fila</span>
              <p className="mt-1 text-lg font-semibold tabular-nums text-zinc-100">{ai.queuePending}</p>
            </div>
          </div>

          <Card>
            <CardHeader
              title="Atividade do assistente"
              subtitle="Últimas ações executadas pela inteligência artificial"
              action={
                <Link to="/settings" className="text-xs font-medium text-emerald-400 transition-colors hover:text-emerald-300">
                  Configurar IA
                </Link>
              }
            />
            <div className="mt-4 space-y-1.5">
              {aiEvents.length === 0 ? (
                <p className="py-4 text-xs text-zinc-500">Nenhuma atividade recente da IA.</p>
              ) : (
                aiEvents.map((ev) => (
                  <div
                    key={ev.id}
                    className="flex items-center gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface-2)]/40 px-3.5 py-2"
                  >
                    <Badge tone={AI_EVENT_TONES[ev.event] ?? "neutral"} dot>
                      {AI_EVENT_LABELS[ev.event] ?? ev.event}
                    </Badge>
                    {ev.detail && (
                      <span className="min-w-0 flex-1 truncate text-xs text-zinc-400">
                        {ev.detail}
                      </span>
                    )}
                    <span className="ml-auto shrink-0 text-xs tabular-nums text-zinc-500">
                      {formatEventTime(ev.createdAt)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </Card>
        </section>
      )}

      {/* Ranking */}
      <Card>
        <CardHeader
          title="Fluxos mais executados"
          subtitle="Ranking de execuções acumuladas"
          action={
            <Link
              to="/flows"
              className="text-xs font-medium text-emerald-400 transition-colors hover:text-emerald-300"
            >
              Gerenciar fluxos
            </Link>
          }
        />
        <div className="mt-4 space-y-2">
          {loading && (
            <>
              <Skeleton className="h-14 rounded-lg" />
              <Skeleton className="h-14 rounded-lg" />
            </>
          )}
          {stats?.topFlows.map((f, i) => (
            <Link
              key={f.flowId}
              to={`/flows/${f.flowId}/runs`}
              className="group flex items-center justify-between gap-4 rounded-lg border border-[var(--line)] bg-[var(--surface-2)]/40 px-3.5 py-2.5 transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--surface-2)]"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--surface-3)] text-xs font-medium tabular-nums text-zinc-400">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-xs md:text-sm font-medium text-zinc-100">{f.name}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-400">
                    <Badge tone={f.enabled ? "success" : "neutral"} dot>
                      {f.enabled ? "Ativo" : "Inativo"}
                    </Badge>
                    <span className="tabular-nums">{f.count} execuções</span>
                  </div>
                </div>
              </div>
              <Icon
                name="chevronRight"
                className="h-4 w-4 shrink-0 text-zinc-500 transition-transform group-hover:translate-x-0.5 group-hover:text-emerald-400"
              />
            </Link>
          ))}
          {!loading && stats && stats.topFlows.length === 0 && (
            <EmptyState
              icon="activity"
              title="Nenhuma execução registrada"
              description="Assim que um fluxo rodar, o ranking aparece aqui."
            />
          )}
        </div>
      </Card>
    </div>
  );
}
