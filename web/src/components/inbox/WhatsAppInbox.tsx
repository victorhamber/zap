import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { InboxComposer, type QuickReply } from "./InboxComposer";

type Tag = { id: string; name: string; color: string };
type ChatKind = "direct" | "group" | "community";
type ChatTab = "all" | ChatKind;

type ContactInfo = {
  id: string;
  phone: string;
  name: string | null;
  tags: Tag[];
};

type Chat = {
  id: string;
  phone: string;
  name: string;
  lastMessage: string;
  timestamp: number;
  isGroup: boolean;
  kind: ChatKind;
  unreadCount: number;
  contact: ContactInfo | null;
};

type Message = {
  id: string;
  body: string;
  fromMe: boolean;
  timestamp: number;
  type: string;
};

type FlowOption = { id: string; name: string; inboundTags: string[] };

const TAB_LABELS: Record<ChatTab, string> = {
  all: "Todas",
  direct: "Conversas",
  group: "Grupos",
  community: "Comunidades"
};

function usePageVisible() {
  const [visible, setVisible] = useState(() =>
    typeof document !== "undefined" ? !document.hidden : true
  );
  useEffect(() => {
    const fn = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", fn);
    return () => document.removeEventListener("visibilitychange", fn);
  }, []);
  return visible;
}

