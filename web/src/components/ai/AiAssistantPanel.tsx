import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api, downloadApiFile } from "../../api/client";

type Tag = { id: string; name: string; color: string };

type OfficialLink = { trigger: string; url: string; label: string };

type MediaResponseKind = "text" | "image" | "video" | "audio" | "document";

type AiMediaResponse = {
  id: string;
  label: string;
  triggers: string[];
  text: string;
  kind: MediaResponseKind;
  mediaUrl: string;
  filename: string;
  enabled: boolean;
};

type AiSettings = {
  enabled: boolean;
  learnEnabled: boolean;
  autoReplyEnabled: boolean;
  learnTagIds: string[];
  replyTagIds: string[];
  learnText: boolean;
  learnImage: boolean;
  learnAudio: boolean;
  learnVideo: boolean;
  replyText: boolean;
  replyImage: boolean;
  replyAudio: boolean;
  replyVideo: boolean;
  productContext: string;
  officialFacts: string;
  rulesAllowed: string;
  rulesForbidden: string;
  officialLinks: OfficialLink[];
  mediaResponses: AiMediaResponse[];
  openaiApiKeyMasked: string | null;
  modelChat?: string;
  hasOpenaiApiKey: boolean;
  encryptionReady?: boolean;
  replyDelaySec: number;
  humanIdleSec: number;
  maxDailyReplies: number;
};

type KnowledgeItem = {
  id: string;
  kind: string;
  topic: string | null;
  content: string;
  modality: string;
  createdAt: string;
};

type AiEvent = {
  id: string;
  event: string;
  detail: string | null;
  chatId: string | null;
  createdAt: string;
};

type AiStats = {
  knowledgeItems: number;
  messagesLearned: number;
  byKind: { question: number; answer: number; qa_pair: number; other: number };
  learnedEvents: number;
  repliesToday: number;
  errorsRecent: number;
  queuePending: number;
  queueActive: number;
  lastBackfill: { at: string; detail: string } | null;
};

