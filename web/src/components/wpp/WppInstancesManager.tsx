import { useCallback, useEffect, useState } from "react";
import { api } from "../../api/client";

type BusinessConfig = {
  integration: "baileys" | "business";
  metaPhoneNumberId: string | null;
  metaBusinessId: string | null;
  metaAccessTokenMasked: string | null;
  metaWebhookVerifyTokenMasked: string | null;
  hasMetaAccessToken: boolean;
  hasMetaWebhookVerifyToken: boolean;
  metaWebhookUrl: string | null;
};

type Instance = {
  id: string;
  name: string;
  label: string | null;
  isActive: boolean;
  onServer: boolean;
  integration?: "baileys" | "business";
  business?: BusinessConfig;
};

export function WppInstancesManager({ onActivated }: { onActivated?: () => void }) {
  const [instances, setInstances] = useState<Instance[]>([]);
  const [active, setActive] = useState("");
  const [newName, setNewName] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newIntegration, setNewIntegration] = useState<"baileys" | "business">("baileys");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [configuring, setConfiguring] = useState<string | null>(null);
  const [bizForm, setBizForm] = useState({
    metaPhoneNumberId: "",
    metaBusinessId: "",
    metaAccessToken: "",
    metaWebhookVerifyToken: ""
  });

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
        body: JSON.stringify({
          name,
          label: newLabel.trim() || name,
          connect: false,
          integration: newIntegration
        })
      });
      setNewName("");
      setNewLabel("");
      setShowCreate(false);
      setMsg(
        newIntegration === "business"
          ? `Instância "${name}" criada. Configure a API oficial Meta abaixo.`
          : `Instância "${name}" criada. Vá em QR (WAHA) para escanear o QR.`
      );
      await load();
      if (newIntegration === "business") setConfiguring(name);
      onActivated?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao criar");
    } finally {
      setLoading(false);
    }
  }

  async function openBusinessConfig(name: string) {
    setConfiguring(name);
    setError("");
    try {
      const cfg = await api<BusinessConfig>(`/api/wpp/instances/${encodeURIComponent(name)}/business`);
      setBizForm({
        metaPhoneNumberId: cfg.metaPhoneNumberId ?? "",
        metaBusinessId: cfg.metaBusinessId ?? "",
        metaAccessToken: "",
        metaWebhookVerifyToken: ""
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao carregar config");
    }
  }

  async function saveBusinessConfig(name: string) {
    setLoading(true);
    setError("");
    setMsg("");
    try {
      const r = await api<BusinessConfig & { ok: boolean }>(
        `/api/wpp/instances/${encodeURIComponent(name)}/business`,
        {
          method: "PUT",
          body: JSON.stringify({
            integration: "business",
            metaPhoneNumberId: bizForm.metaPhoneNumberId.trim(),
            metaBusinessId: bizForm.metaBusinessId.trim(),
            ...(bizForm.metaAccessToken.trim()
              ? { metaAccessToken: bizForm.metaAccessToken.trim() }
              : {}),
            ...(bizForm.metaWebhookVerifyToken.trim()
              ? { metaWebhookVerifyToken: bizForm.metaWebhookVerifyToken.trim() }
              : {})
          })
        }
      );
      setMsg(`API oficial configurada para "${name}".`);
      setBizForm((f) => ({ ...f, metaAccessToken: "", metaWebhookVerifyToken: "" }));
      await load();
      if (r.metaWebhookUrl) {
        setMsg(
          `Salvo. No Meta Developers, webhook URL: ${r.metaWebhookUrl} — use o mesmo token de verificação que você definiu aqui.`
        );
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao salvar");
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
      if (configuring === name) setConfiguring(null);
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
  const configuringInst = instances.find((i) => i.name === configuring);

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-3.5 py-2.5 text-xs md:text-sm text-rose-200">
          {error}
        </div>
      )}
      {msg && (
        <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/10 px-3.5 py-2.5 text-xs md:text-sm text-emerald-200">
          {msg}
        </div>
      )}

      <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-1)] px-4 py-3 text-xs leading-relaxed text-zinc-400 shadow-xs">
        O número que atende agora entra pelo QR (WAHA), na aba ao lado. Esta tela é a API oficial da Meta, uma segunda forma de conectar. Um número só aparece aqui depois que você cria essa instância.
      </div>

      {activeInstance && (
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-4 shadow-xs">
          <div className="flex items-start gap-3.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/20 text-emerald-400 text-sm font-semibold">
              ✓
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400">
                Instância ativa
              </p>
              <p className="text-sm md:text-base font-semibold text-zinc-100 truncate mt-0.5">
                {activeInstance.label ?? activeInstance.name}
              </p>
              <p className="text-xs text-zinc-400 font-mono">{activeInstance.name}</p>
              <p className="text-[11px] text-zinc-500 mt-1">
                {activeInstance.integration === "business"
                  ? "API oficial Meta (Cloud API)"
                  : activeInstance.onServer
                    ? "WAHA — sessão no servidor"
                    : "Cadastrada no painel — leia o QR na aba QR (WAHA)"}
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-1)] overflow-hidden shadow-xs">
        <div className="flex items-center justify-between gap-3 px-4 py-3.5 border-b border-[var(--line)]">
          <div>
            <h2 className="text-sm font-semibold tracking-tight text-zinc-100">Suas instâncias</h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              QR (WAHA) ou API oficial da Meta — uma credencial por número
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowCreate((v) => !v)}
            className="rounded-lg border border-[var(--line-strong)] bg-[var(--surface-2)] px-3 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-[var(--surface-3)] hover:text-white shadow-xs"
          >
            {showCreate ? "Cancelar" : "+ Nova instância"}
          </button>
        </div>

        {showCreate && (
          <div className="px-4 py-3.5 border-b border-[var(--line)] bg-[var(--surface-2)]/40 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">Nome da sessão</label>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="ex: autofintech"
                  className="w-full rounded-lg border border-[var(--line-strong)] bg-[var(--surface-2)] px-3 py-2 text-xs font-mono text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-emerald-500/50"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">Apelido (opcional)</label>
                <input
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="ex: Atendimento principal"
                  className="w-full rounded-lg border border-[var(--line-strong)] bg-[var(--surface-2)] px-3 py-2 text-xs text-zinc-100 placeholder:text-zinc-500 outline-none focus:border-emerald-500/50"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                Tipo de conexão — QR no servidor ou API oficial da Meta
              </label>
              <div className="flex flex-wrap gap-4 text-xs">
                <label className="flex items-center gap-2 text-zinc-300 cursor-pointer">
                  <input
                    type="radio"
                    checked={newIntegration === "baileys"}
                    onChange={() => setNewIntegration("baileys")}
                    className="accent-emerald-500"
                  />
                  WAHA (QR Code)
                </label>
                <label className="flex items-center gap-2 text-zinc-300 cursor-pointer">
                  <input
                    type="radio"
                    checked={newIntegration === "business"}
                    onChange={() => setNewIntegration("business")}
                    className="accent-emerald-500"
                  />
                  API oficial Meta
                </label>
              </div>
            </div>
            <button
              type="button"
              disabled={loading}
              onClick={() => void createInstance()}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white shadow-xs transition-colors hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-50"
            >
              Criar instância
            </button>
          </div>
        )}

        <ul className="divide-y divide-[var(--line)]">
          {instances.map((inst) => (
            <li
              key={inst.id}
              className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 ${
                inst.isActive ? "bg-emerald-500/[0.04]" : ""
              }`}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className={`h-9 w-9 shrink-0 rounded-lg flex items-center justify-center text-xs font-semibold ${
                    inst.isActive
                      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                      : "bg-[var(--surface-2)] text-zinc-400 border border-[var(--line)]"
                  }`}
                >
                  {(inst.label ?? inst.name).charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs md:text-sm font-medium text-zinc-100 truncate">
                      {inst.label ?? inst.name}
                    </span>
                    {inst.isActive && (
                      <span className="rounded-md border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-0.2 text-[10px] font-medium text-emerald-400">
                        Ativa
                      </span>
                    )}
                    {inst.integration === "business" && (
                      <span className="rounded-md border border-sky-500/20 bg-sky-500/10 px-1.5 py-0.2 text-[10px] font-medium text-sky-300">
                        Meta API
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-zinc-500 font-mono truncate">{inst.name}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 shrink-0">
                {inst.integration === "business" && (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => void openBusinessConfig(inst.name)}
                    className="rounded-lg border border-sky-500/25 bg-sky-500/10 px-2.5 py-1 text-xs font-medium text-sky-300 hover:bg-sky-500/20 transition-colors"
                  >
                    API Meta
                  </button>
                )}
                {!inst.isActive && (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => void activate(inst.name)}
                    className="rounded-lg border border-[var(--line-strong)] bg-[var(--surface-2)] px-2.5 py-1 text-xs font-medium text-zinc-200 hover:bg-[var(--surface-3)] hover:text-white transition-colors disabled:opacity-50"
                  >
                    Usar esta
                  </button>
                )}
                <button
                  type="button"
                  disabled={loading || inst.isActive}
                  onClick={() => void remove(inst.name)}
                  className="rounded-lg px-2.5 py-1 text-xs text-rose-300/80 hover:bg-rose-500/10 hover:text-rose-200 transition-colors disabled:opacity-30"
                  title={inst.isActive ? "Ative outra instância antes" : undefined}
                >
                  Remover
                </button>
              </div>
            </li>
          ))}
          {instances.length === 0 && !showCreate && (
            <li className="px-4 py-8 text-center text-xs text-zinc-500">
              Nenhuma instância da API oficial. O QR continua na aba ao lado. Clique em{" "}
              <strong className="text-zinc-400 font-medium">+ Nova instância</strong> para criar a conexão da Meta.
            </li>
          )}
        </ul>
      </div>

      {configuring && configuringInst && (
        <div className="rounded-xl border border-sky-500/25 bg-[var(--surface-1)] p-5 space-y-4 shadow-xs">
          <div className="flex justify-between items-start gap-3">
            <div>
              <h3 className="text-sm font-semibold tracking-tight text-zinc-100">API oficial Meta — {configuringInst.label ?? configuring}</h3>
              <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">
                Credenciais salvas criptografadas no Zap, por instância. Cada usuário usa o próprio app Meta.
              </p>
            </div>
            <button
              type="button"
              className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
              onClick={() => setConfiguring(null)}
            >
              Fechar
            </button>
          </div>

          {configuringInst.business?.metaWebhookUrl && (
            <div className="rounded-lg border border-zinc-800 bg-[var(--surface-2)]/60 p-3 text-xs text-zinc-400 space-y-1">
              <p>
                <strong className="text-zinc-200">Webhook URL</strong> (Meta Developers → WhatsApp →
                Configurar):
              </p>
              <p className="font-mono text-sky-400 break-all">{configuringInst.business.metaWebhookUrl}</p>
              <p className="pt-1 text-[11px] text-zinc-500">
                Token de verificação: o mesmo que você definir abaixo (cada instância pode ter o seu).
              </p>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Phone Number ID</label>
              <input
                value={bizForm.metaPhoneNumberId}
                onChange={(e) => setBizForm({ ...bizForm, metaPhoneNumberId: e.target.value })}
                className="w-full rounded-lg border border-[var(--line-strong)] bg-[var(--surface-2)] px-3 py-2 text-xs font-mono text-zinc-100 outline-none focus:border-sky-500/50"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1">Business / WABA ID</label>
              <input
                value={bizForm.metaBusinessId}
                onChange={(e) => setBizForm({ ...bizForm, metaBusinessId: e.target.value })}
                className="w-full rounded-lg border border-[var(--line-strong)] bg-[var(--surface-2)] px-3 py-2 text-xs font-mono text-zinc-100 outline-none focus:border-sky-500/50"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Access Token permanente
              {configuringInst.business?.hasMetaAccessToken && (
                <span className="text-zinc-500"> — atual: {configuringInst.business.metaAccessTokenMasked}</span>
              )}
            </label>
            <input
              type="password"
              value={bizForm.metaAccessToken}
              onChange={(e) => setBizForm({ ...bizForm, metaAccessToken: e.target.value })}
              placeholder="EAAxxxx…"
              className="w-full rounded-lg border border-[var(--line-strong)] bg-[var(--surface-2)] px-3 py-2 text-xs text-zinc-100 outline-none focus:border-sky-500/50"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1">
              Token de verificação do webhook
              {configuringInst.business?.hasMetaWebhookVerifyToken && (
                <span className="text-zinc-500">
                  {" "}
                  — atual: {configuringInst.business.metaWebhookVerifyTokenMasked}
                </span>
              )}
            </label>
            <input
              type="password"
              value={bizForm.metaWebhookVerifyToken}
              onChange={(e) => setBizForm({ ...bizForm, metaWebhookVerifyToken: e.target.value })}
              placeholder="defina um token e use o mesmo no Meta"
              className="w-full rounded-lg border border-[var(--line-strong)] bg-[var(--surface-2)] px-3 py-2 text-xs text-zinc-100 outline-none focus:border-sky-500/50"
            />
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={() => void saveBusinessConfig(configuring)}
            className="rounded-lg bg-sky-600 px-4 py-2 text-xs font-medium text-white shadow-xs transition-colors hover:bg-sky-500 active:bg-sky-700 disabled:opacity-50"
          >
            Salvar credenciais Meta
          </button>
        </div>
      )}

      {active && (
        <p className="text-center text-xs text-zinc-600">
          Sessão em uso no painel: <span className="text-zinc-400 font-mono">{active}</span>
        </p>
      )}
    </div>
  );
}
