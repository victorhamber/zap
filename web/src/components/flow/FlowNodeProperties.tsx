import { useEffect, useState } from "react";
import type { Node } from "@xyflow/react";
import { api } from "../../api/client";
import { hotmartWebhookUrl, NODE_LABELS } from "./nodeMeta";

type Props = {
  selectedNode: Node;
  flowId?: string;
  config: Record<string, unknown>;
  onUpdate: (patch: Record<string, unknown>) => void;
  onClose: () => void;
};

type OfferBranch = {
  id: string;
  label: string;
  codes: string[];
  /** Texto bruto do input — permite digitar vírgulas entre códigos. */
  codesText?: string;
};

function offerCodesInputValue(branch: OfferBranch): string {
  if (typeof branch.codesText === "string") return branch.codesText;
  return branch.codes.join(", ");
}

function parseOfferCodes(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

type TagRecord = {
  id: string;
  name: string;
  color: string;
};

type FlowRecord = {
  id: string;
  name: string;
  enabled: boolean;
};

export function FlowNodeProperties({
  selectedNode,
  flowId,
  config,
  onUpdate,
  onClose
}: Props) {
  const nodeType = String(selectedNode.data.nodeType);
  const [copied, setCopied] = useState(false);
  const [allTags, setAllTags] = useState<TagRecord[]>([]);
  const [allFlows, setAllFlows] = useState<FlowRecord[]>([]);
  const [newTagName, setNewTagName] = useState("");
  const [creatingTag, setCreatingTag] = useState(false);
  const webhookUrl = flowId ? hotmartWebhookUrl(flowId) : "";
  const offerBranches = (config.branches as OfferBranch[] | undefined) ?? [];
  const selectedTagNames = (config.tagNames as string[] | undefined) ?? [];

  useEffect(() => {
    if (nodeType !== "tag_action") return;
    api<{ tags: TagRecord[] }>("/api/tags")
      .then((res) => setAllTags(res.tags ?? []))
      .catch(() => setAllTags([]));
  }, [nodeType]);

  useEffect(() => {
    if (nodeType !== "start_flow") return;
    api<FlowRecord[]>("/api/flows")
      .then(setAllFlows)
      .catch(() => setAllFlows([]));
  }, [nodeType]);

  function toggleTagName(name: string) {
    const normalized = name.trim();
    if (!normalized) return;
    const next = selectedTagNames.includes(normalized)
      ? selectedTagNames.filter((n) => n !== normalized)
      : [...selectedTagNames, normalized];
    onUpdate({ tagNames: next });
  }

  async function createAndSelectTag() {
    const name = newTagName.trim();
    if (!name || creatingTag) return;
    setCreatingTag(true);
    try {
      const res = await api<{ tag: TagRecord }>("/api/tags", {
        method: "POST",
        body: JSON.stringify({ name })
      });
      const tag = res.tag ?? ({ id: `local_${Date.now()}`, name, color: "#25D366" } as TagRecord);
      setAllTags((prev) => {
        if (prev.some((t) => t.name === tag.name)) return prev;
        return [...prev, tag].sort((a, b) => a.name.localeCompare(b.name));
      });
      if (!selectedTagNames.includes(tag.name)) {
        onUpdate({ tagNames: [...selectedTagNames, tag.name] });
      }
      setNewTagName("");
    } finally {
      setCreatingTag(false);
    }
  }

  function updateOfferBranches(next: OfferBranch[]) {
    onUpdate({ branches: next });
  }

  function addOfferBranch() {
    updateOfferBranches([
      ...offerBranches,
      {
        id: `branch_${Date.now()}`,
        label: `Oferta ${offerBranches.length + 1}`,
        codes: []
      }
    ]);
  }

  function removeOfferBranch(branchId: string) {
    updateOfferBranches(offerBranches.filter((b) => b.id !== branchId));
  }

  function patchOfferBranch(branchId: string, patch: Partial<OfferBranch>) {
    updateOfferBranches(
      offerBranches.map((b) => (b.id === branchId ? { ...b, ...patch } : b))
    );
  }

  async function copyWebhookUrl() {
    if (!webhookUrl) return;
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-white">Propriedades</div>
          <div className="text-xs text-zinc-500">{NODE_LABELS[nodeType] ?? nodeType}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-2 py-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          aria-label="Fechar"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 text-sm">
        {nodeType === "send_text" && (
          <textarea
            rows={8}
            value={String(config.text ?? "")}
            onChange={(e) => onUpdate({ text: e.target.value })}
            className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-mono text-white"
            placeholder="Use {{name}}, {{phone}}, etc."
          />
        )}

        {(nodeType === "send_image" || nodeType === "send_video" || nodeType === "send_audio") && (
          <>
            <label className="text-xs text-zinc-500">URL do arquivo</label>
            <input
              value={String(config.url ?? "")}
              onChange={(e) => onUpdate({ url: e.target.value })}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-white"
            />
            {nodeType !== "send_audio" && (
              <>
                <label className="text-xs text-zinc-500">Legenda</label>
                <input
                  value={String(config.caption ?? "")}
                  onChange={(e) => onUpdate({ caption: e.target.value })}
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-white"
                />
              </>
            )}
          </>
        )}

        {nodeType === "delay" && (
          <>
            <label className="text-xs text-zinc-500">Valor</label>
            <input
              type="number"
              min={0}
              value={Number(config.value ?? 1)}
              onChange={(e) => onUpdate({ value: Number(e.target.value) })}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
            />
            <label className="text-xs text-zinc-500">Unidade</label>
            <select
              value={String(config.unit ?? "days")}
              onChange={(e) => onUpdate({ unit: e.target.value })}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
            >
              <option value="minutes">Minutos</option>
              <option value="hours">Horas</option>
              <option value="days">Dias</option>
            </select>
          </>
        )}

        {nodeType === "schedule_at" && (
          <>
            <label className="text-xs text-zinc-500">Data e hora</label>
            <input
              type="datetime-local"
              value={String(config.datetime ?? "").slice(0, 16)}
              onChange={(e) => onUpdate({ datetime: e.target.value })}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
            />
          </>
        )}

        {nodeType === "trigger_inbound" && (
          <>
            <label className="text-xs text-zinc-500">Palavra-chave (opcional)</label>
            <input
              value={String(config.keyword ?? "")}
              onChange={(e) => onUpdate({ keyword: e.target.value })}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
              placeholder="Vazio = qualquer mensagem"
            />
            <label className="text-xs text-zinc-500 mt-2 block">Tags do contato (opcional)</label>
            <input
              value={
                Array.isArray(config.tags)
                  ? (config.tags as string[]).join(", ")
                  : String(config.tags ?? "")
              }
              onChange={(e) =>
                onUpdate({
                  tags: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean)
                })
              }
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
              placeholder="ex: cliente-vip, lead-quente"
            />
            <p className="text-xs text-zinc-600 mt-1">
              O fluxo só dispara se o contato tiver uma dessas tags (além da palavra-chave, se
              houver).
            </p>
          </>
        )}

        {nodeType === "condition_offer_code" && (
          <>
            <p className="text-xs text-zinc-500">
              Compara o código da oferta Hotmart (<code className="text-zinc-600">purchase.offer.code</code>)
              e segue pela saída correspondente. Use a saída <span className="text-zinc-400">Outros</span>{" "}
              para códigos não listados. Opcional: ligue direto do gatilho Hotmart para enviar a todos.
            </p>
            <p className="text-xs text-zinc-600">
              Variáveis: {"{{offerCode}}"}, {"{{offerName}}"} · Cada linha no bloco = uma saída (bolinha verde).
              A saída <span className="text-zinc-400">Outros</span> (cinza) cobre códigos fora das listas.
            </p>
            <div className="space-y-3">
              {offerBranches.map((branch, index) => (
                <div
                  key={branch.id}
                  className="rounded-xl border border-emerald-500/25 border-l-[3px] border-l-emerald-500 bg-zinc-900/40 p-3 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-400">
                        Saída {index + 1} · bolinha verde
                      </div>
                      <div className="text-[10px] text-zinc-600 mt-0.5">
                        No canvas, conecte esta oferta na linha &quot;Saída {index + 1}&quot;
                      </div>
                    </div>
                    {offerBranches.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeOfferBranch(branch.id)}
                        className="text-[11px] text-red-400 hover:text-red-300 shrink-0"
                      >
                        Remover
                      </button>
                    )}
                  </div>
                  <label className="text-xs text-zinc-500">Nome desta saída (aparece no bloco)</label>
                  <input
                    value={branch.label}
                    onChange={(e) => patchOfferBranch(branch.id, { label: e.target.value })}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
                    placeholder="Ex.: Teste Pago"
                  />
                  <label className="text-xs text-zinc-500">Códigos da oferta</label>
                  <input
                    value={offerCodesInputValue(branch)}
                    onChange={(e) => {
                      const raw = e.target.value;
                      patchOfferBranch(branch.id, {
                        codesText: raw,
                        codes: parseOfferCodes(raw)
                      });
                    }}
                    onBlur={() => {
                      const parsed = parseOfferCodes(offerCodesInputValue(branch));
                      patchOfferBranch(branch.id, {
                        codes: parsed,
                        codesText: parsed.join(", ")
                      });
                    }}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm font-mono text-white"
                    placeholder="f7x5lf5w, promo2024"
                  />
                  <p className="text-[10px] text-zinc-600">
                    Vários códigos na mesma saída: separe com vírgula.
                  </p>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addOfferBranch}
              className="w-full rounded-lg border border-dashed border-zinc-700 px-3 py-2 text-sm text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
            >
              + Adicionar oferta (nova saída numerada)
            </button>
            <div className="rounded-xl border border-zinc-700 border-l-[3px] border-l-zinc-500 bg-zinc-900/30 px-3 py-2 text-xs text-zinc-500">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                Saída {offerBranches.length + 1} · bolinha cinza · Outros
              </div>
              <p className="mt-1">
                Sempre existe no bloco, sem configurar aqui. Conecte na linha &quot;Saída{" "}
                {offerBranches.length + 1} — Outros&quot; para compras com código fora das listas.
              </p>
            </div>
          </>
        )}

        {nodeType === "tag_action" && (
          <>
            <p className="text-xs text-zinc-500">
              Aplica tags ao contato do fluxo (mesmas tags do inbox). Tags inexistentes são criadas
              automaticamente na execução.
            </p>
            <label className="text-xs text-zinc-500">Ação</label>
            <select
              value={String(config.mode ?? "add")}
              onChange={(e) => onUpdate({ mode: e.target.value })}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
            >
              <option value="add">Adicionar tags</option>
              <option value="remove">Remover tags</option>
            </select>

            {selectedTagNames.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {selectedTagNames.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => toggleTagName(name)}
                    className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-300 hover:bg-emerald-500/20"
                  >
                    {name} ×
                  </button>
                ))}
              </div>
            )}

            <label className="text-xs text-zinc-500">Tags existentes</label>
            <div className="max-h-40 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-900/40 p-2 space-y-1">
              {allTags.length === 0 ? (
                <p className="text-xs text-zinc-600 px-1 py-2">Nenhuma tag criada ainda.</p>
              ) : (
                allTags.map((tag) => (
                  <label
                    key={tag.id}
                    className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-zinc-800/60 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedTagNames.includes(tag.name)}
                      onChange={() => toggleTagName(tag.name)}
                      className="rounded"
                    />
                    <span
                      className="h-2.5 w-2.5 rounded-full shrink-0"
                      style={{ backgroundColor: tag.color }}
                    />
                    <span className="text-sm text-zinc-200">{tag.name}</span>
                  </label>
                ))
              )}
            </div>

            <label className="text-xs text-zinc-500">Criar nova tag</label>
            <div className="flex gap-2">
              <input
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void createAndSelectTag();
                }}
                className="min-w-0 flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
                placeholder="Nome da tag"
              />
              <button
                type="button"
                onClick={() => void createAndSelectTag()}
                disabled={!newTagName.trim() || creatingTag}
                className="shrink-0 rounded-xl border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
              >
                Criar
              </button>
            </div>
          </>
        )}

        {nodeType === "start_flow" && (
          <>
            <p className="text-xs text-zinc-500">
              Inicia outro fluxo para o mesmo contato, herdando as variáveis atuais (nome, telefone,
              oferta, etc.). Coloque no final do fluxo para encadear automações.
            </p>
            <label className="text-xs text-zinc-500">Fluxo destino</label>
            <select
              value={String(config.targetFlowId ?? "")}
              onChange={(e) => {
                const targetFlowId = e.target.value;
                const picked = allFlows.find((f) => f.id === targetFlowId);
                onUpdate({
                  targetFlowId,
                  targetFlowName: picked?.name ?? ""
                });
              }}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
            >
              <option value="">Selecione um fluxo</option>
              {allFlows
                .filter((f) => f.id !== flowId)
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                    {!f.enabled ? " (inativo)" : ""}
                  </option>
                ))}
            </select>
            <p className="text-xs text-zinc-600">
              O fluxo destino precisa estar ativo. O fluxo atual continua após este bloco, se houver
              próximo passo conectado.
            </p>
          </>
        )}

        {nodeType === "trigger_hotmart" && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 text-xs text-zinc-400">
            <p className="font-medium text-zinc-300 mb-1">Webhook Hotmart</p>
            <code className="block break-all text-emerald-400/90 leading-relaxed">{webhookUrl}</code>
            <button
              type="button"
              onClick={() => void copyWebhookUrl()}
              className="mt-2 rounded-lg border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800"
            >
              {copied ? "Copiado!" : "Copiar URL"}
            </button>
            <p className="mt-2">Variáveis: {"{{name}}"}, {"{{phone}}"}, {"{{email}}"}, {"{{productName}}"}, {"{{purchaseId}}"}, {"{{offerCode}}"}, {"{{offerName}}"}, etc.</p>
            <p className="mt-2 text-zinc-600">
              Hotmart v2: país em <code className="text-zinc-500">data.purchase.checkout_country.iso</code> (DDI automático),
              DDD em <code className="text-zinc-500">data.buyer.checkout_phone_code</code>, número em{" "}
              <code className="text-zinc-500">data.buyer.checkout_phone</code>, compra em{" "}
              <code className="text-zinc-500">data.purchase.transaction</code>.
            </p>
          </div>
        )}

        {nodeType === "trigger_manual" && (
          <p className="text-xs text-zinc-500">
            Use o botão &quot;Testar&quot; na barra superior com um telefone.
          </p>
        )}
      </div>
    </div>
  );
}