export function AiAssistantPanel() {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showTagModal, setShowTagModal] = useState(false);
  const [pendingLearn, setPendingLearn] = useState(false);
  const [pendingReply, setPendingReply] = useState(false);
  const [knowledge, setKnowledge] = useState<KnowledgeItem[]>([]);
  const [knowledgeTotal, setKnowledgeTotal] = useState(0);
  const [stats, setStats] = useState<AiStats | null>(null);
  const [events, setEvents] = useState<AiEvent[]>([]);
  const [testInput, setTestInput] = useState("");
  const [testReply, setTestReply] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [watchingBackfill, setWatchingBackfill] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const savedFormRef = useRef<Pick<
    AiSettings,
    | "productContext"
    | "officialFacts"
    | "rulesAllowed"
    | "rulesForbidden"
    | "officialLinks"
    | "mediaResponses"
    | "replyDelaySec"
    | "humanIdleSec"
  > | null>(null);

  function syncSavedFormRef(s: AiSettings) {
    savedFormRef.current = {
      productContext: s.productContext,
      officialFacts: s.officialFacts,
      rulesAllowed: s.rulesAllowed,
      rulesForbidden: s.rulesForbidden,
      officialLinks: s.officialLinks,
      mediaResponses: s.mediaResponses,
      replyDelaySec: s.replyDelaySec,
      humanIdleSec: s.humanIdleSec
    };
  }

  function isFormDirty(): boolean {
    if (!settings || !savedFormRef.current) return false;
    const b = savedFormRef.current;
    return (
      settings.productContext !== b.productContext ||
      settings.officialFacts !== b.officialFacts ||
      settings.rulesAllowed !== b.rulesAllowed ||
      settings.rulesForbidden !== b.rulesForbidden ||
      settings.replyDelaySec !== b.replyDelaySec ||
      settings.humanIdleSec !== b.humanIdleSec ||
      JSON.stringify(settings.officialLinks) !== JSON.stringify(b.officialLinks) ||
      JSON.stringify(settings.mediaResponses) !== JSON.stringify(b.mediaResponses)
    );
  }

  function discardFormChanges() {
    if (!settings || !savedFormRef.current) return;
    const b = savedFormRef.current;
    setSettings({
      ...settings,
      productContext: b.productContext,
      officialFacts: b.officialFacts,
      rulesAllowed: b.rulesAllowed,
      rulesForbidden: b.rulesForbidden,
      officialLinks: b.officialLinks,
      mediaResponses: b.mediaResponses,
      replyDelaySec: b.replyDelaySec,
      humanIdleSec: b.humanIdleSec
    });
    showMessage("Alterações descartadas.");
  }

  async function saveFormFields() {
    if (!settings) return;
    await save({
      productContext: settings.productContext,
      officialFacts: settings.officialFacts,
      rulesAllowed: settings.rulesAllowed,
      rulesForbidden: settings.rulesForbidden,
      officialLinks: settings.officialLinks,
      mediaResponses: settings.mediaResponses,
      replyDelaySec: settings.replyDelaySec,
      humanIdleSec: settings.humanIdleSec
    });
  }

  /* ---- Respostas com mídia ---- */

  function patchMediaResponses(list: AiMediaResponse[]) {
    setSettings((s) => (s ? { ...s, mediaResponses: list } : s));
  }

  function updateMediaResponse(index: number, patch: Partial<AiMediaResponse>) {
    if (!settings) return;
    const next = settings.mediaResponses.map((r, i) => (i === index ? { ...r, ...patch } : r));
    patchMediaResponses(next);
  }

  function addMediaResponse() {
    if (!settings) return;
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `mr_${Date.now()}`;
    patchMediaResponses([
      ...settings.mediaResponses,
      { id, label: "", triggers: [], text: "", kind: "text", mediaUrl: "", filename: "", enabled: true }
    ]);
  }

  function removeMediaResponse(index: number) {
    if (!settings) return;
    patchMediaResponses(settings.mediaResponses.filter((_, i) => i !== index));
  }

  function kindFromMime(mime: string): MediaResponseKind {
    if (mime.startsWith("image/")) return "image";
    if (mime.startsWith("video/")) return "video";
    if (mime.startsWith("audio/")) return "audio";
    return "document";
  }

  async function uploadMediaFor(index: number, file: File) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    try {
      const r = await api<{ ok: boolean; url?: string; message?: string }>(
        "/api/inbox/upload",
        { method: "POST", body: JSON.stringify({ data: dataUrl, mime: file.type }) }
      );
      if (!r.url) throw new Error(r.message ?? "Falha no upload");
      updateMediaResponse(index, {
        kind: kindFromMime(file.type),
        mediaUrl: r.url,
        filename: file.name
      });
    } catch (e) {
      showMessage(e instanceof Error ? e.message : "Falha ao enviar arquivo", true);
    }
  }

  const refreshProgress = useCallback(async () => {
    const [k, e, st] = await Promise.all([
      api<{ items: KnowledgeItem[]; total: number }>("/api/ai/knowledge?limit=20"),
      api<{ items: AiEvent[] }>("/api/ai/events?limit=30"),
      api<AiStats>("/api/ai/stats")
    ]);
    setKnowledge(k.items);
    setKnowledgeTotal(k.total);
    setEvents(e.items);
    setStats(st);
    if (st.queuePending === 0 && st.queueActive === 0 && st.messagesLearned > 0) {
      setWatchingBackfill(false);
    }
    return k.total;
  }, []);

  const load = useCallback(async () => {
    const [s, t] = await Promise.all([
      api<AiSettings>("/api/ai/settings"),
      api<{ tags: Tag[] }>("/api/tags")
    ]);
    setSettings({
      ...s,
      mediaResponses: Array.isArray(s.mediaResponses) ? s.mediaResponses : [],
      officialFacts: s.officialFacts ?? "",
      rulesAllowed: s.rulesAllowed ?? ""
    });
    syncSavedFormRef({
      ...s,
      mediaResponses: Array.isArray(s.mediaResponses) ? s.mediaResponses : [],
      officialFacts: s.officialFacts ?? "",
      rulesAllowed: s.rulesAllowed ?? ""
    });
    setTags(t.tags);
    await refreshProgress();
  }, [refreshProgress]);

  useEffect(() => {
    if (!watchingBackfill && !(stats && stats.queuePending > 0)) return;
    const id = window.setInterval(() => {
      refreshProgress().catch(() => {});
    }, 15000);
    return () => window.clearInterval(id);
  }, [watchingBackfill, stats?.queuePending, refreshProgress]);

  useEffect(() => {
    load().catch((err) =>
      showMessage(err instanceof Error ? err.message : String(err), true)
    );
  }, [load]);

  function showMessage(text: string, isError = false) {
    setMessage(text);
    setMessageIsError(isError);
  }

  async function save(partial: Partial<AiSettings> & { openaiApiKey?: string; clearOpenaiApiKey?: boolean }) {
    if (!settings) return;
    setSaving(true);
    setMessage(null);
    setMessageIsError(false);
    try {
      const body: Record<string, unknown> =
        partial.openaiApiKey !== undefined || partial.clearOpenaiApiKey
          ? { ...partial }
          : { ...settings, ...partial };
      const updated = await api<AiSettings>("/api/ai/settings", {
        method: "PUT",
        body: JSON.stringify(body)
      });
      setSettings(updated);
      syncSavedFormRef(updated);
      if (partial.openaiApiKey) setApiKeyInput("");
      showMessage(
        partial.openaiApiKey ? "Chave OpenAI salva." : "Configurações salvas."
      );
    } catch (err) {
      showMessage(err instanceof Error ? err.message : String(err), true);
    } finally {
      setSaving(false);
    }
  }

  async function clearKnowledge() {
    if (!confirm("Limpar toda a memória de aprendizado desta instância?")) return;
    await api("/api/ai/knowledge", { method: "DELETE" });
    setKnowledge([]);
    setMessage("Memória limpa.");
  }

  async function downloadKnowledge(format: "json" | "csv") {
    const ext = format === "csv" ? "csv" : "json";
    await downloadApiFile(
      `/api/ai/knowledge/export?format=${format}`,
      `aprendizagem.${ext}`
    );
    setMessage(`Aprendizagem baixada (${ext.toUpperCase()}).`);
  }

  async function extractFromHistory() {
    if (!requireApiKey("extrair do histórico")) return;
    if (!settings?.learnEnabled) {
      setMessage("Ative o aprendizado por tags antes de extrair do histórico.");
      return;
    }
    if (!settings.learnTagIds.length) {
      setMessage("Selecione ao menos uma tag para o aprendizado.");
      return;
    }
    if (
      !confirm(
        "Extrair aprendizagem das conversas antigas do CRM?\n\n" +
          "• Apenas contatos com as tags selecionadas\n" +
          "• Perguntas do cliente + suas respostas (manual/celular)\n" +
          "• Ignora fluxos automáticos e respostas da IA\n" +
          "• Pode consumir créditos OpenAI — o worker processa em fila\n\n" +
          "Continuar?"
      )
    ) {
      return;
    }

    setBackfilling(true);
    setMessage(null);
    try {
      const result = await api<{
        ok: boolean;
        queued: number;
        skipped: number;
        chats: number;
        scanned: number;
        session: string;
      }>("/api/ai/knowledge/backfill", {
        method: "POST",
        body: JSON.stringify({})
      });

      const k = await refreshProgress();
      setWatchingBackfill(result.queued > 0);
      showMessage(
        `Histórico enfileirado: ${result.queued} mensagens em ${result.chats} chats (${result.skipped} ignoradas). ` +
          `Itens aprendidos no banco: ${k}. O worker processa em background — atualize em ~1 min ou aguarde o painel atualizar sozinho. ` +
          `Veja eventos "learned" no log abaixo.`
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBackfilling(false);
    }
  }

  async function uploadKnowledgeFile(file: File) {
    const name = file.name.toLowerCase();
    const format: "json" | "csv" = name.endsWith(".csv") ? "csv" : "json";

    const replace = confirm(
      "Como deseja importar?\n\nOK = substituir toda a memória desta instância\nCancelar = mesclar (ignorar duplicados)"
    )
      ? "replace"
      : "merge";

    if (
      replace === "replace" &&
      !confirm("Isso apaga a memória atual desta instância antes de importar. Continuar?")
    ) {
      return;
    }

    setImporting(true);
    setMessage(null);
    try {
      const content = await file.text();
      const result = await api<{
        ok: boolean;
        imported: number;
        skipped: number;
        total: number;
        session: string;
      }>("/api/ai/knowledge/import", {
        method: "POST",
        body: JSON.stringify({ content, format, mode: replace })
      });

      const k = await api<{ items: KnowledgeItem[] }>("/api/ai/knowledge?limit=20");
      setKnowledge(k.items);
      setMessage(
        `Importado na instância "${result.session}": ${result.imported} itens (${result.skipped} ignorados).`
      );
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }

  async function runTestReply() {
    setTestReply(null);
    const r = await api<{
      reply: string;
      blocked?: string;
      knowledgeUsed?: number;
      mediaMatched?: { id: string; label: string; kind: string };
    }>("/api/ai/test-reply", {
      method: "POST",
      body: JSON.stringify({ inboundText: testInput })
    });
    const parts: string[] = [];
    if (typeof r.knowledgeUsed === "number") {
      parts.push(`[${r.knowledgeUsed} item(ns) do aprendizado histórico]`);
    }
    if (r.mediaMatched) {
      parts.push(
        `[Resposta com mídia: ${r.mediaMatched.label} · ${r.mediaMatched.kind}]`
      );
    }
    const prefix = parts.length > 0 ? `${parts.join("\n")}\n\n` : "";
    if (r.blocked) {
      setTestReply(`${prefix}Bloqueado: ${r.blocked}\n\n${r.reply}`);
    } else {
      setTestReply(`${prefix}${r.reply}`);
    }
  }

  function toggleLearn(enabled: boolean) {
    if (enabled && !requireApiKey("ativar o aprendizado")) return;
    if (enabled && (!settings?.learnTagIds.length)) {
      setPendingLearn(true);
      setPendingReply(false);
      setShowTagModal(true);
      return;
    }
    void save({ learnEnabled: enabled });
  }

  function toggleAutoReply(enabled: boolean) {
    if (enabled && !requireApiKey("ativar a auto-resposta")) return;
    if (enabled && (!settings?.replyTagIds?.length)) {
      setPendingReply(true);
      setPendingLearn(false);
      setShowTagModal(true);
      return;
    }
    void save({ autoReplyEnabled: enabled });
  }

  function requireApiKey(action: string): boolean {
    if (settings?.hasOpenaiApiKey) return true;
    setMessage(`Salve a chave OpenAI desta instância antes de ${action}.`);
    return false;
  }

  function confirmTags(selection: { learnTagIds: string[]; replyTagIds: string[] }) {
    if (pendingLearn && selection.learnTagIds.length === 0) {
      setMessage("Para ativar o aprendizado, marque ao menos uma tag em Aprendizado.");
      return;
    }
    if (pendingReply && selection.replyTagIds.length === 0) {
      setMessage("Para ativar a auto-resposta, marque ao menos uma tag em Auto-resposta.");
      return;
    }

    const learnOn = Boolean(pendingLearn || settings?.learnEnabled);
    const replyOn = Boolean(pendingReply || settings?.autoReplyEnabled);

    if (learnOn && selection.learnTagIds.length === 0) {
      setMessage("Desative o Aprendizado antes de remover todas as tags de aprendizado.");
      return;
    }
    if (replyOn && selection.replyTagIds.length === 0) {
      setMessage("Desative a Auto-resposta antes de remover todas as tags de auto-resposta.");
      return;
    }

    setShowTagModal(false);
    void save({
      learnTagIds: selection.learnTagIds,
      replyTagIds: selection.replyTagIds,
      learnEnabled: learnOn,
      autoReplyEnabled: replyOn
    });
    setPendingLearn(false);
    setPendingReply(false);
  }

  if (!settings) {
    return <p className="text-sm text-zinc-500">Carregando assistente…</p>;
  }

  const formDirty = isFormDirty();

  return (
    <div className="space-y-8">
      {formDirty && (
        <div className="sticky top-2 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-950/40 px-4 py-3 shadow-lg">
          <p className="text-sm text-amber-100/90">Você tem alterações não salvas.</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="px-4 py-2 rounded-lg border border-zinc-600 text-zinc-300 text-sm hover:bg-zinc-900"
              disabled={saving}
              onClick={discardFormChanges}
            >
              Descartar
            </button>
            <button
              type="button"
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-500 disabled:opacity-50"
              disabled={saving}
              onClick={() => void saveFormFields()}
            >
              {saving ? "Salvando…" : "Salvar alterações"}
            </button>
          </div>
        </div>
      )}
      {message && (
        <p
          className={`text-sm rounded-lg px-3 py-2 border ${
            messageIsError
              ? "text-red-300/95 bg-red-500/10 border-red-500/25"
              : "text-emerald-300/90 bg-emerald-500/10 border-emerald-500/20"
          }`}
        >
          {message}
        </p>
      )}

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-5 space-y-3">
        <h3 className="font-medium text-white">Chave OpenAI (por instância)</h3>
        <p className="text-sm text-zinc-400 leading-relaxed">
          Cole aqui a chave OpenAI desta instância — cada usuário usa a sua. Ela fica criptografada no
          banco e não é compartilhada entre instâncias. Não precisa configurar nada no EasyPanel além do
          login do Zap.
        </p>
        <p className="text-sm text-zinc-300">
          Modelo do atendimento: <span className="font-medium text-white">{settings.modelChat || "gpt-4o"}</span>
        </p>
        <p className="text-sm text-zinc-500">
          Chave atual:{" "}
          {settings.openaiApiKeyMasked ?? (
            <span className="text-amber-400/90">não configurada — obrigatória para usar o assistente</span>
          )}
        </p>
        <div className="flex gap-2">
          <input
            type="password"
            placeholder="sk-… (chave OpenAI desta instância)"
            className="flex-1 rounded bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100"
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
          />
          <button
            type="button"
            className="px-3 py-2 rounded-lg bg-emerald-600 text-white text-sm disabled:opacity-50"
            disabled={!apiKeyInput.trim() || saving}
            onClick={() => void save({ openaiApiKey: apiKeyInput })}
          >
            Salvar chave
          </button>
          {settings.hasOpenaiApiKey && (
            <button
              type="button"
              className="px-3 py-2 rounded-lg border border-zinc-600 text-zinc-300 text-sm"
              onClick={() => void save({ clearOpenaiApiKey: true })}
            >
              Remover
            </button>
          )}
        </div>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-5 space-y-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-medium text-white">Assistente IA</h2>
            <p className="text-sm text-zinc-400 mt-1">
              Aprendizado e respostas automáticas escopados à instância WhatsApp ativa — cada função
              pode ser ligada ou desligada de forma independente.
            </p>
          </div>
          <div className="flex flex-wrap gap-4 shrink-0">
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={settings.learnEnabled}
                onChange={(e) => toggleLearn(e.target.checked)}
              />
              Aprendizado
            </label>
            <label className="flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={settings.autoReplyEnabled}
                onChange={(e) => toggleAutoReply(e.target.checked)}
              />
              Auto-resposta
            </label>
          </div>
        </div>

        {stats && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium text-zinc-200">Progresso desta instância</h3>
              <button
                type="button"
                className="text-xs text-zinc-500 hover:text-zinc-300"
                onClick={() =>
                  void refreshProgress()
                    .then(() => showMessage("Estatísticas atualizadas."))
                    .catch((e) => showMessage(String(e), true))
                }
              >
                Atualizar
              </button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard
                label="Mensagens aprendidas"
                value={stats.messagesLearned}
                hint="Conversas únicas já processadas"
              />
              <StatCard
                label="Itens na memória"
                value={stats.knowledgeItems}
                hint={`${stats.byKind.question} perguntas · ${stats.byKind.answer} respostas · ${stats.byKind.qa_pair} pares`}
              />
              <StatCard
                label="Na fila"
                value={stats.queuePending}
                hint={
                  stats.queuePending > 0
                    ? `${stats.queueActive} processando agora`
                    : "Nada pendente no worker"
                }
                highlight={stats.queuePending > 0 ? "amber" : undefined}
              />
              <StatCard
                label="Respostas hoje"
                value={stats.repliesToday}
                hint={
                  stats.errorsRecent > 0
                    ? `${stats.errorsRecent} erro(s) nas últimas 24h`
                    : "Auto-resposta enviada"
                }
                highlight={stats.errorsRecent > 0 ? "red" : undefined}
              />
            </div>
            {stats.lastBackfill && (
              <p className="text-xs text-zinc-500 leading-relaxed">
                Última extração do histórico:{" "}
                <span className="text-zinc-400">
                  {new Date(stats.lastBackfill.at).toLocaleString()}
                </span>
                {stats.lastBackfill.detail ? ` — ${stats.lastBackfill.detail}` : ""}
              </p>
            )}
            {stats.queuePending > 0 && stats.messagesLearned === 0 && (
              <p className="text-xs text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                Há {stats.queuePending} job(s) na fila. Confirme se o serviço{" "}
                <strong className="font-medium">zap-worker</strong> está rodando no EasyPanel.
              </p>
            )}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium text-white">Tags de aprendizado e auto-resposta</h3>
          <button
            type="button"
            className="text-xs text-emerald-400 hover:underline"
            onClick={() => {
              setPendingLearn(false);
              setPendingReply(false);
              setShowTagModal(true);
            }}
          >
            Editar tags
          </button>
        </div>
        <p className="text-xs text-zinc-500 leading-relaxed">
          Cada tag pode liberar só aprendizado, só auto-resposta, ou os dois. Contatos sem a tag
          correspondente não entram naquele modo.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-3 space-y-2">
            <p className="text-[11px] uppercase tracking-wide text-zinc-500">Aprendizado</p>
            <div className="flex flex-wrap gap-2 min-h-[28px]">
              {(settings.learnTagIds ?? []).length === 0 ? (
                <span className="text-xs text-zinc-600">Nenhuma tag</span>
              ) : (
                settings.learnTagIds.map((id) => {
                  const tag = tags.find((t) => t.id === id);
                  return (
                    <span
                      key={id}
                      className="text-xs px-2 py-1 rounded-full border border-zinc-700 text-zinc-300"
                      style={{ borderColor: tag?.color }}
                    >
                      {tag?.name ?? id}
                    </span>
                  );
                })
              )}
            </div>
            {!settings.learnEnabled && (
              <p className="text-[11px] text-zinc-600">Ative &quot;Aprendizado&quot; acima para coletar</p>
            )}
          </div>
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-3 space-y-2">
            <p className="text-[11px] uppercase tracking-wide text-zinc-500">Auto-resposta</p>
            <div className="flex flex-wrap gap-2 min-h-[28px]">
              {(settings.replyTagIds ?? []).length === 0 ? (
                <span className="text-xs text-zinc-600">Nenhuma tag</span>
              ) : (
                (settings.replyTagIds ?? []).map((id) => {
                  const tag = tags.find((t) => t.id === id);
                  return (
                    <span
                      key={id}
                      className="text-xs px-2 py-1 rounded-full border border-zinc-700 text-zinc-300"
                      style={{ borderColor: tag?.color }}
                    >
                      {tag?.name ?? id}
                    </span>
                  );
                })
              )}
            </div>
            {!settings.autoReplyEnabled && (
              <p className="text-[11px] text-zinc-600">Ative &quot;Auto-resposta&quot; acima para responder</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm text-zinc-400">
          <label className="flex gap-2">
            <input type="checkbox" checked={settings.learnText} onChange={(e) => void save({ learnText: e.target.checked })} />
            Texto (aprender)
          </label>
          <label className="flex gap-2">
            <input type="checkbox" checked={settings.learnImage} onChange={(e) => void save({ learnImage: e.target.checked })} />
            Imagem (aprender)
          </label>
          <label className="flex gap-2">
            <input type="checkbox" checked={settings.learnAudio} onChange={(e) => void save({ learnAudio: e.target.checked })} />
            Áudio (aprender)
          </label>
          <label className="flex gap-2">
            <input type="checkbox" checked={settings.learnVideo} onChange={(e) => void save({ learnVideo: e.target.checked })} />
            Vídeo (aprender)
          </label>
        </div>
        <div className="pt-2 border-t border-zinc-800">
          <p className="text-xs text-zinc-500 mb-3 leading-relaxed">
            Use para processar conversas já salvas no CRM antes de ativar o aprendizado automático.
            Mensagens já aprendidas são ignoradas.
          </p>
          <button
            type="button"
            className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-100 text-sm hover:bg-zinc-700 disabled:opacity-50"
            disabled={
              !settings.learnEnabled ||
              !settings.hasOpenaiApiKey ||
              backfilling ||
              settings.learnTagIds.length === 0
            }
            onClick={() => void extractFromHistory()}
          >
            {backfilling ? "Enfileirando histórico…" : "Extrair aprendizagem do histórico"}
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-5 space-y-3">
        <h3 className="font-medium text-white">Produto e regras</h3>
        <p className="text-xs text-zinc-500">
          Edite os campos abaixo e clique em <strong className="text-zinc-400">Salvar alterações</strong>.
        </p>
        <label className="block text-sm text-zinc-400">
          Contexto do produto
          <span className="block text-xs text-zinc-500 mt-0.5 mb-1">
            Descreva o produto e o significado de cada tag do CRM (ex.: teste pago, comprador, quente, frio).
            A IA lê as tags do lead automaticamente e usa este texto para interpretá-las.
          </span>
          <textarea
            className="mt-1 w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-zinc-100 text-sm min-h-24"
            value={settings.productContext}
            onChange={(e) => setSettings({ ...settings, productContext: e.target.value })}
          />
        </label>
        <label className="block text-sm text-zinc-400">
          Fatos oficiais (prioridade máxima)
          <span className="block text-xs text-zinc-500 mt-0.5 mb-1">
            Valores e regras fixas do produto. Sobrescrevem o aprendizado histórico quando houver conflito
            (ex.: capital mínimo por tipo de conta).
          </span>
          <textarea
            className="mt-1 w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-zinc-100 text-xs min-h-24 font-mono"
            placeholder={
              "Capital/banca sempre em dólares (USD).\nConta cent: mínimo USD 50 (na tela aparece como 5.000 — 1 USD = 100).\nConta standard: mínimo USD 3.000 ou acima.\nNunca falar capital em reais (R$).\nNunca dizer só \"15.000 em conta cent\" sem explicar que equivale a USD 150."
            }
            value={settings.officialFacts}
            onChange={(e) => setSettings({ ...settings, officialFacts: e.target.value })}
          />
        </label>
        <label className="block text-sm text-zinc-400">
          Não pode fazer
          <textarea
            className="mt-1 w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-zinc-100 text-sm min-h-20"
            value={settings.rulesForbidden}
            onChange={(e) => setSettings({ ...settings, rulesForbidden: e.target.value })}
          />
        </label>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-5 space-y-3">
        <h3 className="font-medium text-white">Links oficiais</h3>
        {settings.officialLinks.map((link, i) => (
          <div key={i} className="grid grid-cols-3 gap-2">
            <input
              className="rounded bg-zinc-900 border border-zinc-700 px-2 py-1 text-sm text-zinc-100"
              placeholder="Gatilho"
              value={link.trigger}
              onChange={(e) => {
                const next = [...settings.officialLinks];
                next[i] = { ...link, trigger: e.target.value };
                setSettings({ ...settings, officialLinks: next });
              }}
            />
            <input
              className="rounded bg-zinc-900 border border-zinc-700 px-2 py-1 text-sm text-zinc-100"
              placeholder="URL"
              value={link.url}
              onChange={(e) => {
                const next = [...settings.officialLinks];
                next[i] = { ...link, url: e.target.value };
                setSettings({ ...settings, officialLinks: next });
              }}
            />
            <input
              className="rounded bg-zinc-900 border border-zinc-700 px-2 py-1 text-sm text-zinc-100"
              placeholder="Rótulo"
              value={link.label}
              onChange={(e) => {
                const next = [...settings.officialLinks];
                next[i] = { ...link, label: e.target.value };
                setSettings({ ...settings, officialLinks: next });
              }}
            />
          </div>
        ))}
        <button
          type="button"
          className="text-sm text-emerald-400"
          onClick={() =>
            setSettings({
              ...settings,
              officialLinks: [...settings.officialLinks, { trigger: "", url: "", label: "" }]
            })
          }
        >
          + Adicionar link
        </button>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-5 space-y-3">
        <div>
          <h3 className="font-medium text-white">Respostas com mídia</h3>
          <p className="mt-1 text-xs text-zinc-500 leading-relaxed">
            Respostas prontas (texto e/ou imagem, vídeo, áudio) que a IA envia
            sozinha quando o cliente pergunta algo equivalente a um dos gatilhos.
            A IA entende variações de escrita e áudio — não precisa ser a frase exata.
          </p>
        </div>

        {settings.mediaResponses.map((mr, i) => (
          <div
            key={mr.id}
            className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 space-y-2"
          >
            <div className="flex items-center gap-2">
              <input
                className="flex-1 rounded bg-zinc-900 border border-zinc-700 px-2 py-1 text-sm text-zinc-100"
                placeholder="Nome interno (ex.: Tutorial de instalação)"
                value={mr.label}
                onChange={(e) => updateMediaResponse(i, { label: e.target.value })}
              />
              <label className="flex items-center gap-1.5 text-xs text-zinc-400 shrink-0">
                <input
                  type="checkbox"
                  checked={mr.enabled}
                  onChange={(e) => updateMediaResponse(i, { enabled: e.target.checked })}
                />
                Ativa
              </label>
              <button
                type="button"
                className="text-xs text-red-400 hover:underline shrink-0"
                onClick={() => removeMediaResponse(i)}
              >
                Remover
              </button>
            </div>

            <label className="block text-xs text-zinc-400">
              Perguntas-gatilho (uma por linha, com variações)
              <textarea
                className="mt-1 w-full rounded bg-zinc-900 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-100 min-h-16"
                placeholder={"como instala?\ncomo faço a instalação\nnão sei instalar"}
                value={mr.triggers.join("\n")}
                onChange={(e) =>
                  updateMediaResponse(i, {
                    triggers: e.target.value.split("\n").map((t) => t.trim()).filter(Boolean)
                  })
                }
              />
            </label>

            <label className="block text-xs text-zinc-400">
              Texto da resposta (opcional — vira legenda da mídia)
              <textarea
                className="mt-1 w-full rounded bg-zinc-900 border border-zinc-700 px-2 py-1.5 text-sm text-zinc-100 min-h-12"
                value={mr.text}
                onChange={(e) => updateMediaResponse(i, { text: e.target.value })}
              />
            </label>

            <div className="flex flex-wrap items-center gap-2">
              {mr.mediaUrl ? (
                <>
                  <span className="text-xs text-emerald-300">
                    {mr.kind} anexado{mr.filename ? `: ${mr.filename}` : ""}
                  </span>
                  <a
                    href={mr.mediaUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-zinc-400 hover:underline"
                  >
                    ver
                  </a>
                  <button
                    type="button"
                    className="text-xs text-red-400 hover:underline"
                    onClick={() =>
                      updateMediaResponse(i, { kind: "text", mediaUrl: "", filename: "" })
                    }
                  >
                    remover mídia
                  </button>
                </>
              ) : (
                <label className="text-xs text-emerald-400 cursor-pointer hover:underline">
                  + Anexar imagem, vídeo ou áudio
                  <input
                    type="file"
                    accept="image/*,video/*,audio/*,application/pdf"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void uploadMediaFor(i, f);
                      e.target.value = "";
                    }}
                  />
                </label>
              )}
            </div>
          </div>
        ))}

        <button type="button" className="text-sm text-emerald-400" onClick={addMediaResponse}>
          + Adicionar resposta
        </button>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium text-white">Auto-resposta</h3>
          {!settings.autoReplyEnabled && (
            <span className="text-xs text-zinc-500">Ative &quot;Auto-resposta&quot; acima para enviar</span>
          )}
        </div>
        <p className="text-sm text-zinc-400">
          Responde automaticamente após o delay configurado, respeitando o modo humano quando você
          envia mensagem manual.
        </p>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <label className="text-zinc-400">
            Delay (seg)
            <input
              type="number"
              min={10}
              className="mt-1 w-full rounded bg-zinc-900 border border-zinc-700 px-2 py-1 text-zinc-100"
              value={settings.replyDelaySec}
              onChange={(e) =>
                setSettings({ ...settings, replyDelaySec: Number(e.target.value) || 60 })
              }
            />
          </label>
          <label className="text-zinc-400">
            Idle humano (seg)
            <input
              type="number"
              min={10}
              className="mt-1 w-full rounded bg-zinc-900 border border-zinc-700 px-2 py-1 text-zinc-100"
              value={settings.humanIdleSec}
              onChange={(e) =>
                setSettings({ ...settings, humanIdleSec: Number(e.target.value) || 60 })
              }
            />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm text-zinc-400">
          <label className="flex gap-2">
            <input type="checkbox" checked={settings.replyText} onChange={(e) => void save({ replyText: e.target.checked })} />
            Texto (resposta)
          </label>
          <label className="flex gap-2">
            <input type="checkbox" checked={settings.replyImage} onChange={(e) => void save({ replyImage: e.target.checked })} />
            Imagem (resposta)
          </label>
          <label className="flex gap-2">
            <input type="checkbox" checked={settings.replyAudio} onChange={(e) => void save({ replyAudio: e.target.checked })} />
            Áudio (resposta)
          </label>
          <label className="flex gap-2">
            <input type="checkbox" checked={settings.replyVideo} onChange={(e) => void save({ replyVideo: e.target.checked })} />
            Vídeo (resposta)
          </label>
        </div>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-5 space-y-3">
        <h3 className="font-medium text-white">Testar resposta (simulação)</h3>
        <p className="text-xs text-zinc-500 leading-relaxed">
          Usa o aprendizado histórico de todas as conversas (até 20 itens relevantes), com prioridade
          sobre o contexto do produto — igual à auto-resposta.
        </p>
        <textarea
          className="w-full rounded-lg bg-zinc-900 border border-zinc-700 px-3 py-2 text-sm text-zinc-100 min-h-20"
          placeholder="Digite uma mensagem do cliente…"
          value={testInput}
          onChange={(e) => setTestInput(e.target.value)}
        />
        <button
          type="button"
          className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-100 text-sm"
          onClick={() => void runTestReply().catch((e) => setMessage(String(e)))}
        >
          Simular
        </button>
        {testReply && (
          <pre className="text-sm text-zinc-300 whitespace-pre-wrap bg-zinc-900 p-3 rounded-lg border border-zinc-800">
            {testReply}
          </pre>
        )}
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-5 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:justify-between sm:items-start">
          <div>
            <h3 className="font-medium text-white">Conhecimento aprendido</h3>
            <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
              {knowledgeTotal > 0
                ? `${knowledgeTotal} item(ns) no banco — mostrando os 20 mais recentes.`
                : "Nenhum item processado ainda. Após extrair do histórico, aguarde o zap-worker e veja eventos learned no log."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 shrink-0">
            <button
              type="button"
              className="text-sm text-zinc-400 hover:text-zinc-200"
              onClick={() =>
                void refreshProgress()
                  .then(() => showMessage("Progresso atualizado."))
                  .catch((e) => showMessage(String(e), true))
              }
            >
              Atualizar
            </button>
            <button
              type="button"
              className="text-sm text-emerald-400 hover:text-emerald-300"
              onClick={() =>
                void downloadKnowledge("json").catch((e) => setMessage(String(e)))
              }
            >
              Baixar JSON
            </button>
            <button
              type="button"
              className="text-sm text-emerald-400/80 hover:text-emerald-300"
              onClick={() =>
                void downloadKnowledge("csv").catch((e) => setMessage(String(e)))
              }
            >
              Baixar CSV
            </button>
            <button
              type="button"
              className="text-sm text-sky-400 hover:text-sky-300 disabled:opacity-50"
              disabled={importing}
              onClick={() => importInputRef.current?.click()}
            >
              {importing ? "Importando…" : "Subir aprendizagem"}
            </button>
            <input
              ref={importInputRef}
              type="file"
              accept=".json,.csv,application/json,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadKnowledgeFile(file);
              }}
            />
            <button
              type="button"
              className="text-sm text-red-400 hover:text-red-300"
              onClick={() => void clearKnowledge().catch((e) => setMessage(String(e)))}
            >
              Limpar memória
            </button>
          </div>
        </div>
        <ul className="space-y-2 max-h-48 overflow-y-auto text-sm">
          {knowledge.map((k) => (
            <li key={k.id} className="border-b border-zinc-800 pb-2 text-zinc-400">
              <span className="text-emerald-400/80">{k.kind}</span> · {k.topic ?? "—"} ·{" "}
              {k.content.slice(0, 120)}
            </li>
          ))}
          {knowledge.length === 0 && <li className="text-zinc-600">Nenhum item ainda.</li>}
        </ul>
      </section>

      <section className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-5 space-y-3">
        <div className="flex justify-between items-center gap-2">
          <h3 className="font-medium text-white">Log de eventos</h3>
          <button
            type="button"
            className="text-xs text-zinc-500 hover:text-zinc-300"
            onClick={() => void refreshProgress()}
          >
            Atualizar
          </button>
        </div>
        <p className="text-xs text-zinc-600 leading-relaxed">
          <strong className="text-zinc-500">learned</strong> = item extraído ·{" "}
          <strong className="text-zinc-500">replied</strong> = resposta enviada ·{" "}
          <strong className="text-zinc-500">error</strong> = falha (ex.: worker parado) ·{" "}
          <strong className="text-zinc-500">cancelled_human</strong> = você respondeu manualmente
        </p>
        <ul className="space-y-1 max-h-40 overflow-y-auto text-xs text-zinc-500">
          {events.map((ev) => (
            <li
              key={ev.id}
              className={
                ev.event === "error"
                  ? "text-red-400/90"
                  : ev.event === "replied" || ev.event === "learned"
                    ? "text-emerald-400/80"
                    : ev.event === "cancelled_human"
                      ? "text-amber-400/80"
                      : ""
              }
            >
              {new Date(ev.createdAt).toLocaleString()} · {ev.event}
              {ev.detail ? ` — ${ev.detail.slice(0, 80)}` : ""}
            </li>
          ))}
          {events.length === 0 && <li className="text-zinc-600">Nenhum evento ainda.</li>}
        </ul>
      </section>

      {showTagModal && (
        <TagSelectModal
          tags={tags}
          learnSelected={settings.learnTagIds}
          replySelected={settings.replyTagIds ?? []}
          onCancel={() => {
            setShowTagModal(false);
            setPendingLearn(false);
            setPendingReply(false);
          }}
          onConfirm={confirmTags}
        />
      )}

      {saving && <p className="text-xs text-zinc-500">Salvando…</p>}
    </div>
  );
}

function StatCard(props: {
  label: string;
  value: number;
  hint: string;
  highlight?: "amber" | "red";
}) {
  const valueClass =
    props.highlight === "amber"
      ? "text-amber-300"
      : props.highlight === "red"
        ? "text-red-300"
        : "text-white";

  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-1)] px-3 py-2.5 shadow-xs">
      <p className="text-xs text-zinc-400 font-medium">{props.label}</p>
      <p className={`text-xl font-bold tracking-tight tabular-nums mt-0.5 ${valueClass}`}>{props.value}</p>
      <p className="text-[11px] text-zinc-500 mt-0.5 leading-snug">{props.hint}</p>
    </div>
  );
}

