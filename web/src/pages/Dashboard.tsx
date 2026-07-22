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
  type IconName,
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
  topFlows: { flowId: string; name: string; enabled: boolean; count: number }[];
};

const TRIGGER_LABELS: Record<string, string> = {
  trigger_hotmart: "Hotmart (aprovada)",
  trigger_hotmart_pending: "Hotmart (aguardando)",
  trigger_tag: "Tag",
  trigger_inbound: "Mensagem",
  trigger_broadcast: "Broadcast",
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

function formatDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "2-digit"
  });
}

/* ------------------------------------------------------------------ */

function StatCard({
  label,
  value,
  hint,
  to,
  icon,
  tone = "neutral",
  loading
}: {
  label: string;
  value: string | number;
  hint?: string;
  to?: string;
  icon: IconName;
  tone?: "neutral" | "brand" | "sky" | "amber";
  loading?: boolean;
}) {
  const toneClass = {
    neutral: "text-zinc-400 bg-[var(--surface-2)]",
    brand: "text-brand-300 bg-brand-500/10",
    sky: "text-sky-300 bg-sky-500/10",
    amber: "text-amber-300 bg-amber-500/10"
  }[tone];

  const inner = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs font-medium text-zinc-500">{label}</span>
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${toneClass}`}>
          <Icon name={icon} className="h-4 w-4" />
        </span>
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-7 w-20" />
      ) : (
        <div className="mt-2 text-[26px] font-semibold leading-none tracking-tight text-white">
          {value}
        </div>
      )}
      {hint &&
        (loading ? (
          <Skeleton className="mt-3 h-3 w-28" />
        ) : (
          <div className="mt-2.5 text-xs text-zinc-500">{hint}</div>
        ))}
    </>
  );

  const base =
    "rounded-2xl border border-[var(--line)] bg-[var(--surface-1)] p-4 shadow-[0_10px_30px_-18px_rgba(0,0,0,0.9)]";

  if (to) {
    return (
      <Link
        to={to}
        className={`${base} block transition duration-200 hover:-translate-y-0.5 hover:border-brand-500/30 hover:bg-[var(--surface-2)]`}
      >
        {inner}
      </Link>
    );
  }
  return <div className={base}>{inner}</div>;
}

function BarChart({
  data,
  from = "#34d399",
  to = "#059669"
}: {
  data: { date: string; count: number }[];
  from?: string;
  to?: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.count));

  return (
    <div className="flex h-40 items-end gap-1.5">
      {data.map((d) => (
        <div
          key={d.date}
          className="zap-bar-group group flex min-w-0 flex-1 flex-col items-center gap-2"
          title={`${formatDay(d.date)} — ${d.count}`}
        >
          <span
            className={`text-[11px] font-medium tabular-nums transition ${
              d.count ? "text-zinc-400 group-hover:text-brand-300" : "text-transparent"
            }`}
          >
            {d.count || "0"}
          </span>
          <div className="flex h-24 w-full items-end justify-center">
            <div
              className="zap-bar w-full max-w-[34px]"
              style={
                {
                  height: `${Math.max(3, (d.count / max) * 100)}%`,
                  opacity: d.count ? 1 : 0.18,
                  "--bar-top": from,
                  "--bar-bottom": to
                } as React.CSSProperties
              }
            />
          </div>
          <span className="w-full truncate text-center text-[10px] capitalize text-zinc-600">
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

export function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
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
    <div className="space-y-8">
      <PageHeader
        title="Dashboard"
        subtitle="Visão geral das automações, envios e engajamento dos últimos 7 dias."
        actions={
          <Link
            to="/runs"
            className="inline-flex items-center gap-1.5 text-sm text-brand-400 transition hover:text-brand-300"
          >
            Ver execuções
            <Icon name="chevronRight" className="h-4 w-4" />
          </Link>
        }
      />

      {error && <ErrorNotice>{error}</ErrorNotice>}

      {/* Métricas principais */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Fluxos ativos"
          value={stats?.flows.active ?? 0}
          hint={`${stats?.flows.total ?? 0} no total`}
          to="/flows"
          icon="flow"
          tone="brand"
          loading={loading}
        />
        <StatCard
          label="WhatsApp"
          value={wpp.label}
          hint="Status da conexão"
          to="/whatsapp"
          icon="chat"
          tone={wpp.connected ? "brand" : "neutral"}
        />
        <StatCard
          label="Execuções hoje"
          value={stats?.runs.today ?? 0}
          hint={`${stats?.runs.last7Days ?? 0} nos últimos 7 dias`}
          icon="activity"
          tone="sky"
          loading={loading}
        />
        <StatCard
          label="Taxa de sucesso"
          value={`${successRate}%`}
          hint={`${stats?.runs.total ?? 0} execuções no total`}
          icon="check"
          tone={successRate >= 80 ? "brand" : "amber"}
          loading={loading}
        />
      </section>

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Contatos" value={stats?.contacts ?? 0} hint="Base CRM" icon="users" loading={loading} />
        <StatCard label="Tags" value={stats?.tags ?? 0} hint="Segmentação" icon="tag" loading={loading} />
        <StatCard
          label="Enviadas hoje"
          value={stats?.messages.sentToday ?? 0}
          hint={`${stats?.messages.receivedToday ?? 0} recebidas hoje`}
          to="/whatsapp"
          icon="send"
          loading={loading}
        />
        <StatCard
          label="Agendamentos"
          value={stats?.scheduled.pending ?? 0}
          hint="Passos aguardando no fluxo"
          icon="clock"
          loading={loading}
        />
      </section>

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

      {/* Ranking */}
      <Card>
        <CardHeader
          title="Fluxos mais executados"
          subtitle="Ranking geral"
          action={
            <Link
              to="/flows"
              className="text-xs text-brand-400 transition hover:text-brand-300"
            >
              Gerenciar fluxos
            </Link>
          }
        />
        <div className="mt-5 space-y-2">
          {loading && (
            <>
              <Skeleton className="h-16 rounded-xl" />
              <Skeleton className="h-16 rounded-xl" />
            </>
          )}
          {stats?.topFlows.map((f, i) => (
            <Link
              key={f.flowId}
              to={`/flows/${f.flowId}/runs`}
              className="group flex items-center justify-between gap-4 rounded-xl border border-[var(--line)] bg-[var(--surface-2)]/60 px-4 py-3 transition hover:border-[var(--line-strong)] hover:bg-[var(--surface-2)]"
            >
              <div className="flex min-w-0 items-center gap-3.5">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-3)] text-xs font-semibold tabular-nums text-zinc-400">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-zinc-100">{f.name}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-zinc-500">
                    <Badge tone={f.enabled ? "success" : "neutral"} dot>
                      {f.enabled ? "Ativo" : "Inativo"}
                    </Badge>
                    <span className="tabular-nums">{f.count} execuções</span>
                  </div>
                </div>
              </div>
              <Icon
                name="chevronRight"
                className="h-4 w-4 shrink-0 text-zinc-600 transition group-hover:translate-x-0.5 group-hover:text-brand-400"
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
