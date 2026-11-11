import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorNotice,
  Icon,
  PageHeader,
  SearchInput,
  Skeleton
} from "../components/ui";

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
  const [copiedFilename, setCopiedFilename] = useState<string | null>(null);
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

  async function handleCopyUrl(item: MediaItem) {
    const url = item.url.startsWith("http")
      ? item.url
      : `${window.location.origin}${item.url.startsWith("/") ? "" : "/"}${item.url}`;

    try {
      await navigator.clipboard.writeText(url);
      setCopiedFilename(item.filename);
      window.setTimeout(() => {
        setCopiedFilename((current) => (current === item.filename ? null : current));
      }, 2000);
    } catch {
      window.prompt("Copie a URL:", url);
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
    <div className="space-y-6">
      <PageHeader
        title="Mídias"
        subtitle="Arquivos salvos no servidor (geralmente após você abrir ou enviar mídia). Exclua o que não precisar para liberar espaço ou baixe novamente quando quiser."
        actions={
          <Button icon="refresh" disabled={loading} onClick={() => void load()}>
            Atualizar
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="p-4" padded={false}>
          <div className="text-xs font-medium text-zinc-500">Arquivos</div>
          {loading ? (
            <Skeleton className="mt-2.5 h-7 w-16" />
          ) : (
            <div className="mt-2 text-[26px] font-semibold leading-none tracking-tight text-white">
              {totalFiles}
            </div>
          )}
        </Card>
        <Card className="p-4" padded={false}>
          <div className="text-xs font-medium text-zinc-500">Espaço usado</div>
          {loading ? (
            <Skeleton className="mt-2.5 h-7 w-24" />
          ) : (
            <div className="mt-2 text-[26px] font-semibold leading-none tracking-tight text-white">
              {formatBytes(totalBytes)}
            </div>
          )}
        </Card>
        <Card className="p-4" padded={false}>
          <div className="text-xs font-medium text-zinc-500">Filtro ativo</div>
          <div className="mt-3">
            <Badge tone="success">
              {filter === "all" ? "Todas" : filter === "received" ? "Recebidas" : "Enviadas"}
            </Badge>
          </div>
        </Card>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-1 shadow-xs">
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
              className={`rounded-lg px-3 py-1.5 text-xs md:text-sm font-medium transition-colors ${
                filter === t.id
                  ? "bg-white/[0.08] text-white shadow-xs"
                  : "text-zinc-400 hover:bg-white/[0.03] hover:text-zinc-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Buscar por nome ou legenda…"
          className="ml-auto min-w-[220px] max-w-sm flex-1"
        />
      </div>

      {!loading && filtered.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--surface-1)] px-4 py-3">
          <label className="flex cursor-pointer items-center gap-2.5 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={allFilteredSelected}
              onChange={toggleSelectAllFiltered}
              className="h-4 w-4 rounded border-zinc-600 accent-emerald-500"
            />
            Selecionar todas ({filtered.length})
          </label>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="danger"
              icon="trash"
              disabled={bulkDeleting || selectedCount === 0}
              onClick={() => void handleBulkDelete("selected")}
            >
              {bulkDeleting ? "Excluindo…" : `Excluir selecionadas (${selectedCount})`}
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={bulkDeleting}
              onClick={() => void handleBulkDelete("all")}
            >
              Excluir todas visíveis
            </Button>
          </div>
        </div>
      )}

      {error && <ErrorNotice>{error}</ErrorNotice>}

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-72 rounded-2xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="media"
          title={search ? "Nenhuma mídia para essa busca" : "Nenhuma mídia salva"}
          description={
            search
              ? "Tente outro termo ou troque o filtro acima."
              : "Os arquivos aparecem aqui depois que você abre ou envia mídia nas conversas."
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((item) => (
            <article
              key={item.filename}
              className={`flex flex-col overflow-hidden rounded-2xl border bg-[var(--surface-1)] transition ${
                selected.has(item.filename)
                  ? "border-brand-500/45 ring-1 ring-brand-500/20"
                  : "border-[var(--line)] hover:border-[var(--line-strong)]"
              }`}
            >
              <div className="relative flex aspect-video items-center justify-center overflow-hidden bg-[var(--surface-2)]">
                <label className="absolute right-2 top-2 z-10 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full bg-black/60 backdrop-blur">
                  <input
                    type="checkbox"
                    checked={selected.has(item.filename)}
                    onChange={() => toggleSelect(item.filename)}
                    aria-label={`Selecionar ${item.filename}`}
                    className="h-4 w-4 rounded border-zinc-500 accent-emerald-500"
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
                <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2.5 py-0.5 text-[10px] font-medium text-zinc-200 backdrop-blur">
                  {KIND_LABEL[item.kind]}
                </span>
              </div>

              <div className="flex flex-1 flex-col gap-2 p-3.5">
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

                <div className="mt-auto flex flex-col gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => void handleCopyUrl(item)}
                    className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-brand-500/30 px-3 text-xs text-brand-300 transition hover:bg-brand-500/10"
                  >
                    <Icon
                      name={copiedFilename === item.filename ? "check" : "copy"}
                      className="h-3.5 w-3.5"
                    />
                    {copiedFilename === item.filename ? "URL copiada!" : "Copiar URL"}
                  </button>
                  <div className="flex gap-2">
                    <a
                      href={item.url}
                      download={item.filename}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--line-strong)] bg-[var(--surface-2)] px-3 text-xs text-zinc-200 transition hover:bg-[var(--surface-3)]"
                    >
                      <Icon name="download" className="h-3.5 w-3.5" />
                      Baixar
                    </a>
                    <Button
                      size="sm"
                      variant="danger"
                      icon="trash"
                      className="flex-1"
                      disabled={deleting === item.filename}
                      onClick={() => void handleDelete(item)}
                    >
                      {deleting === item.filename ? "…" : "Excluir"}
                    </Button>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
