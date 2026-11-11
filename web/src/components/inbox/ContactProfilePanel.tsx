import { useCallback, useEffect, useState } from "react";
import { api } from "../../api/client";
import { WhatsAppAvatar } from "./WhatsAppAvatar";

type Tag = { id: string; name: string; color: string };

type ContactInfo = {
  id: string;
  phone: string;
  name: string | null;
  email?: string | null;
  notes?: string | null;
  stage?: string | null;
  lostReason?: string | null;
  productName?: string | null;
  tags: Tag[];
};

const FUNNEL_STEPS = [
  { id: "novo", label: "Novo" },
  { id: "em_conversa", label: "Em conversa" },
  { id: "comprou", label: "Comprou" },
  { id: "perdido", label: "Perdido" }
] as const;

const LOST_REASONS = [
  { id: "preco", label: "Preço" },
  { id: "sumiu", label: "Sumiu" },
  { id: "ja_tem", label: "Já tem" },
  { id: "outro", label: "Outro" }
] as const;

type ProfileGroup = { id: string; name: string };

type Profile = {
  chatId: string;
  phone: string;
  name: string | null;
  email: string | null;
  notes: string | null;
  stage: string | null;
  lostReason: string | null;
  productName: string | null;
  isGroup: boolean;
  contact: ContactInfo | null;
  groups: ProfileGroup[];
  messageCount: number;
  createdAt: string | null;
};

type ChatRef = {
  id: string;
  phone: string;
  name: string;
  isGroup: boolean;
  kind: "direct" | "group" | "community";
  contact: ContactInfo | null;
};

function formatPhoneDisplay(phone: string): string {
  const d = phone.replace(/\D/g, "");
  if (d.length === 13 && d.startsWith("55")) {
    return `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 9)}-${d.slice(9)}`;
  }
  if (d.length === 12 && d.startsWith("55")) {
    return `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 8)}-${d.slice(8)}`;
  }
  if (d.length >= 10) return `+${d}`;
  return phone;
}

type Props = {
  chat: ChatRef;
  allTags: Tag[];
  onClose: () => void;
  onContactUpdated: (contact: ContactInfo) => void;
  onDeleteConversation: () => void;
  onRemoveFromCrm: () => void;
  onOpenGroup: (groupId: string, groupName: string) => void;
  docked?: boolean;
  onCollapse?: () => void;
  aiModeValue?: "auto" | "human";
  onAiModeChange?: (mode: "auto" | "human") => void | Promise<void>;
};

