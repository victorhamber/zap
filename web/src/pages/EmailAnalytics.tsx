import { useEffect, useState } from "react";
import { api } from "../api/client";
import { Badge, Card, ErrorNotice, PageHeader } from "../components/ui";

type FlowTotal = { flow: string; sent: number; skipped: number; failed: number };
type Item = {
  at: string;
  flow: string;
  phone: string;
  outcome: "sent" | "skipped" | "failed";
  message: string;
};
type Report = {
  ok: boolean;
  total: number;
  truncated: boolean;
  sent: number;
  skipped: number;
  failed: number;
  byFlow: FlowTotal[];
  recent: Item[];
  error?: string;
};

const OUTCOME: Record<Item["outcome"], { label: string; tone: "success" | "warning" | "danger" }> = {
  sent: { label: "Enviado", tone: "success" },
  skipped: { label: "Não enviado", tone: "warning" },
  failed: { label: "Falhou", tone: "danger" }
};

function when(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

export function EmailAnalytics() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void api<Report>("/api/email/dispatches")
      .then(setReport)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Não foi possível ler os e-mails."));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="E-mails"
        subtitle="O que o fluxo chegou a entregar. O e-mail só começa depois que o bloco anterior termina."
      />
      {error && <ErrorNotice>{error}</ErrorNotice>}
      {!report && !error && <p className="text-sm text-zinc-500">Carregando…</p>}
      {report && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Card className="p-4">
              <p className="text-xs text-zinc-500">Enviados</p>
              <p className="mt-1 text-2xl font-semibold text-zinc-100">{report.sent}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-zinc-500">Não enviados</p>
              <p className="mt-1 text-2xl font-semibold text-zinc-100">{report.skipped}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-zinc-500">Falhas</p>
              <p className="mt-1 text-2xl font-semibold text-zinc-100">{report.failed}</p>
            </Card>
          </div>
          {report.total === 0 && (
            <Card className="p-4 text-sm text-zinc-300">
              Nenhum e-mail saiu por fluxo. No disparo que repetiu os grupos, a execução parou no bloco de grupos e o e-mail nem começou.
            </Card>
          )}
          {report.byFlow.length > 0 && (
            <Card padded={false} className="overflow-hidden">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-zinc-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Fluxo</th>
                    <th className="px-4 py-3 font-medium">Enviados</th>
                    <th className="px-4 py-3 font-medium">Não enviados</th>
                    <th className="px-4 py-3 font-medium">Falhas</th>
                  </tr>
                </thead>
                <tbody>
                  {report.byFlow.map((row) => (
                    <tr key={row.flow} className="border-t border-zinc-800">
                      <td className="px-4 py-3 text-zinc-100">{row.flow}</td>
                      <td className="px-4 py-3 text-zinc-300">{row.sent}</td>
                      <td className="px-4 py-3 text-zinc-300">{row.skipped}</td>
                      <td className="px-4 py-3 text-zinc-300">{row.failed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
          {report.recent.length > 0 && (
            <Card padded={false} className="overflow-hidden">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-zinc-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Quando</th>
                    <th className="px-4 py-3 font-medium">Fluxo</th>
                    <th className="px-4 py-3 font-medium">Resultado</th>
                    <th className="px-4 py-3 font-medium">Detalhe</th>
                  </tr>
                </thead>
                <tbody>
                  {report.recent.map((row) => {
                    const outcome = OUTCOME[row.outcome];
                    return (
                      <tr key={`${row.at}-${row.phone}-${row.message}`} className="border-t border-zinc-800">
                        <td className="px-4 py-3 text-zinc-400">{when(row.at)}</td>
                        <td className="px-4 py-3 text-zinc-100">{row.flow}</td>
                        <td className="px-4 py-3">
                          <Badge tone={outcome.tone}>{outcome.label}</Badge>
                        </td>
                        <td className="px-4 py-3 text-zinc-300">{row.message}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          )}
          {report.truncated && (
            <p className="text-xs text-zinc-500">A conta acima usa os mil registros mais recentes. O total no banco é {report.total}.</p>
          )}
        </>
      )}
    </div>
  );
}
