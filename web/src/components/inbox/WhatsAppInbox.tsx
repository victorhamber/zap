import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { InboxComposer } from "./InboxComposer";
import type { QuickReply, QuickReplyKind } from "../../types/quickReply";
import { WaAudioPlayer } from "./WaAudioPlayer";
import { WaMediaViewer } from "./WaMediaViewer";
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

type SessionProfile = {
  instanceName: string;
  profileName: string | null;
  profilePictureUrl: string | null;
  phone: string | null;
  connected: boolean;
};

function formatPhoneDisplay(phone: string | null | undefined): string {
  if (!phone) return "";
  const d = phone.replace(/\D/g, "");
  if (d.length === 13 && d.startsWith("55")) {
    return `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 9)}-${d.slice(9)}`;
  }
  if (d.length === 12 && d.startsWith("55")) {
    return `+${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 8)}-${d.slice(8)}`;
  }
  return d.startsWith("55") ? `+${d}` : d;
}

function sessionInitials(name: string): string {
  const p = name.trim().split(/\s+/);
  if (p.length >= 2) return (p[0][0] + p[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function IconRefresh({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08a5.99 5.99 0 01-5.65 4c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
    </svg>
  );
}

function IconSettings({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58a.49.49 0 00.12-.61l-1.92-3.32a.488.488 0 00-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 00-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.488.488 0 00-.59.22L2.74 8.87a.49.49 0 00.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.49.49 0 00-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32a.49.49 0 00-.12-.61l-2.01-1.58zM12 15.6A3.6 3.6 0 1112 8.4a3.6 3.6 0 010 7.2z" />
    </svg>
  );
}

function IconPlay({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M8 5v14l11-7L8 5z" />
    </svg>
  );
}

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
    const caption = showCaption ? m.body : undefined;
    return (
      <div className="space-y-1 -mx-0.5">
        <WaMediaViewer src={url} kind={m.type === "sticker" ? "sticker" : "image"} caption={caption} />
        {showCaption && <p className="text-sm whitespace-pre-wrap px-0.5">{m.body}</p>}
      </div>
    );
  }
  if (isMedia && m.type === "video") {
    const caption = showCaption ? m.body : undefined;
    return (
      <div className="space-y-1 -mx-0.5">
        <WaMediaViewer src={url} kind="video" caption={caption} />
        {showCaption && <p className="text-sm whitespace-pre-wrap px-0.5">{m.body}</p>}
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
  const isVisualMedia =
    m.type === "image" || m.type === "sticker" || m.type === "video" || m.type === "audio" || m.type === "ptt";
  return (
    <div className={`flex py-0.5 ${m.fromMe ? "justify-end" : "justify-start"}`}>
      <div
        className={`wa-bubble break-words ${
          isVisualMedia ? "max-w-[min(88%,480px)] px-1.5 py-1" : "max-w-[min(78%,420px)] px-3 py-1.5"
        } ${m.fromMe ? "wa-bubble-out" : "wa-bubble-in"}`}
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
  const [showTagManager, setShowTagManager] = useState(false);
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [editTagName, setEditTagName] = useState("");
  const [editTagColor, setEditTagColor] = useState("#25D366");
  const [sessionProfile, setSessionProfile] = useState<SessionProfile | null>(null);
  const [flowMenuOpen, setFlowMenuOpen] = useState(false);
  const [flowNotice, setFlowNotice] = useState("");
  const flowMenuRef = useRef<HTMLDivElement>(null);
  const [showQuickReplyManager, setShowQuickReplyManager] = useState(false);
  const [newQrTitle, setNewQrTitle] = useState("");
  const [newQrColor, setNewQrColor] = useState("#53bdeb");
  const [newQrKind, setNewQrKind] = useState<QuickReplyKind>("text");
  const [newQrText, setNewQrText] = useState("");
  const [newQrMediaUrl, setNewQrMediaUrl] = useState("");
  const [newQrFilename, setNewQrFilename] = useState("");
  const [editingQrId, setEditingQrId] = useState<string | null>(null);
  const [editQrTitle, setEditQrTitle] = useState("");
  const [editQrColor, setEditQrColor] = useState("#53bdeb");
  const [editQrKind, setEditQrKind] = useState<QuickReplyKind>("text");
  const [editQrText, setEditQrText] = useState("");
  const [editQrMediaUrl, setEditQrMediaUrl] = useState("");
  const [editQrFilename, setEditQrFilename] = useState("");
  const [qrUploading, setQrUploading] = useState(false);
  const qrFileRef = useRef<HTMLInputElement>(null);
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

  const loadSessionProfile = useCallback(async () => {
    try {
      const r = await api<{ ok: boolean; profile: SessionProfile | null }>("/api/inbox/session-profile");
      if (r.profile) setSessionProfile(r.profile);
    } catch {
      /* opcional */
    }
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
    void loadSessionProfile();
  }, [loadTags, loadFlows, loadQuickReplies, loadChats, loadSessionProfile]);

  useEffect(() => {
    if (!flowMenuOpen) return;
    const close = (e: MouseEvent) => {
      if (flowMenuRef.current && !flowMenuRef.current.contains(e.target as Node)) {
        setFlowMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [flowMenuOpen]);

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
    await loadTags();
  }

  async function updateTag(id: string) {
    const name = editTagName.trim();
    if (!name) return;
    await api(`/api/tags/${id}`, {
      method: "PUT",
      body: JSON.stringify({ name, color: editTagColor })
    });
    setEditingTagId(null);
    await loadTags();
    await loadChats(true);
    if (selected) {
      const r = await api<{ ok: boolean; chats: Chat[] }>("/api/inbox/chats");
      const updated = r.chats?.find((c) => c.id === selected.id);
      if (updated) setSelected(updated);
    }
  }

  async function deleteTag(tag: Tag) {
    if (!window.confirm(`Excluir a tag "${tag.name}"? Ela será removida de todos os contatos.`)) {
      return;
    }
    await api(`/api/tags/${tag.id}`, { method: "DELETE" });
    if (editingTagId === tag.id) setEditingTagId(null);
    await loadTags();
    await loadChats(true);
    if (selected) {
      const r = await api<{ ok: boolean; chats: Chat[] }>("/api/inbox/chats");
      const updated = r.chats?.find((c) => c.id === selected.id);
      if (updated) setSelected(updated);
    }
  }

  function startEditTag(tag: Tag) {
    setEditingTagId(tag.id);
    setEditTagName(tag.name);
    setEditTagColor(tag.color);
    setShowTagManager(true);
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
    setFlowMenuOpen(false);
    setFlowNotice("");
    const flow = flows.find((f) => f.id === flowId);
    try {
      const r = await api<{ ok: boolean; message?: string; error?: string }>("/api/inbox/start-flow", {
        method: "POST",
        body: JSON.stringify({
          chatId: selected.id,
          flowId,
          name: selected.name,
          isGroup: selected.isGroup
        })
      });
      if (r.ok) {
        setFlowNotice(`Fluxo "${flow?.name ?? "automação"}" iniciado para ${selected.name}.`);
        setSendError("");
      } else {
        setSendError(r.message ?? r.error ?? "Falha ao iniciar fluxo");
      }
    } catch (e: unknown) {
      setSendError(e instanceof Error ? e.message : "Erro ao iniciar fluxo");
    }
  }

  function resetNewQuickReplyForm() {
    setNewQrTitle("");
    setNewQrColor("#53bdeb");
    setNewQrKind("text");
    setNewQrText("");
    setNewQrMediaUrl("");
    setNewQrFilename("");
  }

  async function persistQuickReplies(replies: QuickReply[]) {
    const r = await api<{ ok: boolean; replies: QuickReply[] }>("/api/inbox/quick-replies", {
      method: "PUT",
      body: JSON.stringify({ replies })
    });
    setQuickReplies(r.replies ?? replies);
  }

  async function uploadQuickReplyFile(file: File): Promise<{ url: string; filename: string }> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        void (async () => {
          try {
            const r = await api<{ ok: boolean; url?: string; message?: string }>("/api/inbox/upload", {
              method: "POST",
              body: JSON.stringify({ data: reader.result as string, mime: file.type })
            });
            if (!r.ok || !r.url) throw new Error(r.message ?? "Falha no upload");
            resolve({ url: r.url, filename: file.name });
          } catch (e) {
            reject(e);
          }
        })();
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  async function createQuickReply() {
    const title = newQrTitle.trim();
    if (!title) return;
    if (newQrKind === "text" && !newQrText.trim()) return;
    if (newQrKind !== "text" && !newQrMediaUrl) return;

    const item: QuickReply = {
      id: `qr-${Date.now()}`,
      title,
      color: newQrColor,
      kind: newQrKind,
      text: newQrText.trim(),
      mediaUrl: newQrMediaUrl,
      filename: newQrFilename,
      useCount: 0,
      lastUsedAt: 0
    };
    await persistQuickReplies([...quickReplies, item]);
    resetNewQuickReplyForm();
  }

  function startEditQuickReply(q: QuickReply) {
    setEditingQrId(q.id);
    setEditQrTitle(q.title);
    setEditQrColor(q.color);
    setEditQrKind(q.kind);
    setEditQrText(q.text);
    setEditQrMediaUrl(q.mediaUrl);
    setEditQrFilename(q.filename);
    setShowQuickReplyManager(true);
  }

  async function updateQuickReply(id: string) {
    const title = editQrTitle.trim();
    if (!title) return;
    const next = quickReplies.map((q) =>
      q.id === id
        ? {
            ...q,
            title,
            color: editQrColor,
            kind: editQrKind,
            text: editQrText.trim(),
            mediaUrl: editQrMediaUrl,
            filename: editQrFilename
          }
        : q
    );
    await persistQuickReplies(next);
    setEditingQrId(null);
  }

  async function deleteQuickReply(q: QuickReply) {
    if (!window.confirm(`Excluir resposta rápida "${q.title}"?`)) return;
    await persistQuickReplies(quickReplies.filter((r) => r.id !== q.id));
    if (editingQrId === q.id) setEditingQrId(null);
  }

  async function applyQuickReply(reply: QuickReply) {
    try {
      const r = await api<{ ok: boolean; replies: QuickReply[] }>(
        `/api/inbox/quick-replies/${encodeURIComponent(reply.id)}/use`,
        { method: "POST" }
      );
      if (r.replies) setQuickReplies(r.replies);
    } catch {
      /* continua mesmo se falhar contador */
    }

    if (reply.kind === "text" || !reply.mediaUrl) {
      setDraft(reply.text);
      return;
    }
    await sendMedia(
      reply.kind,
      reply.mediaUrl,
      reply.text || undefined,
      reply.filename || undefined
    );
  }

  async function handleQuickReplyFilePick(e: React.ChangeEvent<HTMLInputElement>, editing: boolean) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setQrUploading(true);
    try {
      const { url, filename } = await uploadQuickReplyFile(file);
      const mime = file.type || "";
      let kind: QuickReplyKind = "document";
      if (mime.startsWith("image/")) kind = "image";
      else if (mime.startsWith("video/")) kind = "video";
      else if (mime.startsWith("audio/")) kind = "audio";

      if (editing) {
        setEditQrMediaUrl(url);
        setEditQrFilename(filename);
        setEditQrKind(kind);
      } else {
        setNewQrMediaUrl(url);
        setNewQrFilename(filename);
        setNewQrKind(kind);
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Erro ao enviar arquivo");
    } finally {
      setQrUploading(false);
    }
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
        <header className="h-[59px] px-3 flex items-center gap-3 bg-[#202c33] shrink-0">
          <div className="h-11 w-11 rounded-full bg-[#6b7c85] flex items-center justify-center overflow-hidden shrink-0">
            {sessionProfile?.profilePictureUrl ? (
              <img
                src={sessionProfile.profilePictureUrl}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="text-sm font-semibold text-white">
                {sessionInitials(sessionProfile?.profileName ?? sessionProfile?.instanceName ?? "Z")}
              </span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-[#e9edef] truncate text-[15px]">
              {sessionProfile?.profileName ?? "WhatsApp conectado"}
            </div>
            <div className="text-xs text-[#8696a0] truncate">
              {sessionProfile?.connected ? "Conectado" : "Desconectado"}
              {sessionProfile?.instanceName ? ` · ${sessionProfile.instanceName}` : ""}
              {sessionProfile?.phone ? ` · ${formatPhoneDisplay(sessionProfile.phone)}` : ""}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              void loadChats();
              void loadSessionProfile();
            }}
            className="p-2.5 rounded-full text-[#aebac1] hover:text-[#00a884] hover:bg-[#374955] shrink-0 transition-colors"
            title="Atualizar conversas"
          >
            <IconRefresh />
          </button>
          <Link
            to="/settings"
            className="p-2.5 rounded-full text-[#aebac1] hover:text-[#00a884] hover:bg-[#374955] shrink-0 transition-colors"
            title="Configurações"
          >
            <IconSettings />
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
                setSelected({ ...chat, unreadCount: 0 });
                setChats((prev) =>
                  prev.map((c) => (c.id === chat.id ? { ...c, unreadCount: 0 } : c))
                );
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
                className="p-2 rounded-full text-[#aebac1] hover:text-[#00a884] hover:bg-[#374955] shrink-0"
                title="Atualizar mensagens"
              >
                <IconRefresh className="w-[18px] h-[18px]" />
              </button>
              <div className="relative shrink-0" ref={flowMenuRef}>
                <button
                  type="button"
                  onClick={() => setFlowMenuOpen((v) => !v)}
                  className="flex items-center gap-1.5 rounded-lg bg-[#2a3942] px-3 py-2 text-xs text-[#e9edef] hover:bg-[#374955] min-w-[96px]"
                  title="Iniciar fluxo de automação para este contato"
                >
                  <IconPlay />
                  <span>Fluxo</span>
                  <span className="opacity-60">▾</span>
                </button>
                {flowMenuOpen && (
                  <div className="absolute right-0 top-full mt-1 z-30 min-w-[220px] max-w-[280px] rounded-xl bg-[#233138] border border-[#3b4a54]/70 shadow-2xl py-1 overflow-hidden">
                    <p className="px-3 py-2 text-[11px] text-[#8696a0] border-b border-[#3b4a54]/50">
                      Adicionar {selected.name} a um fluxo
                    </p>
                    {flows.length === 0 ? (
                      <p className="px-3 py-3 text-xs text-[#8696a0]">
                        Nenhum fluxo ativo. Crie e ative em Automações.
                      </p>
                    ) : (
                      flows.map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => void startFlow(f.id)}
                          className="w-full text-left px-3 py-2.5 text-sm text-[#e9edef] hover:bg-[#2a3942] truncate"
                        >
                          {f.name}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setShowQuickReplyManager((v) => !v);
                  setShowTagManager(false);
                }}
                className="rounded-lg bg-[#2a3942] px-3 py-2 text-xs hover:bg-[#374955] shrink-0"
                title="Criar e gerenciar respostas rápidas"
              >
                Respostas
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowTagManager((v) => !v);
                  setShowQuickReplyManager(false);
                }}
                className="rounded-lg bg-[#2a3942] px-3 py-2 text-xs hover:bg-[#374955] shrink-0"
              >
                Tags
              </button>
            </header>

            {flowNotice && (
              <div className="px-3 py-1.5 bg-[#00a884]/10 border-b border-[#00a884]/30 text-xs text-[#53bdeb]">
                {flowNotice}
              </div>
            )}

            <div className="px-3 py-1.5 bg-[#111b21] border-b border-[#2a3942]/60 flex flex-wrap gap-1.5 items-center max-h-[72px] overflow-y-auto">
              <span className="text-[11px] text-[#8696a0]">Tags do contato:</span>
              {tags.length === 0 && (
                <span className="text-[11px] text-[#8696a0]">Nenhuma tag criada</span>
              )}
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
                    title={on ? "Remover tag do contato" : "Aplicar tag ao contato"}
                  >
                    {tag.name}
                  </button>
                );
              })}
            </div>

            {showTagManager && (
              <div className="px-4 py-3 bg-[#202c33] border-b border-[#2a3942] space-y-3">
                <div className="flex flex-wrap gap-2 items-end">
                  <input
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    placeholder="Nova tag"
                    className="flex-1 min-w-[120px] rounded-lg bg-[#2a3942] px-3 py-2 text-sm border-0"
                  />
                  <input
                    type="color"
                    value={newTagColor}
                    onChange={(e) => setNewTagColor(e.target.value)}
                    className="h-10 w-12 rounded cursor-pointer"
                    title="Cor da tag"
                  />
                  <button
                    type="button"
                    onClick={() => void createTag()}
                    className="rounded-lg bg-[#00a884] px-4 py-2 text-sm font-semibold text-[#111b21]"
                  >
                    Criar
                  </button>
                </div>
                <div className="space-y-2 max-h-40 overflow-y-auto">
                  <p className="text-[11px] text-[#8696a0] uppercase tracking-wide">Gerenciar tags</p>
                  {tags.map((tag) =>
                    editingTagId === tag.id ? (
                      <div key={tag.id} className="flex flex-wrap gap-2 items-center">
                        <input
                          value={editTagName}
                          onChange={(e) => setEditTagName(e.target.value)}
                          className="flex-1 min-w-[100px] rounded-lg bg-[#2a3942] px-3 py-1.5 text-sm border-0"
                        />
                        <input
                          type="color"
                          value={editTagColor}
                          onChange={(e) => setEditTagColor(e.target.value)}
                          className="h-9 w-10 rounded cursor-pointer"
                        />
                        <button
                          type="button"
                          onClick={() => void updateTag(tag.id)}
                          className="rounded-lg bg-[#00a884] px-3 py-1.5 text-xs font-semibold text-[#111b21]"
                        >
                          Salvar
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingTagId(null)}
                          className="rounded-lg px-3 py-1.5 text-xs text-[#8696a0] hover:bg-[#374955]"
                        >
                          Cancelar
                        </button>
                      </div>
                    ) : (
                      <div
                        key={tag.id}
                        className="flex items-center gap-2 rounded-lg bg-[#2a3942]/60 px-2 py-1.5"
                      >
                        <span
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ backgroundColor: tag.color }}
                        />
                        <span className="flex-1 text-sm truncate">{tag.name}</span>
                        <button
                          type="button"
                          onClick={() => startEditTag(tag)}
                          className="text-xs text-[#53bdeb] hover:underline px-1"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteTag(tag)}
                          className="text-xs text-[#ea0038] hover:underline px-1"
                        >
                          Excluir
                        </button>
                      </div>
                    )
                  )}
                </div>
              </div>
            )}

            {showQuickReplyManager && (
              <div className="px-4 py-3 bg-[#202c33] border-b border-[#2a3942] space-y-3">
                <p className="text-[11px] text-[#8696a0] uppercase tracking-wide">
                  Respostas rápidas — clique no badge abaixo da mensagem para usar
                </p>
                <input ref={qrFileRef} type="file" className="hidden" accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt" onChange={(e) => void handleQuickReplyFilePick(e, false)} />
                <div className="flex flex-wrap gap-2 items-end">
                  <input
                    value={newQrTitle}
                    onChange={(e) => setNewQrTitle(e.target.value)}
                    placeholder="Nome (ex.: Teste, Link compra)"
                    className="min-w-[140px] flex-1 rounded-lg bg-[#2a3942] px-3 py-2 text-sm border-0"
                  />
                  <select
                    value={newQrKind}
                    onChange={(e) => setNewQrKind(e.target.value as QuickReplyKind)}
                    className="rounded-lg bg-[#2a3942] px-3 py-2 text-sm border-0"
                  >
                    <option value="text">Texto</option>
                    <option value="image">Imagem</option>
                    <option value="video">Vídeo</option>
                    <option value="audio">Áudio</option>
                    <option value="document">Documento</option>
                  </select>
                  <input
                    type="color"
                    value={newQrColor}
                    onChange={(e) => setNewQrColor(e.target.value)}
                    className="h-10 w-12 rounded cursor-pointer"
                    title="Cor do badge"
                  />
                </div>
                {newQrKind === "text" ? (
                  <textarea
                    value={newQrText}
                    onChange={(e) => setNewQrText(e.target.value)}
                    placeholder="Texto da resposta pronta"
                    rows={2}
                    className="w-full rounded-lg bg-[#2a3942] px-3 py-2 text-sm border-0 resize-none"
                  />
                ) : (
                  <div className="flex flex-wrap gap-2 items-center">
                    <button
                      type="button"
                      disabled={qrUploading}
                      onClick={() => qrFileRef.current?.click()}
                      className="rounded-lg bg-[#374955] px-3 py-2 text-xs hover:bg-[#455a64]"
                    >
                      {qrUploading ? "Enviando…" : "Anexar arquivo"}
                    </button>
                    {newQrMediaUrl && (
                      <span className="text-xs text-[#8696a0] truncate max-w-[200px]">
                        {newQrFilename || "Arquivo anexado"}
                      </span>
                    )}
                    <input
                      value={newQrText}
                      onChange={(e) => setNewQrText(e.target.value)}
                      placeholder="Legenda (opcional)"
                      className="flex-1 min-w-[120px] rounded-lg bg-[#2a3942] px-3 py-2 text-sm border-0"
                    />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => void createQuickReply()}
                  className="rounded-lg bg-[#00a884] px-4 py-2 text-sm font-semibold text-[#111b21]"
                >
                  Salvar resposta
                </button>
                <div className="space-y-2 max-h-44 overflow-y-auto">
                  {quickReplies.map((q) =>
                    editingQrId === q.id ? (
                      <div key={q.id} className="rounded-lg bg-[#2a3942]/60 p-2 space-y-2">
                        <div className="flex flex-wrap gap-2">
                          <input
                            value={editQrTitle}
                            onChange={(e) => setEditQrTitle(e.target.value)}
                            className="flex-1 min-w-[100px] rounded-lg bg-[#2a3942] px-3 py-1.5 text-sm border-0"
                          />
                          <input
                            type="color"
                            value={editQrColor}
                            onChange={(e) => setEditQrColor(e.target.value)}
                            className="h-9 w-10 rounded cursor-pointer"
                          />
                        </div>
                        {editQrKind === "text" ? (
                          <textarea
                            value={editQrText}
                            onChange={(e) => setEditQrText(e.target.value)}
                            rows={2}
                            className="w-full rounded-lg bg-[#2a3942] px-3 py-1.5 text-sm border-0"
                          />
                        ) : (
                          <p className="text-xs text-[#8696a0]">{editQrFilename || "Mídia anexada"}</p>
                        )}
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => void updateQuickReply(q.id)}
                            className="rounded-lg bg-[#00a884] px-3 py-1.5 text-xs font-semibold text-[#111b21]"
                          >
                            Salvar
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingQrId(null)}
                            className="rounded-lg px-3 py-1.5 text-xs text-[#8696a0]"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div
                        key={q.id}
                        className="flex items-center gap-2 rounded-lg bg-[#2a3942]/60 px-2 py-1.5"
                      >
                        <span
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ backgroundColor: q.color }}
                        />
                        <span className="flex-1 text-sm truncate">{q.title}</span>
                        <span className="text-[10px] text-[#8696a0]">{q.useCount}x</span>
                        <button
                          type="button"
                          onClick={() => startEditQuickReply(q)}
                          className="text-xs text-[#53bdeb] hover:underline px-1"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteQuickReply(q)}
                          className="text-xs text-[#ea0038] hover:underline px-1"
                        >
                          Excluir
                        </button>
                      </div>
                    )
                  )}
                </div>
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
              onUseQuickReply={(reply) => applyQuickReply(reply)}
            />
          </div>
        )}
      </section>
    </div>
  );
}
