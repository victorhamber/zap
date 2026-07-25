import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";
import { InboxComposer } from "./InboxComposer";
import type { QuickReply, QuickReplyKind } from "../../types/quickReply";
import { WaAudioPlayer } from "./WaAudioPlayer";
import { WaMediaViewer } from "./WaMediaViewer";
import { WhatsAppAvatar } from "./WhatsAppAvatar";
import { ForwardMessageModal } from "./ForwardMessageModal";
import { ContactProfilePanel } from "./ContactProfilePanel";
import { LinkifyText } from "./LinkifyText";

type Tag = { id: string; name: string; color: string };
type ChatKind = "direct" | "group" | "community";
type ChatTab = "all" | "direct" | "group";

type ContactInfo = {
  id: string;
  phone: string;
  name: string | null;
  notes?: string | null;
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
  group: "Grupos"
};

function chatKindLabel(kind: ChatKind): string {
  if (kind === "direct") return "Conversas";
  return "Grupos";
}

function chatMatchesTab(kind: ChatKind, tab: ChatTab): boolean {
  if (tab === "all") return true;
  if (tab === "direct") return kind === "direct";
  return kind === "group" || kind === "community";
}

function sanitizeChatName(name: string, kind: ChatKind): string {
  const t = name.trim();
  if (!t || t === "[object Object]") {
    if (kind === "community") return "Comunidade";
    if (kind === "group") return "Grupo";
    return "Contato";
  }
  const digits = t.replace(/\D/g, "");
  if (kind === "direct" && digits.length >= 10 && digits.length <= 15 && /^\d+$/.test(digits)) {
    return formatPhoneDisplay(digits);
  }
  return t;
}

type SessionProfile = {
  instanceName: string;
  profileName: string | null;
  profilePictureUrl: string | null;
  phone: string | null;
  connected: boolean;
};

function canonicalBrazilPhone(d: string): string {
  const digits = d.replace(/\D/g, "");
  if (!digits.startsWith("55")) return digits;
  const local = digits.slice(2);
  if (local.length === 11 && local[2] === "9") return digits;
  if (local.length === 10) {
    const subscriber = local.slice(2);
    if (subscriber.length === 8 && /^[6-9]/.test(subscriber)) {
      return `55${local.slice(0, 2)}9${subscriber}`;
    }
  }
  return digits;
}

function formatPhoneDisplay(phone: string | null | undefined): string {
  if (!phone) return "";
  const d = canonicalBrazilPhone(phone);
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
        {showCaption && (
          <p className="text-sm whitespace-pre-wrap px-0.5">
            <LinkifyText text={m.body} />
          </p>
        )}
      </div>
    );
  }
  if (isMedia && m.type === "video") {
    const caption = showCaption ? m.body : undefined;
    return (
      <div className="space-y-1 -mx-0.5">
        <WaMediaViewer src={url} kind="video" caption={caption} />
        {showCaption && (
          <p className="text-sm whitespace-pre-wrap px-0.5">
            <LinkifyText text={m.body} />
          </p>
        )}
      </div>
    );
  }
  if ((m.type === "audio" || m.type === "ptt") && !url) {
    return (
      <p className="text-sm text-[var(--wa-text-secondary)] italic">
        🎤 Áudio — aguardando download da mídia…
      </p>
    );
  }
  if (isMedia && (m.type === "audio" || m.type === "ptt")) {
    return (
      <div className="space-y-1">
        <WaAudioPlayer src={url} fromMe={m.fromMe} />
        {showCaption && (
          <p className="text-sm whitespace-pre-wrap">
            <LinkifyText text={m.body} />
          </p>
        )}
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
          {m.body && !m.body.startsWith("📎") ? (
            <LinkifyText text={m.body} linkClassName="hover:underline break-all" />
          ) : (
            "Abrir documento"
          )}
        </a>
      </div>
    );
  }
  return (
    <p className="text-sm whitespace-pre-wrap">
      <LinkifyText text={m.body || "—"} />
    </p>
  );
});

