import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";

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
  trigger_hotmart: "Hotmart",
  trigger_tag: "Tag",
  trigger_inbound: "Mensagem",
  trigger_manual: "Manual"
};

const STATUS_LABELS: Record<string, string> = {
  completed: "Concluídas",
  failed: "Falhas",
  running: "Executando",
  waiting: "Aguardando"
};

const STATUS_COLORS: Record<string, string> = {
  completed: "bg-emerald-500",
  failed: "bg-red-500",
  running: "bg-sky-500",
  waiting: "bg-amber-500"
};

function formatDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "2-digit"
  });
}

function StatCard({
  label,
  value,
  hint,
  to,
  accent
}: {
  label: string;
  value: string | number;
  hint?: string;
  to?: string;
  accent?: string;
}) {
  const inner = (
    <>
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${accent ?? "text-white"}`}>{value}</div>
      {hint && <div className="text-xs text-zinc-500 mt-1.5">{hint}</div>}
    </>
  );

  if (to) {
    return (
      <Link
        to={to}
        className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4 block hover:border-emerald-500/30 transition"
      >
        {inner}
      </Link>
    );
  }

  return <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">{inner}</div>;
}

function BarChart({
  data,
  color = "bg-emerald-500"
}: {
  data: { date: string; count: number }[];
  color?: string;
}) {
  const max = Math.max(1, ...data.map((d) => d.count));

  return (
    <div className="flex items-end gap-2 h-36 pt-2">
      {data.map((d) => (
        <div key={d.date} className="flex-1 flex flex-col items-center gap-2 min-w-0">
          <span className="text-[10px] text-zinc-500 tabular-nums">{d.count || ""}</span>
          <div className="w-full flex items-end justify-center h-24">
            <div
              className={`w-full max-w-[36px] rounded-t-md ${color} transition-all`}
              style={{ height: `${Math.max(4, (d.count / max) * 100)}%`, opacity: d.count ? 1 : 0.15 }}
            />
          </div>
          <span className="text-[10px] text-zinc-500 truncate w-full text-center">
            {formatDay(d.date)}
          </span>
        </div>
      ))}
    </div>
  );
}

function DistributionList({
  items,
  labelKey,
  labels,
  colors
}: {
  items: { [key: string]: string | number }[];
  labelKey: string;
  labels: Record<string, string>;
  colors?: Record<string, string>;
}) {
  const total = items.reduce((s, i) => s + Number(i.count), 0) || 1;

  if (items.length === 0) {
    return <p className="text-sm text-zinc-600">Sem dados ainda.</p>;
  }

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const key = String(item[labelKey]);
        const count = Number(item.count);
        const pct = Math.round((count / total) * 100);
        return (
          <div key={key}>
            <div className="flex justify-between text-xs mb-1">
              <span className="text-zinc-300">{labels[key] ?? key}</span>
              <span className="text-zinc-500 tabular-nums">
                {count} ({pct}%)
              </span>
            </div>
            <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
              <div
                className={`h-full rounded-full ${colors?.[key] ?? "bg-emerald-500"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function Dashboard() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [wppStatus, setWppStatus] = useState<string>("…");

  useEffect(() => {
    api<DashboardStats>("/api/dashboard/stats")
      .then(setStats)
      .catch(() => setStats(null));
    api<{ ok: boolean; error?: string }>("/api/settings/wpp/status")
      .then((r) => setWppStatus(r.ok ? "Conectado" : r.error ?? "Desconectado"))
      .catch(() => setWppStatus("Indisponível"));
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
    <div className="max-w-6xl">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-zinc-400 mt-1">Visão geral das automações e engajamento</p>
        </div>
        <Link
          to="/runs"
          className="text-xs text-emerald-400 hover:underline"
        >
          Ver execuções detalhadas →
        </Link>
      </div>

      <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Fluxos ativos"
          value={stats?.flows.active ?? "—"}
          hint={`${stats?.flows.total ?? 0} no total`}
          to="/flows"
        />
        <StatCard
          label="WhatsApp"
          value={wppStatus}
          hint="Status da conexão"
          to="/whatsapp"
          accent={wppStatus === "Conectado" ? "text-emerald-300" : "text-zinc-300"}
        />
        <StatCard
          label="Execuções hoje"
          value={stats?.runs.today ?? "—"}
          hint={`${stats?.runs.last7Days ?? 0} nos últimos 7 dias`}
        />
        <StatCard
          label="Taxa de sucesso"
          value={stats ? `${successRate}%` : "—"}
          hint={`${stats?.runs.total ?? 0} execuções no total`}
        />
      </div>

      <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Contatos" value={stats?.contacts ?? "—"} hint="Base CRM" />
        <StatCard label="Tags" value={stats?.tags ?? "—"} hint="Segmentação" />
        <StatCard
          label="Msgs enviadas hoje"
          value={stats?.messages.sentToday ?? "—"}
          hint={`${stats?.messages.receivedToday ?? 0} recebidas hoje`}
          to="/whatsapp"
        />
        <StatCard
          label="Agendamentos"
          value={stats?.scheduled.pending ?? "—"}
          hint="Passos aguardando no fluxo"
        />
      </div>

      <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5">
          <h2 className="text-sm font-semibold text-zinc-200">Execuções — últimos 7 dias</h2>
          <p className="text-xs text-zinc-500 mt-1">Fluxos disparados por dia</p>
          <div className="mt-4">
            {stats ? (
              <BarChart data={stats.runs.daily} color="bg-emerald-500" />
            ) : (
              <p className="text-sm text-zinc-600 py-8">Carregando…</p>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5">
          <h2 className="text-sm font-semibold text-zinc-200">Mensagens enviadas — 7 dias</h2>
          <p className="text-xs text-zinc-500 mt-1">Pelo inbox / automações</p>
          <div className="mt-4">
            {stats ? (
              <BarChart data={stats.messages.dailySent} color="bg-sky-500" />
            ) : (
              <p className="text-sm text-zinc-600 py-8">Carregando…</p>
            )}
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5">
          <h2 className="text-sm font-semibold text-zinc-200">Por gatilho</h2>
          <p className="text-xs text-zinc-500 mt-1">Como os fluxos foram iniciados</p>
          <div className="mt-4">
            {stats && (
              <DistributionList
                items={stats.runs.byTrigger.map((t) => ({
                  trigger: t.trigger,
                  count: t.count
                }))}
                labelKey="trigger"
                labels={TRIGGER_LABELS}
              />
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5">
          <h2 className="text-sm font-semibold text-zinc-200">Por status</h2>
          <p className="text-xs text-zinc-500 mt-1">Resultado das execuções</p>
          <div className="mt-4">
            {stats && (
              <DistributionList
                items={stats.runs.byStatus.map((s) => ({
                  status: s.status,
                  count: s.count
                }))}
                labelKey="status"
                labels={STATUS_LABELS}
                colors={STATUS_COLORS}
              />
            )}
          </div>
        </div>
      </div>

      <div className="mt-6 rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-zinc-200">Fluxos mais executados</h2>
            <p className="text-xs text-zinc-500 mt-1">Ranking geral</p>
          </div>
          <Link to="/flows" className="text-xs text-emerald-400 hover:underline shrink-0">
            Gerenciar fluxos
          </Link>
        </div>
        <div className="mt-4 space-y-2">
          {stats?.topFlows.map((f, i) => (
            <Link
              key={f.flowId}
              to={`/flows/${f.flowId}/runs`}
              className="flex items-center justify-between gap-4 rounded-xl border border-zinc-800/80 bg-zinc-900/30 px-4 py-3 hover:border-zinc-700 transition"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-xs font-bold text-zinc-600 w-5">{i + 1}.</span>
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{f.name}</div>
                  <div className="text-xs text-zinc-500">
                    {f.enabled ? "Ativo" : "Inativo"} · {f.count} execuções
                  </div>
                </div>
              </div>
              <span className="text-xs text-zinc-500 shrink-0">Ver →</span>
            </Link>
          ))}
          {stats && stats.topFlows.length === 0 && (
            <p className="text-sm text-zinc-600">Nenhuma execução registrada ainda.</p>
          )}
        </div>
      </div>
    </div>
  );
}