function initials(name: string): string {
  const p = name.trim().split(/\s+/);
  if (p.length >= 2) return (p[0][0] + p[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function formatTime(ts: number): string {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

export function WhatsAppInbox() {
  const pageVisible = usePageVisible();
  const [chats, setChats] = useState<Chat[]>([]);
  const [selected, setSelected] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [flows, setFlows] = useState<FlowOption[]>([]);
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [search, setSearch] = useState("");
  const [chatTab, setChatTab] = useState<ChatTab>("all");
  const [draft, setDraft] = useState("");
  const [loadingChats, setLoadingChats] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [error, setError] = useState("");
  const [newTagName, setNewTagName] = useState("");
  const [newTagColor, setNewTagColor] = useState("#25D366");
  const [showTagForm, setShowTagForm] = useState(false);
  const [msgHint, setMsgHint] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const loadTags = useCallback(async () => {
    const r = await api<{ tags: Tag[] }>("/api/tags");
    setTags(r.tags ?? []);
  }, []);

  const loadFlows = useCallback(async () => {
    const r = await api<{ flows: FlowOption[] }>("/api/flows/enabled");
    setFlows(r.flows ?? []);
  }, []);

  const loadQuickReplies = useCallback(async () => {
    const r = await api<{ replies: QuickReply[] }>("/api/inbox/quick-replies");
    setQuickReplies(r.replies ?? []);
  }, []);

  const loadChats = useCallback(async (silent = false) => {
    if (!silent) setLoadingChats(true);
    setError("");
    try {
      const r = await api<{
        ok: boolean;
        chats: Chat[];
        message?: string;
        sourcesOk?: string[];
        errors?: string[];
      }>("/api/inbox/chats");
      setChats(r.chats ?? []);
      if (r.chats.length === 0) {
        const detail = r.message ?? r.errors?.join(" · ") ?? "Sem conversas no WPP.";
        setError(detail);
      } else if (r.errors?.length) {
        setError("");
      }
    } catch (e: any) {
      setError(e?.message ?? "Erro ao carregar conversas");
    } finally {
      if (!silent) setLoadingChats(false);
    }
  }, []);

  const loadMessages = useCallback(async (chat: Chat, silent = false) => {
    if (!silent) setLoadingMsgs(true);
    setMsgHint("");
    try {
      const r = await api<{
        ok: boolean;
        messages: Message[];
        hint?: string;
        message?: string;
      }>(
        `/api/inbox/messages?chatId=${encodeURIComponent(chat.id)}&isGroup=${chat.isGroup ? "1" : "0"}`
      );
      setMessages(r.messages ?? []);
      setMsgHint(r.hint ?? (r.ok ? "" : r.message ?? ""));
    } catch (e: any) {
      setMessages([]);
      setMsgHint(e?.message ?? "Erro ao carregar mensagens");
    } finally {
      if (!silent) setLoadingMsgs(false);
    }
  }, []);

  useEffect(() => {
    loadTags();
    loadFlows();
    loadQuickReplies();
    loadChats();
  }, [loadTags, loadFlows, loadQuickReplies, loadChats]);

  useEffect(() => {
    if (!pageVisible) return;
    const t = setInterval(() => loadChats(true), 60000);
    return () => clearInterval(t);
  }, [pageVisible, loadChats]);

  useEffect(() => {
    if (!selected || !pageVisible) return;
    loadMessages(selected);
    const t = setInterval(() => loadMessages(selected, true), 30000);
    return () => clearInterval(t);
  }, [selected, pageVisible, loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const filtered = chats.filter((c) => {
    if (chatTab !== "all" && c.kind !== chatTab) return false;
    const q = search.toLowerCase();
    if (!q) return true;
    const tagStr = c.contact?.tags.map((t) => t.name).join(" ") ?? "";
    return (
      c.name.toLowerCase().includes(q) ||
      c.phone.includes(q) ||
      c.id.toLowerCase().includes(q) ||
      tagStr.toLowerCase().includes(q)
    );
  });

  const tabCounts = {
    all: chats.length,
    direct: chats.filter((c) => c.kind === "direct").length,
    group: chats.filter((c) => c.kind === "group").length,
    community: chats.filter((c) => c.kind === "community").length
  };

  async function saveContactTags(chat: Chat, tagIds: string[]) {
    const key = chat.isGroup ? chat.id : chat.phone;
    const r = await api<{ ok: boolean; contact: ContactInfo }>(
      `/api/contacts/${encodeURIComponent(key)}`,
      {
        method: "PUT",
        body: JSON.stringify({ name: chat.name, tagIds })
      }
    );
    if (r.contact) {
      setChats((prev) =>
        prev.map((c) => (c.id === chat.id ? { ...c, contact: r.contact } : c))
      );
      if (selected?.id === chat.id) {
        setSelected((s) => (s ? { ...s, contact: r.contact } : s));
      }
    }
  }

  async function createTag() {
    const name = newTagName.trim();
    if (!name) return;
    await api("/api/tags", {
      method: "POST",
      body: JSON.stringify({ name, color: newTagColor })
    });
    setNewTagName("");
    setShowTagForm(false);
    await loadTags();
  }

  async function sendMessage() {
    if (!selected || !draft.trim()) return;
    const r = await api<{ ok: boolean; message?: string }>("/api/inbox/send", {
      method: "POST",
      body: JSON.stringify({
        chatId: selected.id,
        message: draft.trim(),
        isGroup: selected.isGroup
      })
    });
    if (!r.ok) {
      setError(r.message ?? "Falha ao enviar");
      return;
    }
    setDraft("");
    await loadMessages(selected, true);
    await loadChats(true);
  }

  async function sendMedia(
    type: "image" | "video" | "audio" | "document",
    url: string,
    caption?: string
  ) {
    if (!selected) return;
    const r = await api<{ ok: boolean; message?: string }>("/api/inbox/send-media", {
      method: "POST",
      body: JSON.stringify({
        chatId: selected.id,
        type,
        url,
        caption,
        isGroup: selected.isGroup
      })
    });
    if (!r.ok) setError(r.message ?? "Falha ao enviar mídia");
    else {
      await loadMessages(selected, true);
      await loadChats(true);
    }
  }

  async function startFlow(flowId: string) {
    if (!selected) return;
    await api("/api/inbox/start-flow", {
      method: "POST",
      body: JSON.stringify({
        chatId: selected.id,
        flowId,
        name: selected.name,
        isGroup: selected.isGroup
      })
    });
  }

  function toggleTag(tagId: string) {
    if (!selected) return;
    const current = selected.contact?.tags.map((t) => t.id) ?? [];
    const next = current.includes(tagId)
      ? current.filter((id) => id !== tagId)
      : [...current, tagId];
    void saveContactTags(selected, next);
  }

  const activeTags = selected?.contact?.tags ?? [];

  return (
    <div className="flex flex-1 min-h-0 w-full bg-[#0b141a] text-[#e9edef] overflow-hidden">
      <aside className="flex w-[393px] max-w-[38vw] min-w-[260px] shrink-0 flex-col border-r border-[#2a3942] bg-[#111b21] min-h-0">
        <header className="h-[59px] px-4 flex items-center gap-3 bg-[#202c33] shrink-0">
          <div className="h-10 w-10 rounded-full bg-[#6b7c85] flex items-center justify-center text-sm font-medium">
            Z
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-[#e9edef]">Conversas</div>
            <div className="text-xs text-[#8696a0] truncate">Zap · instância ativa</div>
          </div>
          <button
            type="button"
            onClick={() => loadChats()}
            className="text-xs text-[#8696a0] hover:text-[#00a884] shrink-0"
            title="Atualizar lista"
          >
            ↻
          </button>
          <Link
            to="/settings"
            className="text-xs text-[#00a884] hover:underline shrink-0"
            title="Configurações"
          >
            ⚙
          </Link>
        </header>

        <div className="flex gap-1 px-2 py-2 bg-[#111b21] border-b border-[#2a3942]/60 overflow-x-auto">
          {(Object.keys(TAB_LABELS) as ChatTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setChatTab(tab)}
              className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs transition ${
                chatTab === tab
                  ? "bg-[#00a884]/20 text-[#00a884]"
                  : "text-[#8696a0] hover:bg-[#202c33]"
              }`}
            >
              {TAB_LABELS[tab]}
              <span className="ml-1 opacity-70">{tabCounts[tab]}</span>
            </button>
          ))}
        </div>

        <div className="px-3 py-2 bg-[#111b21]">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar ou filtrar por tag"
            className="w-full rounded-lg bg-[#202c33] border-0 px-4 py-2 text-sm text-[#e9edef] placeholder:text-[#8696a0] focus:ring-1 focus:ring-[#00a884]"
          />
        </div>

        {error && (
          <div className="mx-3 mb-2 rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-200">
            {error}
            <Link to="/settings" className="block mt-1 text-[#00a884] underline">
              Configurações / QR
            </Link>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          {loadingChats && chats.length === 0 && (
            <p className="p-4 text-sm text-[#8696a0]">Carregando conversas…</p>
          )}
          {!loadingChats && filtered.length === 0 && (
            <div className="p-4 text-sm text-[#8696a0] space-y-2">
              <p>Nenhuma conversa nesta aba.</p>
              {error && (
                <p className="text-amber-200/90 text-xs leading-relaxed">{error}</p>
              )}
              <Link to="/settings" className="text-[#00a884] underline text-xs block">
                Abrir Configurações → Conexão / QR
              </Link>
            </div>
          )}
          {filtered.map((chat) => (
            <button
              key={chat.id}
              type="button"
              onClick={() => setSelected(chat)}
              className={`w-full flex gap-3 px-3 py-3 text-left hover:bg-[#202c33] transition border-b border-[#2a3942]/50 ${
                selected?.id === chat.id ? "bg-[#2a3942]" : ""
              }`}
            >
              <div className="h-12 w-12 shrink-0 rounded-full bg-[#6b7c85] flex items-center justify-center text-sm font-semibold text-white">
                {initials(chat.name)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex justify-between gap-2">
                  <span className="font-medium text-[#e9edef] truncate">{chat.name}</span>
                  <span className="text-xs text-[#8696a0] shrink-0">
                    {formatTime(chat.timestamp)}
                  </span>
                </div>
                <div className="flex justify-between gap-2 mt-0.5">
                  <span className="text-sm text-[#8696a0] truncate">{chat.lastMessage}</span>
                  {chat.unreadCount > 0 && (
                    <span className="shrink-0 min-w-[20px] h-5 px-1 rounded-full bg-[#00a884] text-[11px] font-semibold text-[#111b21] flex items-center justify-center">
                      {chat.unreadCount}
                    </span>
                  )}
                </div>
                {chat.contact?.tags && chat.contact.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {chat.contact.tags.map((t) => (
                      <span
                        key={t.id}
                        className="text-[10px] px-1.5 py-0.5 rounded text-white font-medium"
                        style={{ backgroundColor: t.color }}
                      >
                        {t.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      </aside>

      <section className="flex flex-1 flex-col min-w-0 min-h-0 bg-[#0b141a]">
        {!selected ? (
          <div className="flex flex-1 min-h-0 flex-col items-center justify-center text-center px-8 bg-[#222e35] border-b-[6px] border-[#00a884]">
            <div className="max-w-md">
              <h2 className="text-2xl font-light text-[#e9edef] mb-3">Zap Web</h2>
              <p className="text-sm text-[#8696a0] leading-relaxed">
                Abas: conversas 1:1, grupos e comunidades. Etiquetas, fluxos e mensagens rápidas.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 flex-col min-h-0 min-w-0">
            <header className="h-[59px] px-4 flex items-center gap-3 bg-[#202c33] shrink-0 border-l border-[#2a3942]">
              <div className="h-10 w-10 rounded-full bg-[#6b7c85] flex items-center justify-center text-sm font-semibold">
                {initials(selected.name)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{selected.name}</div>
                <div className="text-xs text-[#8696a0] truncate">
                  {TAB_LABELS[selected.kind]} · {selected.id}
                </div>
              </div>
              <button
                type="button"
                onClick={() => loadMessages(selected)}
                className="text-xs text-[#8696a0] hover:text-[#00a884]"
                title="Atualizar mensagens"
              >
                ↻
              </button>
              <select
                className="rounded-lg bg-[#2a3942] text-xs text-[#e9edef] px-2 py-1.5 max-w-[120px] border-0"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) {
                    void startFlow(e.target.value);
                    e.target.value = "";
                  }
                }}
              >
                <option value="">▶ Fluxo</option>
                {flows.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setShowTagForm((v) => !v)}
                className="rounded-lg bg-[#2a3942] px-2 py-1.5 text-xs hover:bg-[#374955]"
              >
                + Tag
              </button>
            </header>

            <div className="px-4 py-2 bg-[#111b21] border-b border-[#2a3942] flex flex-wrap gap-2 items-center">
              <span className="text-xs text-[#8696a0]">Etiquetas:</span>
              {tags.map((tag) => {
                const on = activeTags.some((t) => t.id === tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => toggleTag(tag.id)}
                    className={`text-xs px-2 py-1 rounded-full border transition ${
                      on ? "text-white border-transparent" : "border-[#3b4a54] text-[#8696a0]"
                    }`}
                    style={on ? { backgroundColor: tag.color } : undefined}
                  >
                    {tag.name}
                  </button>
                );
              })}
            </div>

            {showTagForm && (
              <div className="px-4 py-2 bg-[#202c33] border-b border-[#2a3942] flex flex-wrap gap-2 items-end">
                <input
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  placeholder="Nome da tag"
                  className="flex-1 min-w-[120px] rounded-lg bg-[#2a3942] px-3 py-1.5 text-sm border-0"
                />
                <input
                  type="color"
                  value={newTagColor}
                  onChange={(e) => setNewTagColor(e.target.value)}
                  className="h-9 w-12 rounded cursor-pointer"
                />
                <button
                  type="button"
                  onClick={() => void createTag()}
                  className="rounded-lg bg-[#00a884] px-3 py-1.5 text-sm font-semibold text-[#111b21]"
                >
                  Criar
                </button>
              </div>
            )}

            <div
              className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 sm:px-8 md:px-12 lg:px-20 py-4 space-y-1 border-l border-[#2a3942]/50"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.02'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`
              }}
            >
              {loadingMsgs && (
                <p className="text-center text-sm text-[#8696a0]">Carregando mensagens…</p>
              )}
              {!loadingMsgs && messages.length === 0 && (
                <p className="text-center text-sm text-[#8696a0] py-8 max-w-md mx-auto leading-relaxed">
                  {msgHint ||
                    "Sem histórico neste chat. Envie uma mensagem abaixo — ela deve aparecer aqui."}
                </p>
              )}
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex ${m.fromMe ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[min(65%,520px)] rounded-lg px-3 py-1.5 shadow-sm break-words ${
                      m.fromMe
                        ? "bg-[#005c4b] text-[#e9edef] rounded-tr-none"
                        : "bg-[#202c33] text-[#e9edef] rounded-tl-none"
                    }`}
                  >
                    <p className="text-sm whitespace-pre-wrap">{m.body || "—"}</p>
                    <div
                      className={`text-[10px] mt-0.5 text-right ${
                        m.fromMe ? "text-[#99beb7]" : "text-[#8696a0]"
                      }`}
                    >
                      {formatTime(m.timestamp)}
                    </div>
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            <InboxComposer
              draft={draft}
              onDraftChange={setDraft}
              onSendText={() => void sendMessage()}
              onSendMedia={(type, url, caption) => void sendMedia(type, url, caption)}
              quickReplies={quickReplies}
            />
          </div>
        )}
      </section>
    </div>
  );
}
