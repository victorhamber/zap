import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";

type MediaKind = "image" | "video" | "audio" | "document" | "other";

type MediaItem = {
  filename: string;
  url: string;
  kind: MediaKind;
  sizeBytes: number;
  messageCount: number;
  receivedCount: number;
  sentCount: number;
  lastAt: string;
  previewLabel: string;
};

type MediaResponse = {
  items: MediaItem[];
  totalBytes: number;
  totalFiles: number;
};

type Filter = "all" | "received" | "sent";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

const KIND_LABEL: Record<MediaKind, string> = {
  image: "Imagem",
  video: "Vídeo",
  audio: "Áudio",
  document: "Documento",
  other: "Arquivo"
};

const KIND_ICON: Record<MediaKind, string> = {
  image: "🖼",
  video: "🎬",
  audio: "🎤",
  document: "📄",
  other: "📎"
};

export function MediaLibrary() {
  const [filter, setFilter] = useState<Filter>("all");
  const [items, setItems] = useState<MediaItem[]>([]);
  const [totalBytes, setTotalBytes] = useState(0);
  const [totalFiles, setTotalFiles] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await api<MediaResponse>(`/api/media?filter=${filter}`);
      setItems(r.items ?? []);
      setTotalBytes(r.totalBytes ?? 0);
      setTotalFiles(r.totalFiles ?? 0);
      setSelected(new Set());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Erro ao carregar mídias");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.filename.toLowerCase().includes(q) ||
        i.previewLabel.toLowerCase().includes(q) ||
        KIND_LABEL[i.kind].toLowerCase().includes(q)
    );
  }, [items, search]);

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((i) => selected.has(i.filename));
  const selectedCount = filtered.filter((i) => selected.has(i.filename)).length;

  function toggleSelect(filename: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });
  }

  function toggleSelectAllFiltered() {
    if (allFilteredSelected) {
      setSelected((prev) => {
        const next = new Set(prev);
        for (const item of filtered) next.delete(item.filename);
        return next;
      });
      return;
    }
    setSelected((prev) => {
      const next = new Set(prev);
      for (const item of filtered) next.add(item.filename);
      return next;
    });
  }

  async function handleBulkDelete(mode: "selected" | "all") {
    const count = mode === "all" ? filtered.length : selectedCount;
    if (count === 0) return;

    const msg =
      mode === "all"
        ? `Excluir todas as ${filtered.length} mídia(s) visíveis?\n\nOs arquivos serão removidos do servidor.`
        : `Excluir ${selectedCount} mídia(s) selecionada(s)?\n\nOs arquivos serão removidos do servidor.`;
    if (!window.confirm(msg)) return;

    setBulkDeleting(true);
    try {
      const filenames =
        mode === "all"
          ? filtered.map((i) => i.filename)
          : filtered.filter((i) => selected.has(i.filename)).map((i) => i.filename);

      await api<{ ok: boolean; deleted?: number }>("/api/media/delete-bulk", {
        method: "POST",
        body: JSON.stringify({ filenames })
      });
      await load();
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : "Falha ao excluir");
    } finally {
      setBulkDeleting(false);
    }
  }

  async function handleDelete(item: MediaItem) {
    const msg =
      item.messageCount > 0
        ? `Excluir "${item.filename}"?\n\nO arquivo será removido do servidor. As ${item.messageCount} mensagem(ns) no histórico continuarão, mas sem a mídia anexada.`
        : `Excluir "${item.filename}" do servidor?`;
    if (!window.confirm(msg)) return;

    setDeleting(item.filename);
    try {
      await api<{ ok: boolean }>(
        `/api/media/${encodeURIComponent(item.filename)}`,
        { method: "DELETE" }
      );
      await load();
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : "Falha ao excluir");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <div className="max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Mídias</h1>
          <p className="text-sm text-zinc-400 mt-1 max-w-2xl leading-relaxed">
            Arquivos salvos no servidor (geralmente após você abrir ou enviar mídia). Exclua o que
            não precisar para liberar espaço ou baixe novamente quando quiser.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-xl border border-zinc-700 px-4 py-2 text-sm text-zinc-300 hover:bg-zinc-900 disabled:opacity-50"
        >
          Atualizar
        </button>
      </div>

      <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
          <div className="text-xs text-zinc-500">Arquivos</div>
          <div className="text-2xl font-semibold mt-1">{totalFiles}</div>
        </div>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
          <div className="text-xs text-zinc-500">Espaço usado</div>
          <div className="text-2xl font-semibold mt-1">{formatBytes(totalBytes)}</div>
        </div>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/60 p-4">
          <div className="text-xs text-zinc-500">Filtro ativo</div>
          <div className="text-lg font-medium mt-1 text-emerald-300">
            {filter === "all" ? "Todas" : filter === "received" ? "Recebidas" : "Enviadas"}
          </div>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2 items-center">
        {(
          [
            { id: "all" as const, label: "Todas" },
            { id: "received" as const, label: "Recebidas" },
            { id: "sent" as const, label: "Enviadas" }
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setFilter(t.id)}
            className={`rounded-lg px-4 py-2 text-sm transition ${
              filter === t.id
                ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/25"
                : "text-zinc-400 hover:text-zinc-200 border border-zinc-800"
            }`}
          >
            {t.label}
          </button>
        ))}
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nome ou legenda…"
          aria-label="Buscar mídias"
          className="ml-auto min-w-[220px] flex-1 max-w-sm rounded-xl border border-zinc-800 bg-zinc-950/80 px-4 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500/40"
        />
      </div>

      {!loading && filtered.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-zinc-800 bg-zinc-950/60 px-4 py-3">
          <label className="flex items-center gap-2 text-sm text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={allFilteredSelected}
              onChange={toggleSelectAllFiltered}
              className="rounded border-zinc-600"
            />
            Selecionar todas ({filtered.length})
          </label>
          <button
            type="button"
            disabled={bulkDeleting || selectedCount === 0}
            onClick={() => void handleBulkDelete("selected")}
            className="rounded-lg border border-red-500/30 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-40"
          >
            {bulkDeleting ? "Excluindo…" : `Excluir selecionadas (${selectedCount})`}
          </button>
          <button
            type="button"
            disabled={bulkDeleting}
            onClick={() => void handleBulkDelete("all")}
            className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs text-red-200 hover:bg-red-500/10 disabled:opacity-40"
          >
            Excluir todas visíveis
          </button>
        </div>
      )}

      {error && (
        <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </p>
      )}

      {loading ? (
        <p className="mt-8 text-sm text-zinc-500 animate-pulse">Carregando mídias…</p>
      ) : filtered.length === 0 ? (
        <p className="mt-8 text-sm text-zinc-500">
          Nenhuma mídia encontrada{search ? " para essa busca" : ""}.
        </p>
      ) : (
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((item) => (
            <article
              key={item.filename}
              className={`rounded-2xl border bg-zinc-950/50 overflow-hidden flex flex-col ${
                selected.has(item.filename) ? "border-emerald-500/40" : "border-zinc-800"
              }`}
            >
              <div className="aspect-video bg-zinc-900 relative flex items-center justify-center overflow-hidden">
                <label className="absolute top-2 right-2 z-10 flex items-center justify-center w-7 h-7 rounded-full bg-black/60 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.has(item.filename)}
                    onChange={() => toggleSelect(item.filename)}
                    aria-label={`Selecionar ${item.filename}`}
                    className="rounded border-zinc-500"
                  />
                </label>
                {item.kind === "image" ? (
                  <img
                    src={item.url}
                    alt={item.previewLabel || item.filename}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                ) : item.kind === "video" ? (
                  <video
                    src={item.url}
                    className="w-full h-full object-cover"
                    muted
                    preload="metadata"
                  />
                ) : (
                  <span className="text-4xl opacity-80">{KIND_ICON[item.kind]}</span>
                )}
                <span className="absolute top-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-zinc-200">
                  {KIND_LABEL[item.kind]}
                </span>
              </div>

              <div className="p-3 flex-1 flex flex-col gap-2">
                <p className="text-xs text-zinc-500 truncate" title={item.filename}>
                  {item.filename}
                </p>
                {item.previewLabel && item.previewLabel !== item.filename && (
                  <p className="text-sm text-zinc-300 line-clamp-2">{item.previewLabel}</p>
                )}
                <div className="text-[11px] text-zinc-500 space-y-0.5">
                  <div>{formatBytes(item.sizeBytes)}</div>
                  <div>{formatDate(item.lastAt)}</div>
                  {item.messageCount > 0 && (
                    <div>
                      {item.receivedCount > 0 && `${item.receivedCount} recebida(s)`}
                      {item.receivedCount > 0 && item.sentCount > 0 && " · "}
                      {item.sentCount > 0 && `${item.sentCount} enviada(s)`}
                    </div>
                  )}
                </div>

                <div className="mt-auto flex gap-2 pt-2">
                  <a
                    href={item.url}
                    download={item.filename}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-1 rounded-lg border border-zinc-700 px-3 py-2 text-center text-xs text-zinc-200 hover:bg-zinc-900 transition"
                  >
                    Baixar
                  </a>
                  <button
                    type="button"
                    disabled={deleting === item.filename}
                    onClick={() => void handleDelete(item)}
                    className="flex-1 rounded-lg border border-red-500/30 px-3 py-2 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-50 transition"
                  >
                    {deleting === item.filename ? "…" : "Excluir"}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
