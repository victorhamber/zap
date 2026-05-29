import { useCallback, useEffect, useState } from "react";
import { api } from "../../api/client";

type Instance = {
  id: string;
  name: string;
  label: string | null;
  isActive: boolean;
  onServer: boolean;
};

type OrphanCleanup = {
  purged: string[];
  failed: Array<{ name: string; error: string }>;
};

export function WppInstancesManager({ onActivated }: { onActivated?: () => void }) {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [serverSessions, setServerSessions] = useState<string[]>([]);
  const [orphanSessions, setOrphanSessions] = useState<string[]>([]);
  const [keepNames, setKeepNames] = useState<string[]>([]);
  const [serverError, setServerError] = useState("");
  const [active, setActive] = useState("");
  const [newName, setNewName] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");

  const load = useCallback(async () => {
    const r = await api<{
      active: string;
      instances: Instance[];
      serverSessions: string[];
      orphanSessions?: string[];
      keepNames?: string[];
      serverError?: string;
      orphanCleanup?: OrphanCleanup | null;
    }>("/api/wpp/instances");
    setInstances(r.instances);
    setActive(r.active);
    setServerSessions(r.serverSessions);
    setOrphanSessions(r.orphanSessions ?? []);
    setKeepNames(r.keepNames ?? []);
    setServerError(r.serverError ?? "");
    if (r.orphanCleanup?.purged?.length) {
      setMsg(
        `Limpeza automática: removidas ${r.orphanCleanup.purged.join(", ")}.`
      );
    }
    if (r.orphanCleanup?.failed?.length) {
      setError(
        r.orphanCleanup.failed.map((f) => `${f.name}: ${f.error}`).join(" · ")
      );
    }
  }, []);

  useEffect(() => {
    load().catch((e) => setError(e?.message ?? "Erro ao carregar instâncias"));
  }, [load]);

  async function createInstance() {
    const name = newName.trim().toLowerCase();
    if (!name) {
      setError("Informe um nome para a instância (ex: vendas, suporte)");
      return;
    }
    setLoading(true);
    setError("");
    setMsg("");
    try {
      await api("/api/wpp/instances", {
        method: "POST",
        body: JSON.stringify({ name, label: newLabel.trim() || name, connect: false })
      });
      setNewName("");
      setNewLabel("");
      setMsg(`Instância "${name}" criada. Vá em Conexão / QR e clique em Conectar.`);
      await load();
      onActivated?.();
    } catch (e: any) {
      setError(e?.message ?? "Erro ao criar instância");
    } finally {
      setLoading(false);
    }
  }

  async function activate(name: string) {
    setLoading(true);
    setError("");
    try {
      await api(`/api/wpp/instances/${encodeURIComponent(name)}/activate`, {
        method: "POST",
        body: JSON.stringify({})
      });
      await api("/api/settings/wpp/refresh-token", {
        method: "POST",
        body: JSON.stringify({})
      });
      setMsg(`Instância "${name}" ativa.`);
      await load();
      onActivated?.();
    } catch (e: any) {
      setError(e?.message ?? "Erro ao ativar");
    } finally {
      setLoading(false);
    }
  }

  async function remove(name: string) {
    if (
      !confirm(
        `Remover "${name}"?\n\nA sessão será apagada também no servidor WPP (tokens e pasta do Chrome).`
      )
    )
      return;
    setLoading(true);
    setError("");
    try {
      const r = await api<{ ok: boolean; message?: string; warning?: string }>(
        `/api/wpp/instances/${encodeURIComponent(name)}`,
        { method: "DELETE" }
      );
      await load();
      if (r.warning) {
        setError(r.warning);
        setMsg(r.message ?? `Instância "${name}" removida do painel.`);
      } else {
        setMsg(r.message ?? `Instância "${name}" removida.`);
      }
      onActivated?.();
    } catch (e: any) {
      setError(e?.message ?? "Erro ao remover");
    } finally {
      setLoading(false);
    }
  }

  async function purgeOnServer(name: string) {
    if (!confirm(`Apagar a sessão "${name}" no servidor WPP (tokens + Chrome)?`)) return;
    setLoading(true);
    setError("");
    setMsg("");
    try {
      const r = await api<{ ok: boolean; message?: string }>(
        `/api/wpp/purge-server/${encodeURIComponent(name)}`,
        { method: "POST", body: JSON.stringify({}) }
      );
      await load();
      if (r.ok) setMsg(r.message ?? `Sessão "${name}" removida do servidor.`);
      else setError(r.message ?? "Falha ao apagar no servidor");
    } catch (e: any) {
      setError(e?.message ?? "Erro ao apagar no servidor");
    } finally {
      setLoading(false);
    }
  }

  async function cleanupOrphans() {
    setLoading(true);
    setError("");
    setMsg("");
    try {
      const r = await api<{
        ok: boolean;
        message?: string;
        purged?: string[];
        failed?: Array<{ name: string; error: string }>;
        targets?: string[];
        serverSessionsBefore?: string[];
        serverError?: string;
      }>("/api/wpp/cleanup-orphans", { method: "POST", body: JSON.stringify({}) });
      await load();
      setMsg(r.message ?? "Limpeza concluída.");
      if (r.failed?.length) {
        setError(r.failed.map((f) => `${f.name}: ${f.error}`).join(" · "));
      }
      if (r.serverError) {
        setError((prev) => (prev ? `${prev} · ` : "") + r.serverError);
      }
    } catch (e: any) {
      setError(e?.message ?? "Erro na limpeza");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5">
      <h2 className="text-lg font-semibold text-white">Instâncias WhatsApp</h2>
      <p className="text-sm text-zinc-400 mt-1">
        Remover no painel apaga a sessão no WPP. Use &quot;Limpar órfãs&quot; para sessões que só
        existem no servidor.
      </p>

      {error && (
        <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}
      {msg && <p className="mt-3 text-sm text-emerald-400/90">{msg}</p>}

      {serverError && (
        <div className="mt-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
          Não foi possível listar o WPP: {serverError}. Confira WPP_INTERNAL_URL e se o serviço
          wppconnect está online.
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="nome-sessao (ex: autofintech)"
          className="flex-1 min-w-[140px] rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-mono"
        />
        <input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="Apelido (opcional)"
          className="flex-1 min-w-[120px] rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm"
        />
        <button
          type="button"
          disabled={loading}
          onClick={createInstance}
          className="rounded-xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          + Nova instância
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={cleanupOrphans}
          className="rounded-xl border border-zinc-600 px-4 py-2 text-sm hover:bg-zinc-800 disabled:opacity-50"
        >
          Limpar órfãs no WPP
        </button>
      </div>

      <ul className="mt-5 space-y-2">
        {instances.map((inst) => (
          <li
            key={inst.id}
            className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border px-4 py-3 ${
              inst.isActive ? "border-emerald-500/40 bg-emerald-500/5" : "border-zinc-800 bg-zinc-900/40"
            }`}
          >
            <div>
              <div className="font-medium text-white">{inst.label ?? inst.name}</div>
              <code className="text-xs text-zinc-500">{inst.name}</code>
              <div className="text-xs text-zinc-500 mt-0.5">
                {inst.isActive ? "● Ativa no Zap" : "○ Inativa"}
                {inst.onServer ? " · no servidor WPP" : " · só no Zap"}
              </div>
            </div>
            <div className="flex gap-2">
              {!inst.isActive && (
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => activate(inst.name)}
                  className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs hover:bg-zinc-800"
                >
                  Usar esta
                </button>
              )}
              {inst.onServer && !inst.isActive && (
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => purgeOnServer(inst.name)}
                  className="rounded-lg border border-amber-800/50 px-3 py-1.5 text-xs text-amber-200 hover:bg-amber-950/30"
                >
                  Apagar no WPP
                </button>
              )}
              <button
                type="button"
                disabled={loading || inst.isActive}
                onClick={() => remove(inst.name)}
                className="rounded-lg border border-red-900/40 px-3 py-1.5 text-xs text-red-300 hover:bg-red-950/30 disabled:opacity-40"
                title={inst.isActive ? "Ative outra instância antes de remover esta" : undefined}
              >
                Remover
              </button>
            </div>
          </li>
        ))}
        {instances.length === 0 && (
          <li className="text-sm text-zinc-500">Nenhuma instância cadastrada ainda.</li>
        )}
      </ul>

      <div className="mt-4 rounded-xl border border-zinc-800 bg-zinc-900/30 p-3 text-xs text-zinc-400">
        <p className="text-zinc-300 font-medium mb-1">Servidor WPP (show-all-sessions)</p>
        {serverSessions.length === 0 ? (
          <p className="text-zinc-500">Nenhuma sessão listada{serverError ? " (erro acima)" : ""}.</p>
        ) : (
          <p className="font-mono text-zinc-400">{serverSessions.join(", ")}</p>
        )}
        {keepNames.length > 0 && (
          <p className="mt-2 text-zinc-500">
            Protegidas no painel: <span className="text-zinc-400">{keepNames.join(", ")}</span>
          </p>
        )}
        {orphanSessions.length > 0 && (
          <div className="mt-3">
            <p className="text-amber-200/90 mb-2">Órfãs (não cadastradas): {orphanSessions.join(", ")}</p>
            <div className="flex flex-wrap gap-2">
              {orphanSessions.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={loading}
                  onClick={() => purgeOnServer(s)}
                  className="rounded-lg border border-red-900/40 px-2 py-1 text-red-300 hover:bg-red-950/30"
                >
                  Apagar {s}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <p className="mt-3 text-xs text-zinc-500">
        Ativa agora: <code className="text-zinc-400">{active}</code>
      </p>
    </div>
  );
}