function mergePendingMessages(server: Message[], pending: Message[]): Message[] {
  if (pending.length === 0) return server;
  const merged = [...server];
  for (const p of pending) {
    const duplicated = server.some(
      (m) =>
        m.fromMe === p.fromMe &&
        m.type === p.type &&
        m.body.trim() === p.body.trim() &&
        Math.abs(m.timestamp - p.timestamp) < 120_000
    );
    if (!duplicated) merged.push(p);
  }
  return merged.sort((a, b) => a.timestamp - b.timestamp);
}

function isOptimisticMessageId(id: string): boolean {
  return id.startsWith("opt-");
}

function chatPhoneDigits(chat: Pick<Chat, "id" | "phone">): string {
  return (chat.phone ?? "").replace(/\D/g, "") || chat.id.replace(/@.*/, "").replace(/\D/g, "");
}

const CLIENT_HIDDEN_KEY = "zap-inbox-hidden-contacts";

function loadClientHiddenContacts(): Set<string> {
  try {
    const raw = sessionStorage.getItem(CLIENT_HIDDEN_KEY);
    if (!raw) return new Set();
    const list = JSON.parse(raw) as string[];
    return new Set(Array.isArray(list) ? list : []);
  } catch {
    return new Set();
  }
}

function saveClientHiddenContacts(hidden: Set<string>): void {
  sessionStorage.setItem(CLIENT_HIDDEN_KEY, JSON.stringify([...hidden]));
}

function hiddenKeysForChat(chat: Chat): string[] {
  const keys = new Set<string>([chat.id]);
  const digits = chatPhoneDigits(chat);
  if (digits.length >= 10) keys.add(digits);
  return [...keys];
}

function isClientHiddenChat(chat: Chat, hidden: Set<string>): boolean {
  // Grupo: só some se o próprio id foi marcado (apagar conversa).
  if (chat.isGroup) return hidden.has(chat.id);
  return hiddenKeysForChat(chat).some((k) => hidden.has(k));
}

function markChatHiddenLocally(chat: Chat): void {
  const hidden = loadClientHiddenContacts();
  for (const k of hiddenKeysForChat(chat)) hidden.add(k);
  saveClientHiddenContacts(hidden);
}

function filterClientVisibleChats(chats: Chat[]): Chat[] {
  const hidden = loadClientHiddenContacts();
  if (hidden.size === 0) return chats;
  const visible = chats.filter((c) => !isClientHiddenChat(c, hidden));
  for (const c of chats) {
    if (c.unreadCount > 0) {
      for (const k of hiddenKeysForChat(c)) hidden.delete(k);
    }
  }
  saveClientHiddenContacts(hidden);
  return visible;
}

function findMatchingChat(chats: Chat[], current: Chat): Chat | undefined {
  const digits = chatPhoneDigits(current);
  return chats.find(
    (c) =>
      c.id === current.id ||
      (digits.length >= 10 && chatPhoneDigits(c) === digits)
  );
}

function messagesSignature(list: Message[]): string {
  if (list.length === 0) return "0";
  const tail = list.slice(-3);
  return `${list.length}|${tail.map((m) => `${m.id}:${m.timestamp}:${m.mediaUrl ?? ""}`).join(";")}`;
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
  onSelect: (chat: Chat) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(chat)}
      className={`wa-chat-row w-full flex gap-3 px-3 py-2.5 text-left hover:bg-[#202c33] border-b border-[#2a3942]/40 ${
        active ? "bg-[#2a3942]" : ""
      }`}
    >
      <WhatsAppAvatar chatId={chat.id} isGroup={chat.isGroup} name={chat.name} size={49} />
      <div className="flex-1 min-w-0">
        <div className="flex justify-between gap-2">
          <span className="font-medium text-[#e9edef] truncate text-[15px]">
            {sanitizeChatName(chat.name, chat.kind)}
          </span>
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

