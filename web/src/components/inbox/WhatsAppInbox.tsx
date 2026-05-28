import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api/client";

type Tag = { id: string; name: string; color: string };

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
  const [chats, setChats] = useState<Chat[]>([]);
  const [selected, setSelected] = useState<Chat | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [flows, setFlows] = useState<FlowOption[]>([]);
  const [search, setSearch] = useState("");
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

  const loadChats = useCallback(async () => {
    setLoadingChats(true);
    setError("");
    try {
      const r = await api<{ ok: boolean; chats: Chat[]; message?: string }>("/api/inbox/chats");
      if (!r.ok && r.message) setError(r.message);
      setChats(r.chats ?? []);
    } catch (e: any) {
      setError(e?.message ?? "Erro ao carregar conversas");
    } finally {
      setLoadingChats(false);
    }
  }, []);

  const loadMessages = useCallback(async (chat: Chat) => {
    setLoadingMsgs(true);
    setMsgHint("");
    try {
      const phone = encodeURIComponent(chat.phone);
      const chatId = encodeURIComponent(chat.id);
      const r = await api<{ ok: boolean; messages: Message[]; hint?: string; message?: string }>(
        `/api/inbox/chats/${phone}/messages?chatId=${chatId}&isGroup=${chat.isGroup ? "1" : "0"}`
      );
      setMessages(r.messages ?? []);
      setMsgHint(r.hint ?? (r.ok ? "" : r.message ?? ""));
    } catch (e: any) {
      setMessages([]);
      setMsgHint(e?.message ?? "Erro ao carregar mensagens");
    } finally {
      setLoadingMsgs(false);
    }
  }, []);

  useEffect(() => {
    loadTags();
    loadFlows();
    loadChats();
    const t = setInterval(loadChats, 20000);
    return () => clearInterval(t);
  }, [loadTags, loadFlows, loadChats]);

  useEffect(() => {
    if (!selected) return;
    loadMessages(selected);
    const t = setInterval(() => loadMessages(selected), 12000);
    return () => clearInterval(t);
  }, [selected, loadMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const filtered = chats.filter((c) => {
    const q = search.toLowerCase();
    if (!q) return true;
    const tagStr = c.contact?.tags.map((t) => t.name).join(" ") ?? "";
    return (
      c.name.toLowerCase().includes(q) ||
      c.phone.includes(q) ||
      tagStr.toLowerCase().includes(q)
    );
  });

  async function saveContactTags(chat: Chat, tagIds: string[]) {
    const phone = chat.isGroup ? chat.id : chat.phone;
    const r = await api<{ ok: boolean; contact: ContactInfo }>(`/api/contacts/${encodeURIComponent(phone)}`, {
      method: "PUT",
      body: JSON.stringify({ name: chat.name, tagIds })
    });
    if (r.contact) {
      setChats((prev) =>
        prev.map((c) =>
          c.phone === chat.phone && c.isGroup === chat.isGroup
            ? { ...c, contact: r.contact }
            : c
        )
      );
      if (selected?.phone === chat.phone) {
        setSelected((s) => (s ? { ...s, contact: r.contact } : s));
      }
    }
    await loadChats();
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
    const phone = encodeURIComponent(selected.isGroup ? selected.id : selected.phone);
    const r = await api<{ ok: boolean; message?: string }>(`/api/inbox/chats/${phone}/send`, {
      method: "POST",
      body: JSON.stringify({
        message: draft.trim(),
        isGroup: selected.isGroup
      })
    });
    if (!r.ok) {
      setError(r.message ?? "Falha ao enviar");
      return;
    }
    setDraft("");
    await loadMessages(selected);
    await loadChats();
  }

  async function startFlow(flowId: string) {
    if (!selected) return;
    const phone = encodeURIComponent(selected.isGroup ? selected.id : selected.phone);
    await api(`/api/inbox/chats/${phone}/start-flow`, {
      method: "POST",
      body: JSON.stringify({ flowId, name: selected.name })
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
      {/* Lista de conversas — ~35% como WhatsApp Web */}
      <aside className="flex w-[393px] max-w-[38vw] min-w-[260px] shrink-0 flex-col border-r border-[#2a3942] bg-[#111b21] min-h-0">
        <header className="h-[59px] px-4 flex items-center gap-3 bg-[#202c33] shrink-0">
          <div className="h-10 w-10 rounded-full bg-[#6b7c85] flex items-center justify-center text-sm font-medium">
            Z
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-medium text-[#e9edef]">Conversas</div>
            <div className="text-xs text-[#8696a0] truncate">Zap · instância ativa</div>
          </div>
          <Link
            to="/settings"
            className="text-xs text-[#00a884] hover:underline shrink-0"
            title="Configurações WhatsApp"
          >
            ⚙
          </Link>
        </header>

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
              Abrir configurações / QR
            </Link>
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          {loadingChats && chats.length === 0 && (
            <p className="p-4 text-sm text-[#8696a0]">Carregando conversas…</p>
          )}
          {!loadingChats && filtered.length === 0 && (
            <p className="p-4 text-sm text-[#8696a0]">
              Nenhuma conversa. Conecte o WhatsApp em Configurações.
            </p>
          )}
          {filtered.map((chat) => (
            <button
              key={`${chat.phone}-${chat.id}`}
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

      {/* Painel da conversa — ocupa o restante */}
      <section className="flex flex-1 flex-col min-w-0 min-h-0 bg-[#0b141a]">
        {!selected ? (
          <div className="flex flex-1 min-h-0 flex-col items-center justify-center text-center px-8 bg-[#222e35] border-b-[6px] border-[#00a884]">
            <div className="max-w-md">
              <h2 className="text-2xl font-light text-[#e9edef] mb-3">Zap Web</h2>
              <p className="text-sm text-[#8696a0] leading-relaxed">
                Selecione uma conversa para ver mensagens, etiquetar clientes e disparar fluxos
                por tag.
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
                <div className="text-xs text-[#8696a0] font-mono truncate">{selected.phone}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <select
                  className="rounded-lg bg-[#2a3942] text-xs text-[#e9edef] px-2 py-1.5 max-w-[140px] border-0"
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
                      {f.inboundTags.length ? ` [${f.inboundTags.join(", ")}]` : ""}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setShowTagForm((v) => !v)}
                  className="rounded-lg bg-[#2a3942] px-2 py-1.5 text-xs hover:bg-[#374955]"
                  title="Nova tag"
                >
                  + Tag
                </button>
              </div>
            </header>

            {/* Tags do contato */}
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
              {tags.length === 0 && (
                <span className="text-xs text-[#8696a0]">Crie tags com + Tag</span>
              )}
            </div>

            {showTagForm && (
              <div className="px-4 py-2 bg-[#202c33] border-b border-[#2a3942] flex flex-wrap gap-2 items-end">
                <input
                  value={newTagName}
                  onChange={(e) => setNewTagName(e.target.value)}
                  placeholder="Nome da tag (ex: cliente-vip)"
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

            {/* Mensagens — área rolável entre cabeçalho e composer */}
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
                    "Sem mensagens no histórico. Envie a primeira mensagem abaixo ou aguarde o WPP sincronizar."}
                </p>
              )}
              {!loadingMsgs && msgHint && messages.length > 0 && (
                <p className="text-center text-xs text-[#8696a0] pb-2">{msgHint}</p>
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
                    <p className="text-sm whitespace-pre-wrap break-words">{m.body || "—"}</p>
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

            {/* Composer — fixo embaixo */}
            <footer className="px-4 py-3 bg-[#202c33] flex gap-2 items-end shrink-0 border-l border-[#2a3942]">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void sendMessage();
                  }
                }}
                rows={1}
                placeholder="Digite uma mensagem"
                className="flex-1 resize-none rounded-lg bg-[#2a3942] border-0 px-4 py-2.5 text-sm text-[#e9edef] placeholder:text-[#8696a0] max-h-32"
              />
              <button
                type="button"
                onClick={() => void sendMessage()}
                disabled={!draft.trim()}
                className="h-11 w-11 rounded-full bg-[#00a884] flex items-center justify-center text-[#111b21] disabled:opacity-40 shrink-0"
                aria-label="Enviar"
              >
                ➤
              </button>
            </footer>
          </div>
        )}
      </section>
    </div>
  );
}
