import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { InboxComposer, type QuickReply } from "./InboxComposer";
import { WaAudioPlayer } from "./WaAudioPlayer";
import { WhatsAppAvatar } from "./WhatsAppAvatar";

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
  mediaUrl?: string | null;
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

function isBase64Blob(text: string): boolean {
  const t = text.replace(/\s/g, "");
  return t.length > 80 && (/^data:/.test(t) || /^[A-Za-z0-9+/=]+$/.test(t.slice(0, 120)));
}

function mediaUrlFromMessage(m: Message): string | null {
  const direct = m.mediaUrl?.trim();
  if (direct) return direct;
  if (!isBase64Blob(m.body)) return null;
  if (m.body.startsWith("data:")) return m.body;
  const mime =
    m.type === "image" || m.type === "sticker"
      ? "image/jpeg"
      : m.type === "video"
        ? "video/mp4"
        : m.type === "audio" || m.type === "ptt"
          ? "audio/ogg"
          : "application/octet-stream";
  return `data:${mime};base64,${m.body.replace(/\s/g, "")}`;
}

const InboxMessageContent = memo(function InboxMessageContent({
  message: m
}: {
  message: Message;
}) {
  const url = mediaUrlFromMessage(m);
  const showCaption =
    m.body &&
    !isBase64Blob(m.body) &&
    !m.body.startsWith("📷") &&
    !m.body.startsWith("🎤") &&
    !m.body.startsWith("🎬");
  const isMedia =
    url &&
    (m.type === "image" ||
      m.type === "sticker" ||
      m.type === "video" ||
      m.type === "audio" ||
      m.type === "ptt");

  if (isMedia && (m.type === "image" || m.type === "sticker")) {
    return (
      <div className="space-y-1">
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          className="max-w-full rounded-xl max-h-72 object-contain"
        />
        {showCaption && <p className="text-sm whitespace-pre-wrap">{m.body}</p>}
      </div>
    );
  }
  if (isMedia && m.type === "video") {
    return (
      <div className="space-y-1">
        <video
          src={url}
          controls
          preload="metadata"
          playsInline
          className="wa-video w-full min-w-[240px] max-w-[min(100%,360px)] rounded-xl max-h-80 bg-black/40"
        />
        {showCaption && <p className="text-sm whitespace-pre-wrap">{m.body}</p>}
      </div>
    );
  }
  if (isMedia && (m.type === "audio" || m.type === "ptt")) {
    return (
      <div className="space-y-1">
        <WaAudioPlayer src={url} fromMe={m.fromMe} />
        {showCaption && <p className="text-sm whitespace-pre-wrap">{m.body}</p>}
      </div>
    );
  }
  if (url && m.type === "document") {
    return (
      <div className="space-y-1">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-sm text-[#53bdeb] hover:underline"
        >
          <span aria-hidden>📎</span>
          {m.body && !m.body.startsWith("📎") ? m.body : "Abrir documento"}
        </a>
      </div>
    );
  }
  return <p className="text-sm whitespace-pre-wrap">{m.body || "—"}</p>;
});

function mergePendingMessages(server: Message[], pending: Message[]): Message[] {
  if (pending.length === 0) return server;
  const merged = [...server];
  for (const p of pending) {
    const duplicated = server.some(
      (m) =>
        m.fromMe === p.fromMe &&
        m.body === p.body &&
        Math.abs(m.timestamp - p.timestamp) < 120_000
    );
    if (!duplicated) merged.push(p);
  }
  return merged.sort((a, b) => a.timestamp - b.timestamp);
}

function isOptimisticMessageId(id: string): boolean {
  return id.startsWith("opt-");
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

const ChatListRow = memo(function ChatListRow({
  chat,
  active,
  onSelect
}: {
  chat: Chat;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`wa-chat-row w-full flex gap-3 px-3 py-2.5 text-left hover:bg-[#202c33] border-b border-[#2a3942]/40 ${
        active ? "bg-[#2a3942]" : ""
      }`}
    >
      <WhatsAppAvatar chatId={chat.id} isGroup={chat.isGroup} name={chat.name} size={49} />
      <div className="flex-1 min-w-0">
        <div className="flex justify-between gap-2">
          <span className="font-medium text-[#e9edef] truncate text-[15px]">{chat.name}</span>
          <span className="text-[11px] text-[#8696a0] shrink-0">{formatTime(chat.timestamp)}</span>
        </div>
        <div className="flex justify-between gap-2 mt-0.5">
          <span className="text-[13px] text-[#8696a0] truncate">{chat.lastMessage}</span>
          {chat.unreadCount > 0 && (
            <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-[#00a884] text-[10px] font-semibold text-[#111b21] flex items-center justify-center">
              {chat.unreadCount}
            </span>
          )}
        </div>
        {chat.contact?.tags && chat.contact.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {chat.contact.tags.slice(0, 2).map((t) => (
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
  );
});

const MessageRow = memo(function MessageRow({ message: m }: { message: Message }) {
  return (
    <div className={`flex py-0.5 ${m.fromMe ? "justify-end" : "justify-start"}`}>
      <div
        className={`wa-bubble max-w-[min(78%,420px)] px-3 py-1.5 break-words ${
          m.fromMe ? "wa-bubble-out" : "wa-bubble-in"
        }`}
      >
        <InboxMessageContent message={m} />
        <div
          className={`text-[10px] mt-0.5 text-right ${
            m.fromMe ? "text-[#99beb7]" : "text-[#8696a0]"
          }`}
        >
          {formatTime(m.timestamp)}
        </div>
      </div>
    </div>
  );
});

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
  const [sendError, setSendError] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastMsgCountRef = useRef(0);

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
      const next = r.messages ?? [];
      setMessages((prev) => {
        const pending = prev.filter((m) => isOptimisticMessageId(m.id));
        const merged = mergePendingMessages(next, pending);
        if (
          prev.length === merged.length &&
          prev.length > 0 &&
          prev[prev.length - 1]?.id === merged[merged.length - 1]?.id &&
          prev[prev.length - 1]?.mediaUrl === merged[merged.length - 1]?.mediaUrl
        ) {
          return prev;
        }
        return merged;
      });
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
    const t = setInterval(() => loadChats(true), 90000);
    return () => clearInterval(t);
  }, [pageVisible, loadChats]);

  useEffect(() => {
    if (!selected || !pageVisible) return;
    loadMessages(selected);
    const t = setInterval(() => loadMessages(selected, true), 2500);
    return () => clearInterval(t);
  }, [selected, pageVisible, loadMessages]);

  useEffect(() => {
    if (messages.length > lastMsgCountRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
    }
    lastMsgCountRef.current = messages.length;
  }, [messages.length]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return chats.filter((c) => {
      if (chatTab !== "all" && c.kind !== chatTab) return false;
      if (!q) return true;
      const tagStr = c.contact?.tags.map((t) => t.name).join(" ") ?? "";
      return (
        c.name.toLowerCase().includes(q) ||
        c.phone.includes(q) ||
        c.id.toLowerCase().includes(q) ||
        tagStr.toLowerCase().includes(q)
      );
    });
  }, [chats, chatTab, search]);

  const tabCounts = useMemo(
    () => ({
      all: chats.length,
      direct: chats.filter((c) => c.kind === "direct").length,
      group: chats.filter((c) => c.kind === "group").length,
      community: chats.filter((c) => c.kind === "community").length
    }),
    [chats]
  );

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
    const text = draft.trim();
    const optimisticId = `opt-${Date.now()}`;
    setSendError("");
    setDraft("");

    const optimistic: Message = {
      id: optimisticId,
      body: text,
      fromMe: true,
      timestamp: Date.now(),
      type: "chat"
    };
    setMessages((prev) => [...prev, optimistic]);

    try {
      const r = await api<{ ok: boolean; message?: string }>("/api/inbox/send", {
        method: "POST",
        body: JSON.stringify({
          chatId: selected.id,
          message: text,
          isGroup: selected.isGroup
        })
      });
      if (!r.ok) {
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
        setDraft(text);
        setSendError(r.message ?? "Falha ao enviar");
        return;
      }
      void loadMessages(selected, true);
      void loadChats(true);
    } catch (e: any) {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      setDraft(text);
      setSendError(e?.message ?? "Erro ao enviar");
    }
  }

  async function sendMedia(
    type: "image" | "video" | "audio" | "document",
    url: string,
    caption?: string,
    filename?: string
  ) {
    if (!selected) return;
    const r = await api<{ ok: boolean; message?: string }>("/api/inbox/send-media", {
      method: "POST",
      body: JSON.stringify({
        chatId: selected.id,
        type,
        url,
        caption,
        filename,
        isGroup: selected.isGroup
      })
    });
    if (!r.ok) setSendError(r.message ?? "Falha ao enviar mídia");
    else {
      setSendError("");
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

  const visibleMessages = useMemo(() => {
    const max = 80;
    if (messages.length <= max) return messages;
    return messages.slice(-max);
  }, [messages]);

  return (
    <div className="wa-inbox flex flex-1 min-h-0 w-full bg-[var(--wa-bg-app)] text-[var(--wa-text-primary)] overflow-hidden">
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
            <ChatListRow
              key={chat.id}
              chat={chat}
              active={selected?.id === chat.id}
              onSelect={() => {
                setSelected(chat);
                setSendError("");
              }}
            />
          ))}
        </div>
      </aside>

      <section className="flex flex-1 flex-col min-w-0 min-h-0 bg-[#0b141a]">
        {!selected ? (
          <div className="flex flex-1 min-h-0 flex-col items-center justify-center text-center px-8 bg-[#222e35] border-b-[6px] border-[var(--wa-accent)]">
            <div className="max-w-md">
              <div
                className="mx-auto mb-6 h-24 w-24 rounded-full border-2 border-[var(--wa-border)] flex items-center justify-center text-[var(--wa-text-secondary)]"
                aria-hidden
              >
                <svg viewBox="0 0 24 24" className="w-12 h-12" fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15v-4H8v-2h3V9h2v4h3v2h-3v4h-2z" />
                </svg>
              </div>
              <h2 className="text-[32px] font-light text-[var(--wa-text-primary)] mb-3 leading-tight">
                Zap Web
              </h2>
              <p className="text-sm text-[var(--wa-text-secondary)] leading-relaxed">
                Envie e receba mensagens, mídia e áudio. Selecione uma conversa à esquerda — layout
                inspirado no WhatsApp Web.
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 flex-col min-h-0 min-w-0">
            <header className="h-[52px] px-3 flex items-center gap-3 bg-[#202c33] shrink-0 border-l border-[#2a3942]">
              <WhatsAppAvatar
                chatId={selected.id}
                isGroup={selected.isGroup}
                name={selected.name}
                size={40}
              />
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{selected.name}</div>
                <div className="text-xs text-[#8696a0] truncate">
                  {TAB_LABELS[selected.kind]}
                  {selected.phone ? ` · ${selected.phone}` : ""}
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

            <div className="px-3 py-1.5 bg-[#111b21] border-b border-[#2a3942]/60 flex flex-wrap gap-1.5 items-center max-h-[72px] overflow-y-auto">
              <span className="text-[11px] text-[#8696a0]">Tags:</span>
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

            <div className="wa-chat-bg flex-1 min-h-0 overflow-y-auto overscroll-contain px-2 sm:px-6 md:px-10 py-3 space-y-0.5 border-l border-[var(--wa-border)]/30">
              {loadingMsgs && messages.length === 0 && (
                <p className="text-center text-sm text-[#8696a0]">Carregando mensagens…</p>
              )}
              {!loadingMsgs && visibleMessages.length === 0 && (
                <p className="text-center text-sm text-[#8696a0] py-8 max-w-md mx-auto leading-relaxed">
                  {msgHint ||
                    "Sem mensagens desde a conexão. O Zap não importa histórico antigo — novas mensagens (recebidas e enviadas) aparecem aqui."}
                </p>
              )}
              {messages.length > visibleMessages.length && (
                <p className="text-center text-[11px] text-[#8696a0] py-1">
                  Exibindo as {visibleMessages.length} mensagens mais recentes
                </p>
              )}
              {visibleMessages.map((m) => (
                <MessageRow key={m.id} message={m} />
              ))}
              <div ref={messagesEndRef} />
            </div>

            {sendError && (
              <p className="mx-3 mb-1 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
                {sendError}
              </p>
            )}
            <InboxComposer
              draft={draft}
              onDraftChange={setDraft}
              onSendText={() => void sendMessage()}
              onSendMedia={(type, url, caption, filename) =>
                void sendMedia(type, url, caption, filename)
              }
              quickReplies={quickReplies}
            />
          </div>
        )}
      </section>
    </div>
  );
}
