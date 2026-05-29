import { useCallback, useEffect, useState } from "react";
import { api } from "../../api/client";

type Instance = {
  id: string;
  name: string;
  label: string | null;
  isActive: boolean;
  onServer: boolean;
};

export function WppInstancesManager({ onActivated }: { onActivated?: () => void }) {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [active, setActive] = useState("");
  const [newName, setNewName] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    const r = await api<{
      active: string;
      instances: Instance[];
      serverError?: string;
    }>("/api/wpp/instances");
    setInstances(r.instances);
    setActive(r.active);
    if (r.serverError) {
      setError(`Servidor indisponível: ${r.serverError}`);
    }
  }, []);

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : "Erro ao carregar"));
  }, [load]);

  async function createInstance() {
    const name = newName.trim().toLowerCase();
    if (!name) {
      setError("Informe um nome (ex: autofintech)");
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
      setShowCreate(false);
      setMsg(`Instância "${name}" criada. Vá em Conexão / QR para escanear o QR.`);
      await load();
      onActivated?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao criar");
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
      setMsg(`"${name}" é a instância ativa.`);
      await load();
      onActivated?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao ativar");
    } finally {
      setLoading(false);
    }
  }

  async function remove(name: string) {
    if (
      !confirm(
        `Remover "${name}"?\n\nA sessão será apagada no servidor e você precisará conectar de novo.`
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
      setMsg(r.message ?? `Instância "${name}" removida.`);
      if (r.warning) setError(r.warning);
      onActivated?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao remover");
    } finally {
      setLoading(false);
    }
  }

  const activeInstance = instances.find((i) => i.isActive);

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}
      {msg && (
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {msg}
        </div>
      )}

      {activeInstance && (
        <div className="rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-zinc-950/80 p-5">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-xl">
              ✓
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium uppercase tracking-wide text-emerald-400/90">
                Instância ativa
              </p>
              <p className="text-lg font-semibold text-white truncate">
                {activeInstance.label ?? activeInstance.name}
              </p>
              <p className="text-sm text-zinc-400 font-mono mt-0.5">{activeInstance.name}</p>
              <p className="text-xs text-zinc-500 mt-2">
                {activeInstance.onServer
                  ? "Registrada no servidor Evolution"
                  : "Cadastrada no painel — conecte em Conexão / QR"}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-zinc-800/80">
          <div>
            <h2 className="text-base font-semibold text-white">Suas instâncias</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              {instances.length === 0
                ? "Nenhuma cadastrada"
                : `${instances.length} cadastrada${instances.length > 1 ? "s" : ""}`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreate((v) => !v)}
            className="rounded-lg bg-emerald-500/15 border border-emerald-500/25 px-3 py-2 text-sm font-medium text-emerald-300 hover:bg-emerald-500/25 transition"
          >
            {showCreate ? "Cancelar" : "+ Nova"}
          </button>
        </div>

        {showCreate && (
          <div className="px-5 py-4 border-b border-zinc-800/80 bg-zinc-900/30 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Nome da sessão</label>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="ex: autofintech"
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm font-mono text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/40"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-500 mb-1">Apelido (opcional)</label>
                <input
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="ex: Atendimento principal"
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/40"
                />
              </div>
            </div>
            <button
              type="button"
              disabled={loading}
              onClick={() => void createInstance()}
              className="w-full sm:w-auto rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-emerald-400 disabled:opacity-50"
            >
              Criar instância
            </button>
          </div>
        )}

        <ul className="divide-y divide-zinc-800/80">
          {instances.map((inst) => (
            <li
              key={inst.id}
              className={`flex flex-wrap items-center justify-between gap-3 px-5 py-4 ${
                inst.isActive ? "bg-emerald-500/[0.04]" : ""
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`h-10 w-10 shrink-0 rounded-full flex items-center justify-center text-sm font-bold ${
                    inst.isActive
                      ? "bg-emerald-500/20 text-emerald-300"
                      : "bg-zinc-800 text-zinc-500"
                  }`}
                >
                  {(inst.label ?? inst.name).charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-white truncate">
                      {inst.label ?? inst.name}
                    </span>
                    {inst.isActive && (
                      <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-300">
                        Ativa
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-500 font-mono truncate">{inst.name}</p>
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                {!inst.isActive && (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => void activate(inst.name)}
                    className="rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
                  >
                    Usar esta
                  </button>
                )}
                <button
                  type="button"
                  disabled={loading || inst.isActive}
                  onClick={() => void remove(inst.name)}
                  className="rounded-lg px-3 py-1.5 text-xs text-red-300/90 hover:bg-red-500/10 disabled:opacity-30"
                  title={inst.isActive ? "Ative outra instância antes" : undefined}
                >
                  Remover
                </button>
              </div>
            </li>
          ))}
          {instances.length === 0 && !showCreate && (
            <li className="px-5 py-8 text-center text-sm text-zinc-500">
              Nenhuma instância ainda. Clique em <strong className="text-zinc-400">+ Nova</strong>{" "}
              para criar.
            </li>
          )}
        </ul>
      </div>

      {active && (
        <p className="text-center text-xs text-zinc-600">
          Sessão em uso no painel: <span className="text-zinc-400 font-mono">{active}</span>
        </p>
      )}
    </div>
  );
}
