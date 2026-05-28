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
  const [serverSessions, setServerSessions] = useState<string[]>([]);
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
    }>("/api/wpp/instances");
    setInstances(r.instances);
    setActive(r.active);
    setServerSessions(r.serverSessions);
  }, []);

  useEffect(() => {
    load().catch(() => {});
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
        `Remover "${name}" do painel Zap?\n\nA sessão pode continuar no servidor WPP, mas não voltará a aparecer aqui automaticamente.`
      )
    )
      return;
    setLoading(true);
    try {
      const r = await api<{ ok: boolean; message?: string }>(
        `/api/wpp/instances/${encodeURIComponent(name)}`,
        { method: "DELETE" }
      );
      await load();
      setMsg(r.message ?? `Instância "${name}" removida.`);
    } catch (e: any) {
      setError(e?.message ?? "Erro ao remover");
    } finally {
      setLoading(false);
    }
  }

  const orphanServer = serverSessions.filter((s) => !instances.some((i) => i.name === s));

  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-5">
      <h2 className="text-lg font-semibold text-white">Instâncias WhatsApp</h2>
      <p className="text-sm text-zinc-400 mt-1">
        Cada instância = um WhatsApp diferente. Crie aqui, depois conecte o QR na aba Conexão.
      </p>

      {error && (
        <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}
      {msg && <p className="mt-3 text-sm text-emerald-400/90">{msg}</p>}

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
              <button
                type="button"
                disabled={loading || inst.isActive}
                onClick={() => remove(inst.name)}
                className="rounded-lg border border-red-900/40 px-3 py-1.5 text-xs text-red-300 hover:bg-red-950/30 disabled:opacity-40"
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

      {orphanServer.length > 0 && (
        <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-zinc-400">
          <p className="text-amber-200/90 font-medium mb-1">
            Sessões no servidor WPP (importar manualmente)
          </p>
          <p className="mb-2 text-zinc-500">
            Só aparecem aqui se você quiser adicionar de volta ao painel.
          </p>
          <div className="flex flex-wrap gap-2">
            {orphanServer.map((s) => (
              <button
                key={s}
                type="button"
                disabled={loading}
                onClick={async () => {
                  await api("/api/wpp/instances", {
                    method: "POST",
                    body: JSON.stringify({ name: s, label: s, connect: false })
                  });
                  await load();
                }}
                className="rounded-lg border border-zinc-700 px-2 py-1 hover:bg-zinc-800"
              >
                + {s}
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="mt-3 text-xs text-zinc-500">
        Ativa agora: <code className="text-zinc-400">{active}</code>
      </p>
    </div>
  );
}