function IconForward({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8-8-8z" />
    </svg>
  );
}

const MessageRow = memo(function MessageRow({
  message: m,
  onForward
}: {
  message: Message;
  onForward?: (message: Message) => void;
}) {
  const isVisualMedia =
    m.type === "image" || m.type === "sticker" || m.type === "video" || m.type === "audio" || m.type === "ptt";
  return (
    <div className={`group flex py-0.5 ${m.fromMe ? "justify-end" : "justify-start"}`}>
      <div className="relative max-w-full">
        {onForward && (
          <button
            type="button"
            onClick={() => onForward(m)}
            title="Encaminhar mensagem"
            className={`absolute top-0 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-[#233138] text-[#aebac1] shadow-md opacity-0 transition group-hover:opacity-100 hover:bg-[#2a3942] hover:text-[#e9edef] ${
              m.fromMe ? "-left-9" : "-right-9"
            }`}
          >
            <IconForward />
          </button>
        )}
        <div
          className={`wa-bubble break-words ${
            isVisualMedia ? "max-w-[min(88vw,480px)] px-1.5 py-1" : "max-w-[min(78vw,420px)] px-3 py-1.5"
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
    </div>
  );
});

const CHATS_CACHE_KEY = "zap-inbox-chats";

/** Lê a lista de conversas em cache (localStorage) para render instantâneo ao abrir. */
function loadCachedChats(): Chat[] {
  try {
    const raw = localStorage.getItem(CHATS_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? (parsed as Chat[]) : [];
  } catch {
    return [];
  }
}

function saveCachedChats(chats: Chat[]): void {
  try {
    // só as 60 mais recentes — o suficiente para a tela abrir cheia
    localStorage.setItem(CHATS_CACHE_KEY, JSON.stringify(chats.slice(0, 60)));
  } catch {
    /* localStorage cheio/indisponível — ignora */
  }
}

export function WhatsAppInbox() {
  const pageVisible = usePageVisible();
  // Hidrata do cache: a lista aparece na hora, e o fetch real atualiza em seguida.
  const [chats, setChats] = useState<Chat[]>(loadCachedChats);
  const lastUpdateRef = useRef(0);
  // Mensagens já carregadas por conversa (em memória, nesta sessão): ao reabrir
  // uma conversa, mostra na hora e sincroniza em segundo plano — como o WhatsApp Web.
  const messagesCacheRef = useRef<Map<string, Message[]>>(new Map());
  const [selected, setSelected] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [flows, setFlows] = useState<FlowOption[]>([]);
  const [quickReplies, setQuickReplies] = useState<QuickReply[]>([]);
  const [search, setSearch] = useState("");
  const [chatTab, setChatTab] = useState<ChatTab>("all");
  const [filterTagId, setFilterTagId] = useState("");
  const [draft, setDraft] = useState("");
  const [loadingChats, setLoadingChats] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [error, setError] = useState("");
  const [emptyHint, setEmptyHint] = useState("");
  const [waConnected, setWaConnected] = useState<boolean | null>(null);
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
  const [forwardMessage, setForwardMessage] = useState<Message | null>(null);
  const [forwardNotice, setForwardNotice] = useState("");
  const [showContactProfile, setShowContactProfile] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastMsgCountRef = useRef(0);
  const activeChatIdRef = useRef<string | null>(null);

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
      const r = await api<{
        ok: boolean;
        profile: SessionProfile | null;
        ownerPhone?: string | null;
      }>("/api/inbox/session-profile");
      if (r.profile) {
        setSessionProfile(r.profile);
        setWaConnected(r.profile.connected);
      }
    } catch {
      /* opcional */
    }
  }, []);

  const loadChats = useCallback(async (silent = false) => {
    if (!silent) setLoadingChats(true);
    setError("");
    setEmptyHint("");
    try {
      const r = await api<{
        ok: boolean;
        connected?: boolean;
        chats: Chat[];
        message?: string;
        sourcesOk?: string[];
        errors?: string[];
      }>("/api/inbox/chats");

      const connected = r.connected ?? sessionProfile?.connected ?? false;
      setWaConnected(connected);
      const nextChats = filterClientVisibleChats(r.chats ?? []);
      setChats(nextChats);
      saveCachedChats(nextChats);
      // marca o mais recente já visto, para o poll de novidade não re-disparar
      const newestTs = nextChats.reduce((max, c) => Math.max(max, c.timestamp || 0), 0);
      if (newestTs > lastUpdateRef.current) lastUpdateRef.current = newestTs;
      setSelected((sel) => {
        if (!sel) return null;
        const updated = findMatchingChat(nextChats, sel);
        if (!updated) return null;
        if (updated.id !== sel.id) {
          activeChatIdRef.current = updated.id;
        }
        return updated;
      });

      if (r.chats.length === 0) {
        if (connected) {
          setEmptyHint(
            r.message ??
              "Nenhuma conversa ainda neste número. Novas mensagens aparecem aqui automaticamente."
          );
        } else {
          setError(
            r.message ??
              r.errors?.join(" · ") ??
              "WhatsApp não conectado. Vá em Configurações → Instâncias."
          );
        }
      } else if (r.errors?.length) {
        setError("");
      }
    } catch (e: any) {
      setError(e?.message ?? "Erro ao carregar conversas");
      setWaConnected(null);
    } finally {
      if (!silent) setLoadingChats(false);
    }
  }, [sessionProfile?.connected]);

  const loadMessages = useCallback(async (chat: Chat, silent = false, sync = true) => {
    const requestChatId = chat.id;
    if (activeChatIdRef.current !== requestChatId) return;

    if (!silent) setLoadingMsgs(true);
    if (!silent) setMsgHint("");
    try {
      const r = await api<{
        ok: boolean;
        messages: Message[];
        hint?: string;
        message?: string;
      }>(
        // sync=0 no poll rápido: lê só do banco (o webhook mantém em tempo real)
        // e não dispara sync com a Evolution a cada 2,5s.
        `/api/inbox/messages?chatId=${encodeURIComponent(chat.id)}&isGroup=${
          chat.isGroup ? "1" : "0"
        }&sync=${sync ? "1" : "0"}`
      );
      if (activeChatIdRef.current !== requestChatId) return;

      const next = r.messages ?? [];
      setMessages((prev) => {
        if (activeChatIdRef.current !== requestChatId) return prev;
        const pending = prev.filter((m) => isOptimisticMessageId(m.id));
        const merged = mergePendingMessages(next, pending);
        // guarda no cache — mas não sobrescreve um cache cheio com resultado vazio
        // (sync=0 pode vir vazio por variante de chatId; o sync completo corrige)
        const cache = messagesCacheRef.current;
        const prevCached = cache.get(requestChatId);
        if (merged.length > 0 || !prevCached || prevCached.length === 0) {
          cache.set(requestChatId, merged);
          if (cache.size > 40) cache.delete(cache.keys().next().value as string);
        }
        if (messagesSignature(prev) === messagesSignature(merged)) {
          return prev;
        }
        return merged;
      });
      setMsgHint(r.hint ?? (r.ok ? "" : r.message ?? ""));
    } catch (e: any) {
      if (activeChatIdRef.current !== requestChatId) return;
      setMessages([]);
      setMsgHint(e?.message ?? "Erro ao carregar mensagens");
    } finally {
      if (!silent) setLoadingMsgs(false);
    }
  }, []);

  // Estável: sem isto, uma arrow nova por render em cada uma das ~270 linhas
  // derrubava o memo do ChatListRow — a lista inteira re-renderizava a cada poll.
  const handleSelectChat = useCallback((chat: Chat) => {
    activeChatIdRef.current = chat.id;
    const cached = messagesCacheRef.current.get(chat.id);
    // se já abriu essa conversa antes, mostra as mensagens na hora (sem "Carregando")
    setMessages(cached ?? []);
    setMsgHint("");
    setLoadingMsgs(!cached);
    setSelected({ ...chat, unreadCount: 0 });
    setChats((prev) => prev.map((c) => (c.id === chat.id ? { ...c, unreadCount: 0 } : c)));
    setSendError("");
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

  // Freshness da lista: checa a cada 5s um sinal BARATO (só o timestamp da última
  // mensagem no banco) e só recarrega a lista de verdade (que chama a Evolution)
  // quando algo mudou. Antes era um fetch pesado ao provedor a cada 20s, com ou
  // sem novidade. Uma rede de segurança lenta (90s) pega chats novos sem mensagem.
  useEffect(() => {
    if (!pageVisible) return;
    let alive = true;

    const checkUpdates = async () => {
      try {
        const r = await api<{ latest: number }>("/api/inbox/updates");
        if (!alive) return;
        if (r.latest && r.latest > lastUpdateRef.current) {
          lastUpdateRef.current = r.latest;
          void loadChats(true);
        }
      } catch {
        /* ignora — a rede de segurança abaixo cobre */
      }
    };

    void checkUpdates(); // ao abrir/voltar para a aba, checa na hora
    const fast = setInterval(checkUpdates, 5000);
    const safety = setInterval(() => loadChats(true), 90000);
    return () => {
      alive = false;
      clearInterval(fast);
      clearInterval(safety);
    };
  }, [pageVisible, loadChats]);

  useEffect(() => {
    if (!selected || !pageVisible) {
      activeChatIdRef.current = null;
      return;
    }
    activeChatIdRef.current = selected.id;
    const cached = messagesCacheRef.current.get(selected.id);
    setMessages(cached ?? []);
    // 1) Banco primeiro (rápido) → mensagens aparecem na hora. Silencioso se já
    //    havia cache, para não piscar "Carregando".
    void loadMessages(selected, Boolean(cached), false);
    // 2) Sync completo com a Evolution em SEGUNDO PLANO (silencioso) — pega o que
    //    o webhook perdeu e resolve variantes de chatId, sem travar a abertura.
    void loadMessages(selected, true, true);
    // Poll rápido só-banco (leve) + sync completo esporádico como rede de segurança
    // caso o webhook perca alguma mensagem.
    const fast = setInterval(() => loadMessages(selected, true, false), 3000);
    const full = setInterval(() => loadMessages(selected, true, true), 20000);
    return () => {
      clearInterval(fast);
      clearInterval(full);
    };
  }, [selected?.id, pageVisible, loadMessages]);

  useEffect(() => {
    if (messages.length > lastMsgCountRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
    }
    lastMsgCountRef.current = messages.length;
  }, [messages.length]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return chats.filter((c) => {
      if (!chatMatchesTab(c.kind, chatTab)) return false;
      if (filterTagId && !c.contact?.tags.some((t) => t.id === filterTagId)) return false;
      if (!q) return true;
      const tagStr = c.contact?.tags.map((t) => t.name).join(" ") ?? "";
      return (
        c.name.toLowerCase().includes(q) ||
        c.phone.includes(q) ||
        c.id.toLowerCase().includes(q) ||
        tagStr.toLowerCase().includes(q)
      );
    });
  }, [chats, chatTab, search, filterTagId]);

  const tabCounts = useMemo(
    () => ({
      all: chats.length,
      direct: chats.filter((c) => c.kind === "direct").length,
      group: chats.filter((c) => c.kind === "group" || c.kind === "community").length
    }),
    [chats]
  );

  const tagFilterCount = useMemo(() => {
    if (!filterTagId) return 0;
    return chats.filter((c) => c.contact?.tags.some((t) => t.id === filterTagId)).length;
  }, [chats, filterTagId]);

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
          phone: selected.phone,
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

  useEffect(() => {
    setShowContactProfile(false);
  }, [selected?.id]);

  function handleProfileContactUpdated(contact: ContactInfo) {
    if (!selected) return;
    setChats((prev) =>
      prev.map((c) =>
        c.id === selected.id
          ? {
              ...c,
              name: contact.name?.trim() || c.name,
              contact
            }
          : c
      )
    );
    setSelected((s) =>
      s
        ? {
            ...s,
            name: contact.name?.trim() || s.name,
            contact
          }
        : s
    );
  }

  function handleProfileDeleteConversation() {
    if (!selected) return;
    markChatHiddenLocally(selected);
    const removedId = selected.id;
    const removedPhone = selected.phone;
    setSelected(null);
    setMessages([]);
    setShowContactProfile(false);
    setChats((prev) =>
      filterClientVisibleChats(
        prev.filter((c) => {
          if (c.id === removedId) return false;
          if (!c.isGroup && removedPhone && chatPhoneDigits(c) === chatPhoneDigits({ id: removedId, phone: removedPhone })) {
            return false;
          }
          return true;
        })
      )
    );
    void loadChats(true);
  }

  function handleProfileRemoveFromCrm() {
    if (!selected) return;
    markChatHiddenLocally(selected);
    const removedPhone = selected.phone;
    const removedId = selected.id;
    setSelected(null);
    setMessages([]);
    setShowContactProfile(false);
    setChats((prev) =>
      filterClientVisibleChats(
        prev.filter((c) => {
          if (c.id === removedId) return false;
          if (!c.isGroup && removedPhone && chatPhoneDigits(c) === chatPhoneDigits(selected)) {
            return false;
          }
          return true;
        })
      )
    );
  }

  function handleOpenGroupFromProfile(groupId: string, groupName: string) {
    setShowContactProfile(false);
    const existing = chats.find((c) => c.id === groupId);
    if (existing) {
      setSelected(existing);
      return;
    }
    const synthetic: Chat = {
      id: groupId,
      phone: groupId.replace(/@.*/, ""),
      name: groupName,
      lastMessage: "",
      timestamp: Date.now(),
      isGroup: true,
      kind: "group",
      unreadCount: 0,
      contact: null
    };
    setChats((prev) => [synthetic, ...prev]);
    setSelected(synthetic);
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

        <div className="flex gap-1 px-2 py-2 bg-[#111b21] border-b border-[#2a3942]/60 overflow-x-auto items-center">
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
          <select
            value={filterTagId}
            onChange={(e) => setFilterTagId(e.target.value)}
            className={`shrink-0 max-w-[9.5rem] rounded-lg px-2 py-1.5 text-xs border-0 outline-none cursor-pointer transition ${
              filterTagId
                ? "bg-[#00a884]/20 text-[#00a884]"
                : "bg-[#202c33] text-[#8696a0] hover:text-[#e9edef]"
            }`}
            title="Filtrar conversas por tag"
            aria-label="Filtrar por tag"
          >
            <option value="">Tag</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          {filterTagId ? (
            <span className="shrink-0 text-[10px] text-[#8696a0] tabular-nums">{tagFilterCount}</span>
          ) : null}
        </div>

        <div className="px-3 py-2 bg-[#111b21]">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar ou filtrar por tag"
            className="w-full rounded-lg bg-[#202c33] border-0 px-4 py-2 text-sm text-[#e9edef] placeholder:text-[#8696a0] focus:ring-1 focus:ring-[#00a884]"
          />
        </div>

        {error && !waConnected && (
          <div className="mx-3 mb-2 rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-200">
            {error}
            <Link to="/settings" className="block mt-1 text-[#00a884] underline">
              Configurações → Instâncias
            </Link>
          </div>
        )}

        {emptyHint && waConnected && chats.length === 0 && !filterTagId && (
          <div className="mx-3 mb-2 rounded-lg bg-[#00a884]/10 border border-[#00a884]/25 px-3 py-2 text-xs text-[#aebac1] leading-relaxed">
            {emptyHint}
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          {loadingChats && chats.length === 0 && (
            <p className="p-4 text-sm text-[#8696a0]">Carregando conversas…</p>
          )}
          {!loadingChats && filtered.length === 0 && (
            <div className="p-4 text-sm text-[#8696a0] space-y-2">
              {filterTagId && chats.length > 0 ? (
                <p>Nenhuma conversa com esta tag nesta aba.</p>
              ) : waConnected ? (
                <>
                  <p>Nenhuma conversa ainda.</p>
                  <p className="text-xs leading-relaxed text-[#8696a0]">
                    {emptyHint ||
                      "Novas mensagens recebidas ou enviadas neste número aparecem aqui automaticamente."}
                  </p>
                </>
              ) : (
                <>
                  <p>Nenhuma conversa nesta aba.</p>
                  {error && (
                    <p className="text-amber-200/90 text-xs leading-relaxed">{error}</p>
                  )}
                  <Link to="/settings" className="text-[#00a884] underline text-xs block">
                    Abrir Configurações → Instâncias
                  </Link>
                </>
              )}
            </div>
          )}
          {filtered.map((chat) => (
            <ChatListRow
              key={chat.id}
              chat={chat}
              active={selected?.id === chat.id}
              onSelect={handleSelectChat}
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
          <div key={selected.id} className="relative flex flex-1 flex-col min-h-0 min-w-0">
            <header className="h-[52px] px-3 flex items-center gap-3 bg-[#202c33] shrink-0 border-l border-[#2a3942]">
              <WhatsAppAvatar
                key={selected.id}
                chatId={selected.id}
                isGroup={selected.isGroup}
                name={selected.name}
                size={40}
              />
              <button
                type="button"
                onClick={() => setShowContactProfile(true)}
                className="flex-1 min-w-0 text-left rounded-lg px-1 py-0.5 hover:bg-[#374955]/60 transition"
                title="Ver perfil do contato"
              >
                <div className="font-medium truncate">{sanitizeChatName(selected.name, selected.kind)}</div>
                <div className="text-xs text-[#8696a0] truncate">
                  {chatKindLabel(selected.kind)}
                  {selected.phone ? ` · ${formatPhoneDisplay(selected.phone)}` : ""}
                </div>
              </button>
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
            {forwardNotice && (
              <div className="px-3 py-1.5 bg-[#00a884]/10 border-b border-[#00a884]/30 text-xs text-[#53bdeb]">
                {forwardNotice}
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
                <MessageRow
                  key={m.id}
                  message={m}
                  onForward={setForwardMessage}
                />
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
                sendMedia(type, url, caption, filename)
              }
              quickReplies={quickReplies}
              onUseQuickReply={(reply) => applyQuickReply(reply)}
            />

            {showContactProfile && (
              <ContactProfilePanel
                chat={selected}
                allTags={tags}
                onClose={() => setShowContactProfile(false)}
                onContactUpdated={handleProfileContactUpdated}
                onDeleteConversation={handleProfileDeleteConversation}
                onRemoveFromCrm={handleProfileRemoveFromCrm}
                onOpenGroup={handleOpenGroupFromProfile}
              />
            )}
          </div>
        )}
      </section>

      {forwardMessage && (
        <ForwardMessageModal
          message={forwardMessage}
          chats={chats}
          tags={tags}
          excludeChatId={selected?.id}
          onClose={() => setForwardMessage(null)}
          onDone={({ sent, failed }) => {
            setForwardNotice(
              failed > 0
                ? `${sent} encaminhada(s), ${failed} falha(s).`
                : `${sent} mensagem(ns) encaminhada(s) com sucesso.`
            );
            window.setTimeout(() => setForwardNotice(""), 8000);
          }}
        />
      )}
    </div>
  );
}