export function ContactProfilePanel({
  chat,
  allTags,
  onClose,
  onContactUpdated,
  onDeleteConversation,
  onRemoveFromCrm,
  onOpenGroup,
  docked = false,
  onCollapse,
  aiModeValue,
  onAiModeChange
}: Props) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [aiMode, setAiMode] = useState<"auto" | "human">("auto");
  const [askLostReason, setAskLostReason] = useState(false);

  const contactKey = chat.isGroup ? chat.id : chat.phone || chat.id;

  const loadProfile = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const q = new URLSearchParams({
        chatId: chat.id,
        isGroup: chat.isGroup ? "1" : "0"
      });
      const r = await api<{ ok: boolean; profile?: Profile; error?: string }>(
        `/api/contacts/${encodeURIComponent(contactKey)}/profile?${q}`
      );
      if (!r.ok || !r.profile) {
        setError(r.error ?? "Não foi possível carregar o perfil");
        return;
      }
      setProfile(r.profile);
      setName(r.profile.name ?? chat.name ?? "");
      setEmail(r.profile.email ?? r.profile.contact?.email ?? "");
      setNotes(r.profile.notes ?? "");
      if (!chat.isGroup && !onAiModeChange) {
        const mode = await api<{ mode?: string }>(
          `/api/inbox/mode?chatId=${encodeURIComponent(chat.id)}`
        );
        setAiMode(mode.mode === "human" ? "human" : "auto");
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao carregar perfil");
    } finally {
      setLoading(false);
    }
  }, [chat.id, chat.isGroup, chat.name, contactKey]);

  const loadGroups = useCallback(async () => {
    if (chat.isGroup) return;
    setLoadingGroups(true);
    try {
      const r = await api<{ ok: boolean; groups?: ProfileGroup[] }>(
        `/api/contacts/${encodeURIComponent(contactKey)}/groups`
      );
      if (r.ok && Array.isArray(r.groups)) {
        setProfile((p) => (p ? { ...p, groups: r.groups ?? [] } : p));
      }
    } catch {
      /* grupos são opcionais — não bloqueia o painel */
    } finally {
      setLoadingGroups(false);
    }
  }, [chat.isGroup, contactKey]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  useEffect(() => {
    if (loading || chat.isGroup) return;
    void loadGroups();
  }, [loading, chat.isGroup, loadGroups]);

  async function saveContact(patch: {
    name?: string;
    email?: string;
    notes?: string;
    tagIds?: string[];
    stage?: string;
    lostReason?: string;
  }) {
    if (chat.isGroup) return;
    setSaving(true);
    setError("");
    try {
      const r = await api<{ ok: boolean; contact: ContactInfo; error?: string }>(
        `/api/contacts/${encodeURIComponent(contactKey)}`,
        {
          method: "PUT",
          body: JSON.stringify({
            ...(patch.name !== undefined ? { name: patch.name.trim() || undefined } : {}),
            ...(patch.email !== undefined ? { email: patch.email.trim() || undefined } : {}),
            ...(patch.notes !== undefined ? { notes: patch.notes.trim() || undefined } : {}),
            ...(patch.tagIds !== undefined ? { tagIds: patch.tagIds } : {}),
            ...(patch.stage !== undefined ? { stage: patch.stage } : {}),
            ...(patch.lostReason !== undefined ? { lostReason: patch.lostReason } : {})
          })
        }
      );
      if (r.contact) {
        onContactUpdated(r.contact);
        setProfile((p) =>
          p
            ? {
                ...p,
                name: r.contact.name,
                email: r.contact.email ?? null,
                notes: r.contact.notes ?? null,
                stage: r.contact.stage ?? p.stage,
                lostReason: r.contact.lostReason ?? null,
                productName: r.contact.productName ?? p.productName,
                contact: r.contact
              }
            : p
        );
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao salvar");
    } finally {
      setSaving(false);
    }
  }

  function toggleTag(tagId: string) {
    if (chat.isGroup) return;
    const current = profile?.contact?.tags.map((t) => t.id) ?? [];
    const next = current.includes(tagId)
      ? current.filter((id) => id !== tagId)
      : [...current, tagId];
    void saveContact({ tagIds: next });
  }

  async function handleDeleteConversation() {
    if (
      !window.confirm(
        "Apagar todas as mensagens desta conversa no Zap? O contato e as tags permanecem."
      )
    ) {
      return;
    }
    setDeleting(true);
    setError("");
    try {
      const r = await api<{ ok: boolean; deleted?: number; error?: string }>(
        `/api/inbox/conversations/${encodeURIComponent(chat.id)}`,
        { method: "DELETE" }
      );
      if (!r.ok) {
        setError(r.error ?? "Falha ao apagar conversa");
        return;
      }
      onDeleteConversation();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao apagar conversa");
    } finally {
      setDeleting(false);
    }
  }

  async function handleRemoveFromCrm() {
    if (chat.isGroup) {
      await handleDeleteConversation();
      return;
    }
    if (
      !window.confirm(
        "Remover este número do CRM do chat? Apaga mensagens, tags, memória da IA e o registro do contato. A conversa só volta se a pessoa mandar mensagem de novo."
      )
    ) {
      return;
    }
    setDeleting(true);
    setError("");
    try {
      const r = await api<{ ok: boolean; error?: string }>(
        `/api/contacts/${encodeURIComponent(contactKey)}/crm?chatId=${encodeURIComponent(chat.id)}`,
        { method: "DELETE" }
      );
      if (!r.ok) {
        setError(r.error ?? "Falha ao remover do CRM");
        return;
      }
      onRemoveFromCrm();
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao remover do CRM");
    } finally {
      setDeleting(false);
    }
  }

  const activeTagIds = new Set(profile?.contact?.tags.map((t) => t.id) ?? []);
  const displayName = name.trim() || chat.name || formatPhoneDisplay(chat.phone);

  return (
    <aside
      className={
        docked
          ? "flex h-full w-full flex-col border-l border-[#2a3942] bg-[#111b21]"
          : "absolute inset-y-0 right-0 z-40 flex w-full max-w-[400px] flex-col border-l border-[#2a3942] bg-[#111b21] shadow-2xl"
      }
    >
      <header className="flex h-[60px] items-center gap-3 bg-[#202c33] px-3 shrink-0">
        {!docked && (
        <button
          type="button"
          onClick={onClose}
          className="p-2 rounded-full text-[#aebac1] hover:bg-[#374955]"
          title="Fechar"
        >
          <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
          </svg>
        </button>
        )}
        <span className="font-medium text-[#e9edef]">
          {chat.isGroup ? "Info do grupo" : "Info do contato"}
        </span>
        {docked && onCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            className="ml-auto p-2 rounded-full text-[#aebac1] hover:bg-[#374955] hover:text-[#e9edef]"
            title="Recolher info"
            aria-label="Recolher info do contato"
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="flex flex-col items-center py-6 px-4 bg-[#202c33]/40 border-b border-[#2a3942]/60">
          <WhatsAppAvatar
            chatId={chat.id}
            isGroup={chat.isGroup}
            name={displayName}
            size={120}
          />
          {!chat.isGroup ? (
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => {
                if (name.trim() !== (profile?.name ?? "")) void saveContact({ name: name.trim() });
              }}
              placeholder="Nome do contato"
              className="mt-4 w-full max-w-[280px] text-center text-lg font-medium bg-transparent border-b border-[#3b4a54] pb-1 text-[#e9edef] focus:border-[#00a884] outline-none"
            />
          ) : (
            <h2 className="mt-4 text-lg font-medium text-[#e9edef] text-center">{displayName}</h2>
          )}
          <p className="mt-1 text-sm text-[#8696a0]">
            {chat.isGroup ? chat.id : formatPhoneDisplay(profile?.phone ?? chat.phone)}
          </p>
          {profile && (
            <p className="mt-2 text-xs text-[#8696a0]">
              {profile.messageCount} mensagem{profile.messageCount !== 1 ? "ns" : ""} no Zap
            </p>
          )}
        </div>

        {loading && (
          <p className="text-center text-sm text-[#8696a0] py-8">Carregando perfil…</p>
        )}

        {error && (
          <p className="mx-4 mt-4 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        {!loading && !chat.isGroup && (
          <section className="px-4 py-4 border-b border-[#2a3942]/60">
            <h3 className="text-xs uppercase tracking-wide text-[#00a884] mb-2">E-mail</h3>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => {
                const saved = profile?.email ?? profile?.contact?.email ?? "";
                if (email.trim() !== saved) void saveContact({ email: email.trim() });
              }}
              placeholder="email@exemplo.com (usado em fluxos)"
              className="w-full rounded-lg bg-[#2a3942] px-3 py-2 text-sm text-[#e9edef] border-0 focus:ring-1 focus:ring-[#00a884]/50 outline-none"
            />
            <p className="mt-1 text-[11px] text-[#8696a0]">
              Usado no nó Enviar e-mail quando o gatilho não traz {"{{email}}"}.
            </p>
          </section>
        )}

        {!loading && !chat.isGroup && (
          <section className="px-4 py-4 border-b border-[#2a3942]/60">
            <h3 className="text-xs uppercase tracking-wide text-[#00a884] mb-2">Observações</h3>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => {
                if (notes.trim() !== (profile?.notes ?? "")) void saveContact({ notes: notes.trim() });
              }}
              rows={3}
              placeholder="Anotações sobre este contato…"
              className="w-full rounded-lg bg-[#2a3942] px-3 py-2 text-sm text-[#e9edef] border-0 resize-none focus:ring-1 focus:ring-[#00a884]/50 outline-none"
            />
            {saving && <p className="text-[11px] text-[#8696a0] mt-1">Salvando…</p>}
          </section>
        )}

        {!loading && !chat.isGroup && (
          <section className="px-4 py-4 border-b border-[#2a3942]/60">
            <h3 className="text-xs uppercase tracking-wide text-[#00a884] mb-2">Funil</h3>
            <div className="grid grid-cols-2 gap-2">
              {FUNNEL_STEPS.map((step) => {
                const on = (profile?.stage ?? profile?.contact?.stage ?? "novo") === step.id;
                return (
                  <button
                    key={step.id}
                    type="button"
                    disabled={saving}
                    onClick={() => {
                      if (step.id === "perdido") {
                        setAskLostReason(true);
                        return;
                      }
                      setAskLostReason(false);
                      void saveContact({ stage: step.id });
                    }}
                    className={`rounded-lg px-2 py-1.5 text-xs ${
                      on ? "bg-[#00a884] text-[#111b21]" : "bg-[#2a3942] text-[#e9edef]"
                    }`}
                  >
                    {step.label}
                  </button>
                );
              })}
            </div>
            {askLostReason && (
              <div className="mt-2 flex flex-wrap gap-1">
                {LOST_REASONS.map((reason) => (
                  <button
                    key={reason.id}
                    type="button"
                    onClick={() => {
                      setAskLostReason(false);
                      void saveContact({ stage: "perdido", lostReason: reason.id });
                    }}
                    className="rounded-md bg-[#2a3942] px-2 py-1 text-[11px] text-[#e9edef]"
                  >
                    {reason.label}
                  </button>
                ))}
              </div>
            )}
            {!askLostReason && (profile?.lostReason || profile?.contact?.lostReason) && (profile?.stage ?? profile?.contact?.stage) === "perdido" && (
              <p className="mt-2 text-xs text-[#8696a0]">
                {LOST_REASONS.find((reason) => reason.id === (profile?.lostReason ?? profile?.contact?.lostReason))?.label}
              </p>
            )}
            {profile?.productName && (
              <p className="mt-2 text-xs text-[#8696a0]">Produto: {profile.productName}</p>
            )}
          </section>
        )}

        {!loading && (
          <section className="px-4 py-4 border-b border-[#2a3942]/60">
            <h3 className="text-xs uppercase tracking-wide text-[#00a884] mb-2">IA desta conversa</h3>
            <p className="mb-2 text-[11px] text-[#8696a0]">
              {(aiModeValue ?? aiMode) === "human"
                ? "Você assumiu. A IA não responde até devolver."
                : "A IA responde. Ela para sozinha quando a pessoa pede um humano."}
            </p>
            <button
              type="button"
              className="rounded-lg bg-[#2a3942] px-3 py-1.5 text-xs text-[#e9edef]"
              onClick={() => {
                const next = (aiModeValue ?? aiMode) === "human" ? "auto" : "human";
                if (onAiModeChange) {
                  void Promise.resolve(onAiModeChange(next)).catch((e: unknown) =>
                    setError(e instanceof Error ? e.message : "Não foi possível mudar a IA.")
                  );
                  return;
                }
                void api("/api/inbox/mode", {
                  method: "POST",
                  body: JSON.stringify({ chatId: chat.id, mode: next })
                }).then(() => setAiMode(next));
              }}
            >
              {(aiModeValue ?? aiMode) === "human" ? "Devolver para a IA" : "Assumir conversa"}
            </button>
          </section>
        )}

        {!loading && !chat.isGroup && allTags.length > 0 && (
          <section className="px-4 py-4 border-b border-[#2a3942]/60">
            <h3 className="text-xs uppercase tracking-wide text-[#00a884] mb-3">Etiquetas</h3>
            <div className="flex flex-wrap gap-2">
              {allTags.map((tag) => {
                const on = activeTagIds.has(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => toggleTag(tag.id)}
                    disabled={saving}
                    className={`text-xs px-3 py-1.5 rounded-full border transition ${
                      on ? "text-white border-transparent" : "border-[#3b4a54] text-[#8696a0]"
                    }`}
                    style={on ? { backgroundColor: tag.color } : undefined}
                  >
                    {tag.name}
                  </button>
                );
              })}
            </div>
          </section>
        )}

        {!loading && !chat.isGroup && (loadingGroups || (profile && profile.groups.length > 0)) && (
          <section className="px-4 py-4 border-b border-[#2a3942]/60">
            <h3 className="text-xs uppercase tracking-wide text-[#00a884] mb-3">
              Grupos em comum
              {profile && profile.groups.length > 0 ? ` (${profile.groups.length})` : ""}
            </h3>
            {loadingGroups && profile?.groups.length === 0 ? (
              <p className="text-xs text-[#8696a0]">Buscando grupos…</p>
            ) : (
              <ul className="space-y-1">
                {(profile?.groups ?? []).map((g) => (
                  <li key={g.id}>
                    <button
                      type="button"
                      onClick={() => onOpenGroup(g.id, g.name)}
                      className="w-full flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-[#202c33] text-left"
                    >
                      <WhatsAppAvatar chatId={g.id} isGroup name={g.name} size={40} />
                      <span className="text-sm text-[#e9edef] truncate">{g.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {!loading && !chat.isGroup && profile?.createdAt && (
          <section className="px-4 py-4 border-b border-[#2a3942]/60">
            <h3 className="text-xs uppercase tracking-wide text-[#8696a0] mb-1">No CRM desde</h3>
            <p className="text-sm text-[#e9edef]">
              {new Date(profile.createdAt).toLocaleDateString("pt-BR", {
                day: "2-digit",
                month: "long",
                year: "numeric"
              })}
            </p>
          </section>
        )}

        {!loading && (
          <section className="px-4 py-6 space-y-3">
            <h3 className="text-xs uppercase tracking-wide text-[#8696a0] mb-2">Ações</h3>
            <button
              type="button"
              onClick={() => void handleDeleteConversation()}
              disabled={deleting}
              className="w-full rounded-lg border border-[#3b4a54] px-4 py-2.5 text-sm text-[#e9edef] hover:bg-[#202c33] disabled:opacity-50"
            >
              Apagar conversa
            </button>
            {!chat.isGroup && (
              <button
                type="button"
                onClick={() => void handleRemoveFromCrm()}
                disabled={deleting}
                className="w-full rounded-lg border border-red-500/40 px-4 py-2.5 text-sm text-red-300 hover:bg-red-500/10 disabled:opacity-50"
              >
                Remover número do CRM
              </button>
            )}
          </section>
        )}
      </div>
    </aside>
  );
}
