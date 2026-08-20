import { useEffect, useRef, useState } from "react";
import type { Node } from "@xyflow/react";
import { api } from "../../api/client";
import { hotmartWebhookUrl, customWebhookUrl, buildWaMeLink, NODE_LABELS } from "./nodeMeta";
import { TemplateVariablesHelp } from "./TemplateVariablesHelp";
import { EmailBuilder } from "../email/EmailBuilder";

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

type FlatPath = { path: string; value: string; type: string };

type CustomWebhookInfo = {
  ok: boolean;
  url: string;
  paths: FlatPath[];
  sample: unknown;
  sampleAt: string | null;
  suggestions: {
    phonePath: string;
    namePath: string;
    emailPath: string;
    externalIdPath: string;
  };
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
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [allTags, setAllTags] = useState<TagRecord[]>([]);
  const [allFlows, setAllFlows] = useState<FlowRecord[]>([]);
  const [newTagName, setNewTagName] = useState("");
  const [creatingTag, setCreatingTag] = useState(false);
  const [dispatchingTag, setDispatchingTag] = useState(false);
  const [dispatchStatus, setDispatchStatus] = useState("");
  const [webhookInfo, setWebhookInfo] = useState<CustomWebhookInfo | null>(null);
  const [loadingSample, setLoadingSample] = useState(false);
  const [ownerDigits, setOwnerDigits] = useState("");
  const [copiedWaLink, setCopiedWaLink] = useState(false);
  const [waGroups, setWaGroups] = useState<Array<{ id: string; name: string }>>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupSearch, setGroupSearch] = useState("");
  const webhookUrl = flowId
    ? nodeType === "trigger_custom_webhook"
      ? customWebhookUrl(flowId)
      : hotmartWebhookUrl(flowId)
    : "";
  const textRef = useRef<HTMLTextAreaElement>(null);
  const captionRef = useRef<HTMLTextAreaElement>(null);

  function insertVariable(snippet: string, field: "text" | "caption") {
    const el = field === "text" ? textRef.current : captionRef.current;
    const current = String(config[field] ?? "");
    if (el && "selectionStart" in el) {
      const start = el.selectionStart ?? current.length;
      const end = el.selectionEnd ?? current.length;
      const next = current.slice(0, start) + snippet + current.slice(end);
      onUpdate({ [field]: next });
      requestAnimationFrame(() => {
        el.focus();
        const pos = start + snippet.length;
        el.setSelectionRange(pos, pos);
      });
      return;
    }
    onUpdate({ [field]: current + snippet });
  }
  const offerBranches = (config.branches as OfferBranch[] | undefined) ?? [];
  const roundRobinCount = Math.min(4, Math.max(2, Number(config.branchCount) || 2));
  const roundRobinLabels = (config.labels as string[] | undefined) ?? [];
  const selectedTagNames = (config.tagNames as string[] | undefined) ?? [];
  const triggerTags = (config.tags as string[] | undefined) ?? [];

  useEffect(() => {
    if (
      nodeType !== "tag_action" &&
      nodeType !== "trigger_tag" &&
      nodeType !== "condition_contact_tag" &&
      nodeType !== "trigger_wa_link"
    ) {
      return;
    }
    api<{ tags: TagRecord[] }>("/api/tags")
      .then((res) => setAllTags(res.tags ?? []))
      .catch(() => setAllTags([]));
  }, [nodeType]);

  useEffect(() => {
    if (nodeType !== "trigger_wa_link") return;
    let cancelled = false;
    api<{
      ok?: boolean;
      ownerPhone?: string | null;
      profile?: { phone?: string | null } | null;
    }>("/api/inbox/session-profile")
      .then((r) => {
        if (cancelled) return;
        const digits = String(r.ownerPhone ?? r.profile?.phone ?? "").replace(/\D/g, "");
        setOwnerDigits(digits);
      })
      .catch(() => {
        if (!cancelled) setOwnerDigits("");
      });
    return () => {
      cancelled = true;
    };
  }, [nodeType]);

  useEffect(() => {
    if (nodeType !== "start_flow") return;
    api<FlowRecord[]>("/api/flows")
      .then(setAllFlows)
      .catch(() => setAllFlows([]));
  }, [nodeType]);

  useEffect(() => {
    if (nodeType !== "send_groups" && nodeType !== "trigger_groups") return;
    setGroupsLoading(true);
    api<{ groups: Array<{ id: string; name: string }> }>("/api/wpp/groups")
      .then((res) => setWaGroups(res.groups ?? []))
      .catch(() => setWaGroups([]))
      .finally(() => setGroupsLoading(false));
  }, [nodeType]);

  useEffect(() => {
    if (nodeType !== "trigger_custom_webhook" || !flowId) {
      setWebhookInfo(null);
      return;
    }
    let cancelled = false;
    setLoadingSample(true);
    api<CustomWebhookInfo>(`/api/flows/${flowId}/custom-webhook`)
      .then((res) => {
        if (!cancelled) setWebhookInfo(res);
      })
      .catch(() => {
        if (!cancelled) setWebhookInfo(null);
      })
      .finally(() => {
        if (!cancelled) setLoadingSample(false);
      });
    return () => {
      cancelled = true;
    };
  }, [nodeType, flowId]);

  async function refreshWebhookSample() {
    if (!flowId) return;
    setLoadingSample(true);
    try {
      const res = await api<CustomWebhookInfo>(`/api/flows/${flowId}/custom-webhook`);
      setWebhookInfo(res);
    } catch {
      /* ignore */
    } finally {
      setLoadingSample(false);
    }
  }

  const customMapping = (config.mapping as Record<string, string> | undefined) ?? {};

  function patchCustomMapping(patch: Record<string, string>) {
    onUpdate({
      mapping: {
        phonePath: "",
        namePath: "",
        emailPath: "",
        externalIdPath: "",
        ...customMapping,
        ...patch
      }
    });
  }

  function applyWebhookSuggestions() {
    if (!webhookInfo?.suggestions) return;
    const s = webhookInfo.suggestions;
    patchCustomMapping({
      phonePath: customMapping.phonePath || s.phonePath || "",
      namePath: customMapping.namePath || s.namePath || "",
      emailPath: customMapping.emailPath || s.emailPath || "",
      externalIdPath: customMapping.externalIdPath || s.externalIdPath || ""
    });
  }

  function pathPreview(path: string): string {
    if (!path || !webhookInfo?.paths) return "";
    return webhookInfo.paths.find((p) => p.path === path)?.value ?? "";
  }

  function toggleTagName(name: string) {
    const normalized = name.trim();
    if (!normalized) return;
    const next = selectedTagNames.includes(normalized)
      ? selectedTagNames.filter((n) => n !== normalized)
      : [...selectedTagNames, normalized];
    onUpdate({ tagNames: next });
  }

  function toggleTriggerTag(name: string) {
    const normalized = name.trim();
    if (!normalized) return;
    const next = triggerTags.includes(normalized)
      ? triggerTags.filter((n) => n !== normalized)
      : [...triggerTags, normalized];
    onUpdate({ tags: next });
  }

  async function createAndSelectTag(forTrigger = false) {
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
      if (forTrigger) {
        if (!triggerTags.includes(tag.name)) onUpdate({ tags: [...triggerTags, tag.name] });
      } else if (!selectedTagNames.includes(tag.name)) {
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

  function setRoundRobinCount(count: number) {
    const n = Math.min(4, Math.max(2, count));
    const labels = Array.from({ length: n }, (_, i) => roundRobinLabels[i]?.trim() || `Mensagem ${i + 1}`);
    onUpdate({ branchCount: n, labels });
  }

  function patchRoundRobinLabel(index: number, label: string) {
    const labels = Array.from({ length: roundRobinCount }, (_, i) => {
      if (i === index) return label;
      return roundRobinLabels[i]?.trim() || `Mensagem ${i + 1}`;
    });
    onUpdate({ labels });
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
    // Trajettu não manda header — se houver segredo, cola ?secret= na URL.
    const secret =
      nodeType === "trigger_custom_webhook" ? String(config.secret ?? "").trim() : "";
    const toCopy =
      secret && !webhookUrl.includes("secret=")
        ? `${webhookUrl}?secret=${encodeURIComponent(secret)}`
        : webhookUrl;
    try {
      await navigator.clipboard.writeText(toCopy);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  async function copyWebhookSecret() {
    const secret = String(config.secret ?? "");
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopiedSecret(true);
      window.setTimeout(() => setCopiedSecret(false), 2000);
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
          <>
            <TemplateVariablesHelp onInsert={(s) => insertVariable(s, "text")} />
            <label className="text-xs text-zinc-500">Mensagem</label>
            <textarea
              ref={textRef}
              rows={8}
              value={String(config.text ?? "")}
              onChange={(e) => onUpdate({ text: e.target.value })}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-mono text-white"
              placeholder="Olá {{name}}! Seu PIX: {{pixCode}}"
            />
          </>
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
                <TemplateVariablesHelp
                  compact
                  onInsert={(s) => insertVariable(s, "caption")}
                />
                <label className="text-xs text-zinc-500">Legenda</label>
                <textarea
                  ref={captionRef}
                  rows={5}
                  value={String(config.caption ?? "")}
                  onChange={(e) => onUpdate({ caption: e.target.value })}
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-mono text-white resize-y min-h-[88px]"
                  placeholder={"{{name}}\n\nLinha 2 da legenda"}
                />
                <p className="text-[11px] text-zinc-600">Enter cria nova linha na legenda do WhatsApp.</p>
              </>
            )}
          </>
        )}

        {nodeType === "send_groups" && (
          <>
            <p className="text-xs text-zinc-500 leading-relaxed">
              Envia a mesma mensagem para vários grupos, com intervalo seguro entre cada envio
              (anti-ban).
            </p>
            <label className="text-xs text-zinc-500">Tipo de mensagem</label>
            <select
              value={String(config.mediaType ?? "text")}
              onChange={(e) => onUpdate({ mediaType: e.target.value })}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
            >
              <option value="text">Texto</option>
              <option value="image">Imagem</option>
              <option value="video">Vídeo</option>
              <option value="audio">Áudio</option>
            </select>

            {String(config.mediaType ?? "text") === "text" ? (
              <>
                <TemplateVariablesHelp onInsert={(s) => insertVariable(s, "text")} />
                <label className="text-xs text-zinc-500">Mensagem</label>
                <textarea
                  ref={textRef}
                  rows={6}
                  value={String(config.text ?? "")}
                  onChange={(e) => onUpdate({ text: e.target.value })}
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-mono text-white"
                />
              </>
            ) : (
              <>
                <label className="text-xs text-zinc-500">URL do arquivo</label>
                <input
                  value={String(config.url ?? "")}
                  onChange={(e) => onUpdate({ url: e.target.value })}
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-white"
                />
                {String(config.mediaType) !== "audio" && (
                  <>
                    <TemplateVariablesHelp compact onInsert={(s) => insertVariable(s, "caption")} />
                    <label className="text-xs text-zinc-500">Legenda</label>
                    <textarea
                      ref={captionRef}
                      rows={4}
                      value={String(config.caption ?? "")}
                      onChange={(e) => onUpdate({ caption: e.target.value })}
                      className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-mono text-white"
                    />
                  </>
                )}
              </>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs text-zinc-500">Intervalo mín. (seg)</label>
                <input
                  type="number"
                  min={5}
                  max={600}
                  value={Number(config.staggerMinSec ?? 20)}
                  onChange={(e) => onUpdate({ staggerMinSec: Number(e.target.value) || 20 })}
                  className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
                />
              </div>
              <div>
                <label className="text-xs text-zinc-500">Intervalo máx. (seg)</label>
                <input
                  type="number"
                  min={5}
                  max={900}
                  value={Number(config.staggerMaxSec ?? 45)}
                  onChange={(e) => onUpdate({ staggerMaxSec: Number(e.target.value) || 45 })}
                  className="mt-1 w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
                />
              </div>
            </div>

            <label className="text-xs text-zinc-500">Grupos</label>
            <input
              value={groupSearch}
              onChange={(e) => setGroupSearch(e.target.value)}
              placeholder="Buscar grupo…"
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-white"
            />
            {groupsLoading ? (
              <p className="text-xs text-zinc-500">Carregando grupos…</p>
            ) : (
              <div className="max-h-48 space-y-1 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950/50 p-2">
                {waGroups
                  .filter((g) => {
                    const q = groupSearch.trim().toLowerCase();
                    if (!q) return true;
                    return g.name.toLowerCase().includes(q) || g.id.toLowerCase().includes(q);
                  })
                  .map((g) => {
                    const selected = ((config.groupIds as string[] | undefined) ?? []).includes(g.id);
                    return (
                      <label
                        key={g.id}
                        className={`flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-xs ${
                          selected ? "bg-emerald-500/10 text-emerald-200" : "text-zinc-400 hover:bg-zinc-900"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => {
                            const prev = ((config.groupIds as string[] | undefined) ?? []).slice();
                            const labels = {
                              ...((config.groupLabels as Record<string, string> | undefined) ?? {})
                            };
                            if (selected) {
                              onUpdate({
                                groupIds: prev.filter((id) => id !== g.id),
                                groupLabels: Object.fromEntries(
                                  Object.entries(labels).filter(([id]) => id !== g.id)
                                )
                              });
                            } else {
                              labels[g.id] = g.name;
                              onUpdate({ groupIds: [...prev, g.id], groupLabels: labels });
                            }
                          }}
                          className="mt-0.5"
                        />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{g.name}</span>
                          <span className="block truncate font-mono text-[10px] text-zinc-600">
                            {g.id}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                {!waGroups.length && (
                  <p className="px-1 py-2 text-[11px] text-zinc-600">
                    Nenhum grupo encontrado na instância ativa.
                  </p>
                )}
              </div>
            )}
            <p className="text-[11px] text-zinc-600">
              {((config.groupIds as string[] | undefined) ?? []).length} grupo(s) selecionado(s)
            </p>
          </>
        )}

        {nodeType === "send_email" && (
          <>
            <p className="text-xs text-zinc-500 leading-relaxed">
              Envia via Resend. Configure a API em <strong className="text-zinc-400">Configurações → E-mail</strong>.
            </p>
            <label className="text-xs text-zinc-500">Para (destinatário)</label>
            <input
              value={String(config.to ?? "{{email}}")}
              onChange={(e) => onUpdate({ to: e.target.value })}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-mono text-white"
              placeholder="{{email}}"
            />
            <label className="text-xs text-zinc-500">Assunto</label>
            <input
              value={String(config.subject ?? "")}
              onChange={(e) => onUpdate({ subject: e.target.value })}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
            />
            <label className="text-xs text-zinc-500">Reply-To (opcional)</label>
            <input
              value={String(config.replyTo ?? "")}
              onChange={(e) => onUpdate({ replyTo: e.target.value })}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-white"
              placeholder="suporte@seudominio.com"
            />
            <label className="text-xs text-zinc-500">Corpo do e-mail</label>
            <EmailBuilder
              html={String(config.html ?? "")}
              onChange={(html) => onUpdate({ html })}
            />
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

        {nodeType === "trigger_tag" && (
          <>
            <p className="text-xs text-zinc-500 leading-relaxed">
              Dispara automaticamente quando uma dessas tags é <strong className="text-zinc-400">adicionada</strong>{" "}
              ao contato (inbox, bloco Adicionar tag ou outro fluxo).
            </p>
            {triggerTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {triggerTags.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => toggleTriggerTag(name)}
                    className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-300 hover:bg-emerald-500/20"
                  >
                    {name} ×
                  </button>
                ))}
              </div>
            )}
            <label className="text-xs text-zinc-500">Tags que disparam este fluxo</label>
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
                      checked={triggerTags.includes(tag.name)}
                      onChange={() => toggleTriggerTag(tag.name)}
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
                  if (e.key === "Enter") void createAndSelectTag(true);
                }}
                className="min-w-0 flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
                placeholder="Nome da tag"
              />
              <button
                type="button"
                onClick={() => void createAndSelectTag(true)}
                disabled={!newTagName.trim() || creatingTag}
                className="shrink-0 rounded-xl border border-zinc-700 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
              >
                Criar
              </button>
            </div>
          </>
        )}

        {nodeType === "trigger_broadcast" && (
          <>
            <p className="text-xs text-zinc-500 leading-relaxed">
              Disparo em massa para <strong className="text-zinc-400">todos os contatos</strong> cadastrados.
              Não filtra por tag aqui — ligue um bloco{" "}
              <strong className="text-zinc-400">Contato tem tag?</strong> (ou outra condição) depois deste
              gatilho para escolher quem recebe mensagens.
            </p>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 text-xs text-zinc-500 space-y-1">
              <p>Exemplo de fluxo:</p>
              <p className="text-zinc-400 font-mono text-[11px]">
                Broadcast → Contato tem tag? → (sim) Enviar imagem
              </p>
            </div>
            {flowId && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 space-y-2">
                <button
                  type="button"
                  disabled={dispatchingTag}
                  onClick={async () => {
                    if (
                      !window.confirm(
                        "Disparar para TODOS os contatos? Filtros do fluxo serão aplicados para cada um. Envios espaçados automaticamente."
                      )
                    ) {
                      return;
                    }
                    setDispatchingTag(true);
                    setDispatchStatus("");
                    try {
                      const r = await api<{
                        ok: boolean;
                        scheduled?: number;
                        skipped?: number;
                        total?: number;
                        error?: string;
                      }>(`/api/flows/${flowId}/dispatch-broadcast`, {
                        method: "POST",
                        body: JSON.stringify({})
                      });
                      setDispatchStatus(
                        r.ok
                          ? `${r.scheduled ?? 0} de ${r.total ?? 0} na fila · ${r.skipped ?? 0} ignorado(s)`
                          : (r.error ?? "Falha ao disparar")
                      );
                    } catch (e: unknown) {
                      setDispatchStatus(e instanceof Error ? e.message : "Erro ao disparar");
                    } finally {
                      setDispatchingTag(false);
                    }
                  }}
                  className="w-full rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
                >
                  {dispatchingTag ? "Agendando…" : "Disparar broadcast agora"}
                </button>
                {dispatchStatus && (
                  <p className="text-[11px] text-zinc-400">{dispatchStatus}</p>
                )}
              </div>
            )}
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

        {nodeType === "trigger_wa_link" && (
          <>
            <p className="text-xs text-zinc-500">
              Crie um link <code className="text-zinc-400">wa.me</code> com mensagem pronta. Use em
              Instagram, bio, anúncios etc. Quando a pessoa enviar essa mensagem, o Zap aplica as tags
              e dispara este fluxo.
            </p>

            <label className="text-xs text-zinc-500">Mensagem do link *</label>
            <textarea
              value={String(config.message ?? "")}
              onChange={(e) => onUpdate({ message: e.target.value })}
              rows={3}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white resize-y"
              placeholder="Ex.: Olá! Vim pelo Instagram e quero o teste grátis."
            />

            <label className="text-xs text-zinc-500">Tags de origem (aplicadas ao chegar)</label>
            {triggerTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {triggerTags.map((name) => (
                  <button
                    key={name}
                    type="button"
                    onClick={() => toggleTriggerTag(name)}
                    className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-300 hover:bg-emerald-500/20"
                  >
                    {name} ×
                  </button>
                ))}
              </div>
            )}
            <div className="max-h-36 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-900/40 p-2 space-y-1">
              {allTags.length === 0 ? (
                <p className="text-xs text-zinc-600 px-1 py-2">Nenhuma tag ainda — crie abaixo.</p>
              ) : (
                allTags.map((tag) => (
                  <label
                    key={tag.id}
                    className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-zinc-800/60 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={triggerTags.includes(tag.name)}
                      onChange={() => toggleTriggerTag(tag.name)}
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
            <div className="flex gap-2">
              <input
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void createAndSelectTag(true);
                  }
                }}
                placeholder="Nova tag (ex.: Instagram)"
                className="flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
              />
              <button
                type="button"
                disabled={!newTagName.trim() || creatingTag}
                onClick={() => void createAndSelectTag(true)}
                className="rounded-xl border border-zinc-700 px-3 text-[11px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
              >
                {creatingTag ? "…" : "Criar"}
              </button>
            </div>

            <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-3 space-y-2">
              <p className="text-xs font-medium text-sky-300">Link gerado</p>
              {!ownerDigits ? (
                <p className="text-[11px] text-amber-200/90">
                  Número do WhatsApp conectado não encontrado. Conecte a instância em Configurações.
                </p>
              ) : !String(config.message ?? "").trim() ? (
                <p className="text-[11px] text-zinc-500">Escreva a mensagem para gerar o link.</p>
              ) : (
                <>
                  <code className="block break-all text-[11px] text-sky-400 leading-relaxed">
                    {buildWaMeLink(ownerDigits, String(config.message ?? ""))}
                  </code>
                  <button
                    type="button"
                    onClick={async () => {
                      const url = buildWaMeLink(ownerDigits, String(config.message ?? ""));
                      if (!url) return;
                      try {
                        await navigator.clipboard.writeText(url);
                        setCopiedWaLink(true);
                        window.setTimeout(() => setCopiedWaLink(false), 2000);
                      } catch {
                        window.prompt("Copie o link:", url);
                      }
                    }}
                    className="rounded-lg border border-sky-500/40 px-2.5 py-1 text-[11px] text-sky-300 hover:bg-sky-500/10"
                  >
                    {copiedWaLink ? "Copiado!" : "Copiar link"}
                  </button>
                </>
              )}
              <p className="text-[11px] text-zinc-600">
                Salve e ative o fluxo. A pessoa clica no link → envia a mensagem → tags + fluxo disparam.
              </p>
            </div>
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
                  if (e.key === "Enter") void createAndSelectTag(false);
                }}
                className="min-w-0 flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
                placeholder="Nome da tag"
              />
              <button
                type="button"
                onClick={() => void createAndSelectTag(false)}
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

        {(nodeType === "trigger_hotmart" || nodeType === "trigger_hotmart_pending") && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 text-xs text-zinc-400">
            <p className="font-medium text-zinc-300 mb-1">Webhook Hotmart</p>
            <code className="block break-all text-emerald-400 leading-relaxed">{webhookUrl}</code>
            <button
              type="button"
              onClick={() => void copyWebhookUrl()}
              className="mt-2 rounded-lg border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800"
            >
              {copied ? "Copiado!" : "Copiar URL"}
            </button>
            {nodeType === "trigger_hotmart_pending" ? (
              <p className="mt-2 text-amber-200/90">
                Dispara quando o cliente <strong className="font-medium">gera PIX ou boleto</strong> (ex.: evento{" "}
                <code className="text-zinc-400">PURCHASE_BILLET_PRINTED</code>, status{" "}
                <code className="text-zinc-400">BILLET_PRINTED</code>). Ideal para recuperação de carrinho.
              </p>
            ) : (
              <p className="mt-2 text-emerald-400/90">
                Dispara só em <strong className="font-medium">compra aprovada</strong> (ex.:{" "}
                <code className="text-zinc-400">PURCHASE_APPROVED</code>). Não dispara em PIX pendente.
              </p>
            )}
            <p className="mt-2">
              Variáveis: {"{{name}}"}, {"{{phone}}"}, {"{{pixCode}}"}, {"{{pixQrCode}}"}, {"{{offerCode}}"}, etc.
            </p>
            <p className="mt-2 text-zinc-600">
              Na Hotmart, marque o evento de <strong>aguardando pagamento / boleto impresso</strong> ou{" "}
              <strong>compra aprovada</strong> conforme o gatilho deste fluxo.
            </p>
          </div>
        )}

        {nodeType === "trigger_custom_webhook" && (
          <div className="space-y-3">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 text-xs text-zinc-400 space-y-2">
              <p className="font-medium text-zinc-300">URL do webhook</p>
              <code className="block break-all text-sky-400 leading-relaxed">
                {webhookUrl || "Salve o fluxo para gerar a URL"}
              </code>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void copyWebhookUrl()}
                  disabled={!webhookUrl}
                  className="rounded-lg border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
                >
                  {copied ? "Copiado!" : "Copiar URL"}
                </button>
                <button
                  type="button"
                  onClick={() => void refreshWebhookSample()}
                  disabled={!flowId || loadingSample}
                  className="rounded-lg border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-40"
                >
                  {loadingSample ? "Atualizando…" : "Atualizar sample"}
                </button>
              </div>
              <p className="text-zinc-500">
                URL genérica: qualquer plataforma que faça <strong className="text-zinc-400">POST JSON</strong>{" "}
                pode usar. Fluxo: enviar um payload de teste →{" "}
                <strong className="text-zinc-400">Atualizar sample</strong> → mapear nome / telefone / e-mail →
                salvar e ativar.
              </p>
            </div>

            <label className="text-xs text-zinc-500">Segredo (opcional)</label>
            <div className="flex gap-2">
              <input
                value={String(config.secret ?? "")}
                onChange={(e) => onUpdate({ secret: e.target.value })}
                placeholder="opcional"
                className="flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white font-mono"
              />
              <button
                type="button"
                onClick={() => void copyWebhookSecret()}
                className="rounded-xl border border-zinc-700 px-3 text-[11px] text-zinc-300 hover:bg-zinc-800"
              >
                {copiedSecret ? "OK" : "Copiar"}
              </button>
            </div>
            <p className="text-[11px] text-zinc-500">
              Se preenchido, a origem deve enviar header <code>x-webhook-secret</code> ou{" "}
              <code>?secret=</code> na URL (o botão Copiar URL já inclui o secret). Sem segredo, qualquer POST
              na URL é aceito.
            </p>

            {!webhookInfo?.sample ? (
              <div className="rounded-xl border border-dashed border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-100/90">
                {loadingSample
                  ? "Carregando último payload…"
                  : "Ainda sem sample. Envie um POST para a URL acima (pode ser com o fluxo desativado) e clique em Atualizar sample."}
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-zinc-500">
                    Sample recebido
                    {webhookInfo.sampleAt
                      ? ` · ${new Date(webhookInfo.sampleAt).toLocaleString("pt-BR")}`
                      : ""}
                  </p>
                  <button
                    type="button"
                    onClick={applyWebhookSuggestions}
                    className="rounded-lg border border-sky-500/40 px-2.5 py-1 text-[11px] text-sky-300 hover:bg-sky-500/10"
                  >
                    Usar sugestões
                  </button>
                </div>

                {(
                  [
                    { key: "namePath", label: "Nome", required: true },
                    { key: "phonePath", label: "Telefone (WhatsApp)", required: true },
                    { key: "emailPath", label: "E-mail", required: false },
                    { key: "externalIdPath", label: "ID externo (dedup)", required: false }
                  ] as const
                ).map((field) => (
                  <div key={field.key} className="space-y-1">
                    <label className="text-xs text-zinc-500">
                      {field.label}
                      {field.required ? " *" : ""}
                    </label>
                    <select
                      value={String(customMapping[field.key] ?? "")}
                      onChange={(e) => patchCustomMapping({ [field.key]: e.target.value })}
                      className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
                    >
                      <option value="">— selecione o campo do JSON —</option>
                      {(webhookInfo.paths ?? []).map((p) => (
                        <option key={p.path} value={p.path}>
                          {p.path} → {p.value.slice(0, 40)}
                        </option>
                      ))}
                    </select>
                    {customMapping[field.key] ? (
                      <p className="text-[11px] text-emerald-400/90 truncate">
                        Valor: {pathPreview(customMapping[field.key]) || "(vazio no sample)"}
                      </p>
                    ) : null}
                  </div>
                ))}

                <details className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-2 text-[11px] text-zinc-500">
                  <summary className="cursor-pointer text-zinc-400">Ver JSON recebido</summary>
                  <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all text-zinc-500">
                    {JSON.stringify(webhookInfo.sample, null, 2)}
                  </pre>
                </details>
              </>
            )}

            <p className="text-[11px] text-zinc-600">
              Variáveis no fluxo: {"{{name}}"}, {"{{fullName}}"}, {"{{phone}}"}, {"{{email}}"}.
              Salve o fluxo depois de mapear.
            </p>
          </div>
        )}

        {nodeType === "condition_contact_tag" && (
          <>
            <p className="text-xs text-zinc-500">
              Verifica as tags do contato <strong>no momento da execução</strong>. Use após um &quot;Aguardar&quot;
              para não enviar recuperação a quem já recebeu a tag Comprador.
            </p>
            <label className="text-xs text-zinc-500">Condição</label>
            <select
              value={String(config.matchMode ?? "any")}
              onChange={(e) => onUpdate({ matchMode: e.target.value })}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
            >
              <option value="any">Tem alguma destas tags</option>
              <option value="all">Tem todas estas tags</option>
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

            <label className="text-xs text-zinc-500">Tags a verificar</label>
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

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 text-[11px] text-zinc-500 space-y-1">
              <p>
                <span className="text-emerald-400">Saída 1 — Tem a tag:</span> conecte a mensagem de recuperação
              </p>
              <p>
                <span className="text-zinc-400">Saída 2 — Não tem a tag:</span> encerre ou outro caminho (ex. já
                comprou)
              </p>
            </div>
          </>
        )}

        {nodeType === "condition_contact_replied" && (
          <>
            <p className="text-xs text-zinc-500 leading-relaxed">
              Verifica se o contato <strong>enviou alguma mensagem recebida</strong> no WhatsApp (texto, áudio, etc.).
              Ideal após um bloco &quot;Aguardar&quot; para não insistir em quem não respondeu.
            </p>
            <label className="flex items-start gap-2 text-sm text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={config.sinceFlowStart !== false}
                onChange={(e) => onUpdate({ sinceFlowStart: e.target.checked })}
                className="mt-1 rounded"
              />
              <span>
                Contar só respostas <strong>depois que este fluxo começou</strong> (recomendado)
              </span>
            </label>
            <label className="text-xs text-zinc-500">Janela máxima (dias, 0 = sem limite extra)</label>
            <input
              type="number"
              min={0}
              max={365}
              value={Number(config.withinDays ?? 0)}
              onChange={(e) => onUpdate({ withinDays: Math.max(0, Number(e.target.value) || 0) })}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
            />
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 text-[11px] text-zinc-500 space-y-1">
              <p>
                <span className="text-emerald-400">Saída 1 — Respondeu:</span> continue o fluxo de engajamento
              </p>
              <p>
                <span className="text-zinc-400">Saída 2 — Não respondeu:</span> encerre, tag &quot;Silencioso&quot; ou
                inicie outro fluxo leve
              </p>
              <p className="text-zinc-600 pt-1">
                Reações (emoji) só contam se aparecerem como mensagem no inbox.
              </p>
            </div>
          </>
        )}

        {nodeType === "split_round_robin" && (
          <>
            <p className="text-xs text-zinc-500 leading-relaxed">
              Divide o fluxo em <strong>2 a 4 ramos iguais</strong>. A cada novo contato que passar por
              aqui, o sistema escolhe o <strong>próximo ramo</strong> automaticamente (round robin).
              Ideal para alternar textos de boas-vindas e reduzir risco de spam.
            </p>
            <label className="text-xs text-zinc-500">Quantidade de ramos</label>
            <select
              value={roundRobinCount}
              onChange={(e) => setRoundRobinCount(Number(e.target.value))}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
            >
              <option value={2}>2 ramos (A / B)</option>
              <option value={3}>3 ramos (A / B / C)</option>
              <option value={4}>4 ramos (A / B / C / D)</option>
            </select>
            <div className="space-y-3">
              {Array.from({ length: roundRobinCount }, (_, index) => (
                <div
                  key={`rr_${index}`}
                  className="rounded-xl border border-violet-500/25 border-l-[3px] border-l-violet-500 bg-zinc-900/40 p-3 space-y-2"
                >
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-violet-400">
                    Saída {index + 1} · bolinha roxa
                  </div>
                  <label className="text-xs text-zinc-500">Nome desta saída (aparece no bloco)</label>
                  <input
                    value={roundRobinLabels[index]?.trim() || `Mensagem ${index + 1}`}
                    onChange={(e) => patchRoundRobinLabel(index, e.target.value)}
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
                    placeholder={`Ex.: Boas-vindas ${String.fromCharCode(65 + index)}`}
                  />
                  <p className="text-[10px] text-zinc-600">
                    Conecte um bloco de texto (ou sequência) na saída {index + 1} do canvas.
                  </p>
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-3 text-[11px] text-zinc-500">
              Exemplo: contato 1 → saída 1, contato 2 → saída 2, contato 3 → saída 3, contato 4 → saída 1…
            </div>
          </>
        )}

        {nodeType === "trigger_manual" && (
          <p className="text-xs text-zinc-500">
            Use o botão &quot;Testar&quot; na barra superior com um telefone.
          </p>
        )}

        {nodeType === "trigger_groups" && (
          <>
            <p className="text-xs text-zinc-500 leading-relaxed">
              Só escolhe os <strong className="text-zinc-400">grupos de destino</strong>. Depois use
              nós <strong className="text-zinc-400">Aguardar dia</strong> (Segunda, Terça…) e as
              mensagens / atrasos para manhã, tarde e noite.
            </p>

            <label className="text-xs text-zinc-500">Grupos</label>
            <input
              value={groupSearch}
              onChange={(e) => setGroupSearch(e.target.value)}
              placeholder="Buscar grupo…"
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-white"
            />
            {groupsLoading ? (
              <p className="text-xs text-zinc-500">Carregando grupos…</p>
            ) : (
              <div className="max-h-52 space-y-1 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950/50 p-2">
                {waGroups
                  .filter((g) => {
                    const q = groupSearch.trim().toLowerCase();
                    if (!q) return true;
                    return g.name.toLowerCase().includes(q) || g.id.toLowerCase().includes(q);
                  })
                  .map((g) => {
                    const selected = ((config.groupIds as string[] | undefined) ?? []).includes(g.id);
                    return (
                      <label
                        key={g.id}
                        className={`flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-xs ${
                          selected ? "bg-sky-500/10 text-sky-200" : "text-zinc-400 hover:bg-zinc-900"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selected}
                          onChange={() => {
                            const prev = ((config.groupIds as string[] | undefined) ?? []).slice();
                            const labels = {
                              ...((config.groupLabels as Record<string, string> | undefined) ?? {})
                            };
                            if (selected) {
                              onUpdate({
                                groupIds: prev.filter((id) => id !== g.id),
                                groupLabels: Object.fromEntries(
                                  Object.entries(labels).filter(([id]) => id !== g.id)
                                )
                              });
                            } else {
                              labels[g.id] = g.name;
                              onUpdate({ groupIds: [...prev, g.id], groupLabels: labels });
                            }
                          }}
                          className="mt-0.5"
                        />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{g.name}</span>
                          <span className="block truncate font-mono text-[10px] text-zinc-600">
                            {g.id}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                {!waGroups.length && (
                  <p className="px-1 py-2 text-[11px] text-zinc-600">
                    Nenhum grupo encontrado na instância ativa.
                  </p>
                )}
              </div>
            )}
            <p className="text-[11px] text-zinc-600">
              {((config.groupIds as string[] | undefined) ?? []).length} grupo(s) · ao{" "}
              <strong className="text-zinc-400">Publicar</strong> o fluxo inicia sozinho
            </p>
          </>
        )}

        {nodeType === "wait_weekday" && (
          <>
            <p className="text-xs text-zinc-500 leading-relaxed">
              Pausa o fluxo até o próximo <strong className="text-zinc-400">dia + horário</strong>{" "}
              (Brasília). Encaixe um nó por dia (Segunda → mensagens → Terça → …).
            </p>
            <label className="text-xs text-zinc-500">Dia</label>
            <select
              value={Number(config.weekday ?? 1)}
              onChange={(e) => onUpdate({ weekday: Number(e.target.value) })}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
            >
              <option value={1}>Segunda</option>
              <option value={2}>Terça</option>
              <option value={3}>Quarta</option>
              <option value={4}>Quinta</option>
              <option value={5}>Sexta</option>
              <option value={6}>Sábado</option>
              <option value={0}>Domingo</option>
            </select>
            <label className="text-xs text-zinc-500">Horário (Brasília)</label>
            <input
              type="time"
              value={String(config.time ?? "09:00").slice(0, 5)}
              onChange={(e) => onUpdate({ time: e.target.value || "09:00" })}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
            />
            <p className="text-[11px] text-zinc-600">
              Depois deste nó, coloque as mensagens do dia. Use &quot;Aguardar tempo&quot; entre manhã /
              tarde / noite.
            </p>
          </>
        )}

        {nodeType === "condition_weekday" && (
          <div className="space-y-2 text-xs text-amber-200/90 leading-relaxed rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
            <p>
              Este nó saiu da paleta (confundia com &quot;Aguardar dia&quot;). Prefira apagar e usar{" "}
              <strong>Aguardar dia</strong> em sequência: Seg → msgs → Ter → msgs…
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