function TagSelectModal(props: {
  tags: Tag[];
  learnSelected: string[];
  replySelected: string[];
  onCancel: () => void;
  onConfirm: (selection: { learnTagIds: string[]; replyTagIds: string[] }) => void;
}) {
  const [learnPicked, setLearnPicked] = useState<string[]>(props.learnSelected);
  const [replyPicked, setReplyPicked] = useState<string[]>(props.replySelected);

  function toggle(list: string[], id: string, on: boolean): string[] {
    return on ? [...list, id] : list.filter((x) => x !== id);
  }

  const modal = (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onCancel();
      }}
    >
      <div className="w-full max-w-lg max-h-[min(90vh,640px)] overflow-hidden flex flex-col rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl">
        <div className="p-5 pb-3 space-y-1 shrink-0">
          <h3 className="text-white font-medium">Tags por modo</h3>
          <p className="text-sm text-zinc-400">
            Marque <strong className="text-zinc-300">Aprendizado</strong>,{" "}
            <strong className="text-zinc-300">Auto-resposta</strong> ou os dois. Pode deixar uma tag
            só em um dos lados.
          </p>
        </div>
        <div className="px-5 pb-2 shrink-0 grid grid-cols-[1fr_72px_72px] gap-2 text-[11px] uppercase tracking-wide text-zinc-500">
          <span>Tag</span>
          <span className="text-center">Aprender</span>
          <span className="text-center">Responder</span>
        </div>
        <div className="px-5 overflow-y-auto flex-1 min-h-0 space-y-1 pb-3">
          {props.tags.length === 0 ? (
            <p className="text-sm text-zinc-600 py-4">Nenhuma tag cadastrada no CRM.</p>
          ) : (
            props.tags.map((t) => (
              <div
                key={t.id}
                className="grid grid-cols-[1fr_72px_72px] gap-2 items-center rounded-lg border border-zinc-800/80 bg-zinc-900/40 px-2 py-2"
              >
                <span className="text-sm text-zinc-200 truncate" style={{ color: t.color }}>
                  {t.name}
                </span>
                <label className="flex justify-center">
                  <input
                    type="checkbox"
                    checked={learnPicked.includes(t.id)}
                    onChange={(e) =>
                      setLearnPicked((prev) => toggle(prev, t.id, e.target.checked))
                    }
                  />
                </label>
                <label className="flex justify-center">
                  <input
                    type="checkbox"
                    checked={replyPicked.includes(t.id)}
                    onChange={(e) =>
                      setReplyPicked((prev) => toggle(prev, t.id, e.target.checked))
                    }
                  />
                </label>
              </div>
            ))
          )}
        </div>
        <div className="flex justify-end gap-2 p-5 pt-3 border-t border-zinc-800 shrink-0">
          <button type="button" className="px-3 py-2 text-sm text-zinc-400" onClick={props.onCancel}>
            Cancelar
          </button>
          <button
            type="button"
            className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm"
            onClick={() =>
              props.onConfirm({ learnTagIds: learnPicked, replyTagIds: replyPicked })
            }
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );

  // Portal no body: evita fixed preso a um pai com transform/overflow (popup “lá embaixo”).
  return createPortal(modal, document.body);
}
