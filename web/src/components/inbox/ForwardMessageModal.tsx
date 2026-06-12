import { useMemo, useState } from "react";
import { api } from "../../api/client";

export type ForwardChat = {
  id: string;
  phone: string;
  name: string;
  isGroup: boolean;
  kind: "direct" | "group" | "community";
  contact: { tags: { id: string; name: string; color: string }[] } | null;
};

export type ForwardMessage = {
  id: string;
  body: string;
  fromMe: boolean;
  type: string;
  mediaUrl?: string | null;
};

type Tag = { id: string; name: string; color: string };

type ForwardPayload = {
  kind: "text" | "image" | "video" | "audio" | "document";
  text?: string;
  url?: string;
  caption?: string;
  filename?: string;
};

function isBase64Blob(body: string): boolean {
  const t = body.trim();
  if (t.startsWith("data:")) return true;
  return t.length > 400 && /^[A-Za-z0-9+/=\s]+$/.test(t.slice(0, 200));
}

function mediaUrlFromMessage(m: ForwardMessage): string | null {
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

function captionFromMessage(m: ForwardMessage): string | undefined {
  if (
    !m.body ||
    isBase64Blob(m.body) ||
    m.body.startsWith("📷") ||
    m.body.startsWith("🎤") ||
    m.body.startsWith("🎬") ||
    m.body.startsWith("📎")
  ) {
    return undefined;
  }
  return m.body;
}

export function messageToForwardPayload(m: ForwardMessage): ForwardPayload | null {
  const url = mediaUrlFromMessage(m);
  const caption = captionFromMessage(m);

  if (url && (m.type === "image" || m.type === "sticker")) {
    return { kind: "image", url, caption };
  }
  if (url && m.type === "video") {
    return { kind: "video", url, caption };
  }
  if (url && (m.type === "audio" || m.type === "ptt")) {
    return { kind: "audio", url, caption };
  }
  if (url && m.type === "document") {
    return { kind: "document", url, caption, filename: caption ?? "documento" };
  }
  if (m.body && !isBase64Blob(m.body)) {
    return { kind: "text", text: m.body };
  }
  return null;
}

function chatLabel(chat: ForwardChat): string {
  const n = chat.name?.trim();
  if (n && n !== "[object Object]") return n;
  return chat.phone || chat.id;
}

type Props = {
  message: ForwardMessage;
  chats: ForwardChat[];
  excludeChatId?: string;
  tags: Tag[];
  onClose: () => void;
  onDone: (result: { sent: number; failed: number }) => void;
};

export function ForwardMessageModal({
  message,
  chats,
  excludeChatId,
  tags,
  onClose,
  onDone
}: Props) {
  const [search, setSearch] = useState("");
  const [filterTagId, setFilterTagId] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const payload = useMemo(() => messageToForwardPayload(message), [message]);

  const candidates = useMemo(() => {
    const q = search.trim().toLowerCase();
    return chats.filter((c) => {
      if (excludeChatId && c.id === excludeChatId) return false;
      if (c.isGroup || c.kind !== "direct") return false;
      if (filterTagId && !c.contact?.tags.some((t) => t.id === filterTagId)) return false;
      if (!q) return true;
      const phone = c.phone.replace(/\D/g, "");
      return (
        chatLabel(c).toLowerCase().includes(q) ||
        phone.includes(q.replace(/\D/g, ""))
      );
    });
  }, [chats, excludeChatId, filterTagId, search]);

  const allSelected =
    candidates.length > 0 && candidates.every((c) => selected.has(c.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (allSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const c of candidates) next.delete(c.id);
        return next;
      });
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      for (const c of candidates) next.add(c.id);
      return next;
    });
  }

  async function handleForward() {
    if (!payload || selected.size === 0) return;
    setSending(true);
    setError("");
    try {
      const targets = chats
        .filter((c) => selected.has(c.id))
        .map((c) => ({ chatId: c.id, isGroup: c.isGroup }));
      const r = await api<{
        ok: boolean;
        sent?: number;
        failed?: number;
        message?: string;
        errors?: string[];
      }>("/api/inbox/forward-message", {
        method: "POST",
        body: JSON.stringify({ targets, message: payload })
      });
      if (!r.ok) {
        setError(r.message ?? "Falha ao encaminhar");
        return;
      }
      onDone({ sent: r.sent ?? 0, failed: r.failed ?? 0 });
      onClose();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao encaminhar");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md max-h-[85vh] flex flex-col rounded-xl bg-[#111b21] border border-[#2a3942] shadow-2xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a3942]">
          <h2 className="text-[#e9edef] font-medium">Encaminhar mensagem</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-[#8696a0] hover:text-[#e9edef] px-2"
            aria-label="Fechar"
          >
            ✕
          </button>
        </div>

        {!payload ? (
          <p className="p-4 text-sm text-[#8696a0]">Esta mensagem não pode ser encaminhada.</p>
        ) : (
          <>
            <div className="px-4 py-2 border-b border-[#2a3942]/60 space-y-2">
              <p className="text-[11px] text-[#8696a0]">
                {payload.kind === "text"
                  ? "Texto"
                  : payload.kind === "image"
                    ? "Imagem"
                    : payload.kind === "video"
                      ? "Vídeo"
                      : payload.kind === "audio"
                        ? "Áudio"
                        : "Arquivo"}
                {payload.caption ? " · com legenda" : ""}
              </p>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar contato…"
                className="w-full rounded-lg bg-[#2a3942] px-3 py-2 text-sm text-[#e9edef] border-0 placeholder:text-[#8696a0]"
              />
              <select
                value={filterTagId}
                onChange={(e) => setFilterTagId(e.target.value)}
                className="w-full rounded-lg bg-[#2a3942] px-3 py-2 text-sm text-[#e9edef] border-0"
              >
                <option value="">Todas as tags</option>
                {tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2 px-4 py-2 border-b border-[#2a3942]/40">
              <label className="flex items-center gap-2 text-xs text-[#8696a0] cursor-pointer">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  className="rounded"
                />
                Selecionar todos ({candidates.length})
              </label>
            </div>

            <div className="flex-1 overflow-y-auto min-h-0">
              {candidates.length === 0 ? (
                <p className="p-4 text-sm text-[#8696a0]">Nenhum contato encontrado.</p>
              ) : (
                candidates.map((c) => (
                  <label
                    key={c.id}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-[#202c33] cursor-pointer border-b border-[#2a3942]/30"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(c.id)}
                      onChange={() => toggle(c.id)}
                      className="rounded shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-[#e9edef] truncate">{chatLabel(c)}</div>
                      <div className="text-[11px] text-[#8696a0] truncate">{c.phone}</div>
                      {c.contact?.tags && c.contact.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {c.contact.tags.slice(0, 3).map((t) => (
                            <span
                              key={t.id}
                              className="text-[9px] px-1 rounded text-white"
                              style={{ backgroundColor: t.color }}
                            >
                              {t.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </label>
                ))
              )}
            </div>

            {error && (
              <p className="px-4 py-2 text-xs text-[#ea0038] border-t border-[#2a3942]/40">{error}</p>
            )}

            <div className="flex gap-2 p-4 border-t border-[#2a3942]">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-lg border border-[#2a3942] py-2.5 text-sm text-[#8696a0] hover:bg-[#202c33]"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={sending || selected.size === 0}
                onClick={() => void handleForward()}
                className="flex-1 rounded-lg bg-[#00a884] py-2.5 text-sm font-medium text-[#111b21] hover:bg-[#06cf9c] disabled:opacity-40"
              >
                {sending ? "Enviando…" : `Encaminhar (${selected.size})`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
