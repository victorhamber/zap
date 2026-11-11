import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Icon,
  LinkButton,
  PageHeader,
  Skeleton
} from "../components/ui";
import { customWebhookUrl, hotmartWebhookUrl } from "../components/flow/nodeMeta";

type FlowGraphNode = { type?: string };

type Flow = {
  id: string;
  name: string;
  enabled: boolean;
  updatedAt: string;
  graphJson?: { nodes?: FlowGraphNode[] };
};

type WebhookShortcut = {
  kind: "hotmart" | "custom" | null;
  path: string;
  fullUrl: string;
  label: string;
};

function webhookShortcutForFlow(flow: Flow): WebhookShortcut | null {
  const nodes = flow.graphJson?.nodes ?? [];
  const types = new Set(nodes.map((n) => String(n.type ?? "")));

  if (types.has("trigger_custom_webhook")) {
    const fullUrl = customWebhookUrl(flow.id);
    return {
      kind: "custom",
      path: `/api/webhooks/custom/${flow.id}`,
      fullUrl,
      label: "Webhook personalizado"
    };
  }
  if (types.has("trigger_hotmart") || types.has("trigger_hotmart_pending")) {
    const fullUrl = hotmartWebhookUrl(flow.id);
    return {
      kind: "hotmart",
      path: `/api/webhooks/hotmart/${flow.id}`,
      fullUrl,
      label: "Webhook Hotmart"
    };
  }
  return null;
}

function formatUpdatedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function FlowsList() {
  const nav = useNavigate();
  const [flows, setFlows] = useState<Flow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError("");
    try {
      setFlows(await api<Flow[]>("/api/flows"));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Não foi possível carregar os fluxos.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function createFlow() {
    try {
      const f = await api<Flow>("/api/flows", {
        method: "POST",
        body: JSON.stringify({ name: "Novo fluxo" })
      });
      nav(`/flows/${f.id}/edit`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Não foi possível criar o fluxo.");
    }
  }

  async function toggle(flow: Flow) {
    setBusyId(flow.id);
    try {
      await api(`/api/flows/${flow.id}`, {
        method: "PUT",
        body: JSON.stringify({ enabled: !flow.enabled })
      });
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Não foi possível alterar o fluxo.");
    } finally {
      setBusyId(null);
    }
  }

  async function removeFlow(flow: Flow) {
    if (!window.confirm(`Excluir o fluxo "${flow.name}"? Esta ação não pode ser desfeita.`)) return;
    setBusyId(flow.id);
    try {
      await api(`/api/flows/${flow.id}`, { method: "DELETE" });
      await refresh();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Não foi possível excluir o fluxo.");
    } finally {
      setBusyId(null);
    }
  }

  async function copyWebhook(flow: Flow) {
    const shortcut = webhookShortcutForFlow(flow);
    if (!shortcut) return;
    try {
      await navigator.clipboard.writeText(shortcut.fullUrl);
      setCopiedId(flow.id);
      window.setTimeout(
        () => setCopiedId((c) => (c === flow.id ? null : c)),
        2000
      );
    } catch {
      window.prompt("Copie a URL do webhook:", shortcut.fullUrl);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fluxos"
        subtitle="Automações visuais disparadas por compra, tag, mensagem recebida ou broadcast."
        actions={
          <Button variant="primary" icon="plus" onClick={() => void createFlow()}>
            Novo fluxo
          </Button>
        }
      />

      {error && <ErrorNotice>{error}</ErrorNotice>}

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-[104px] rounded-2xl" />
          <Skeleton className="h-[104px] rounded-2xl" />
          <Skeleton className="h-[104px] rounded-2xl" />
        </div>
      ) : flows.length === 0 ? (
        <EmptyState
          icon="flow"
          title="Nenhum fluxo criado ainda"
          description="Um fluxo é a sequência de mensagens, esperas e condições que roda sozinha quando o gatilho acontece."
          action={
            <Button variant="primary" icon="plus" onClick={() => void createFlow()}>
              Criar primeiro fluxo
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {flows.map((f) => {
            const webhook = webhookShortcutForFlow(f);
            return (
            <Card key={f.id} padded={false} interactive className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h2 className="truncate text-[15px] font-medium text-zinc-100">{f.name}</h2>
                    <Badge tone={f.enabled ? "success" : "neutral"} dot>
                      {f.enabled ? "Ativo" : "Pausado"}
                    </Badge>
                  </div>

                  <p className="mt-1.5 text-xs text-zinc-500">
                    Atualizado em {formatUpdatedAt(f.updatedAt)}
                  </p>

                  {webhook ? (
                  <button
                    type="button"
                    onClick={() => void copyWebhook(f)}
                    title={`Copiar URL — ${webhook.label}`}
                    className="group mt-2.5 inline-flex max-w-full items-center gap-2 rounded-md border border-[var(--line)] bg-[var(--surface-2)]/60 px-2.5 py-1 text-left transition-colors hover:border-emerald-500/40 hover:bg-[var(--surface-2)]"
                  >
                    <Icon
                      name={copiedId === f.id ? "check" : "copy"}
                      className={`h-3.5 w-3.5 shrink-0 ${
                        copiedId === f.id ? "text-emerald-400" : "text-zinc-400"
                      }`}
                    />
                    <code className="truncate font-mono text-[11px] text-zinc-300">
                      {copiedId === f.id
                        ? "URL do webhook copiada!"
                        : webhook.path}
                    </code>
                  </button>
                  ) : null}
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    icon="power"
                    disabled={busyId === f.id}
                    onClick={() => void toggle(f)}
                    title={f.enabled ? "Pausar fluxo" : "Ativar fluxo"}
                  >
                    {f.enabled ? "Pausar" : "Ativar"}
                  </Button>
                  <LinkButton size="sm" icon="pencil" to={`/flows/${f.id}/edit`}>
                    Editar
                  </LinkButton>
                  <LinkButton size="sm" icon="list" to={`/flows/${f.id}/runs`}>
                    Logs
                  </LinkButton>
                  <Button
                    size="sm"
                    variant="danger"
                    icon="trash"
                    disabled={busyId === f.id}
                    onClick={() => void removeFlow(f)}
                    aria-label={`Excluir ${f.name}`}
                  />
                </div>
              </div>
            </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
