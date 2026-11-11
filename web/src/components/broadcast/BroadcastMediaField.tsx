/** Arquivo do disparo: envio do computador ou item da biblioteca. */
import { useRef, useState } from "react";
import { api } from "../../api/client";

export type BroadcastMediaPick = {
  kind: "image" | "video" | "audio" | "document";
  url: string;
  filename: string;
};

const KINDS: { kind: BroadcastMediaPick["kind"]; label: string; accept: string }[] = [
  { kind: "image", label: "Imagem", accept: "image/*" },
  { kind: "video", label: "Vídeo", accept: "video/*" },
  { kind: "audio", label: "Áudio", accept: "audio/*" },
  { kind: "document", label: "Documento", accept: ".pdf,.doc,.docx,.txt,.xls,.xlsx,.zip" }
];

type LibraryItem = { url: string; kind: string; filename: string; previewLabel?: string };

export function BroadcastMediaField({
  media,
  onChange
}: {
  media: BroadcastMediaPick | null;
  onChange: (media: BroadcastMediaPick | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [library, setLibrary] = useState<LibraryItem[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const kindRef = useRef<BroadcastMediaPick["kind"]>("image");

  function openFile(kind: BroadcastMediaPick["kind"], accept: string) {
    kindRef.current = kind;
    const input = inputRef.current;
    if (!input) return;
    input.accept = accept;
    input.value = "";
    input.click();
  }

  async function onFile(file: File) {
    setBusy(true);
    setError("");
    try {
      const data = await readFile(file);
      const r = await api<{ ok: boolean; url?: string; message?: string }>("/api/inbox/upload", {
        method: "POST",
        body: JSON.stringify({ data, mime: file.type })
      });
      if (!r.url) throw new Error(r.message ?? "Não foi possível guardar o arquivo.");
      onChange({ kind: kindRef.current, url: r.url, filename: file.name });
      setLibrary(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Não foi possível guardar o arquivo.");
    } finally {
      setBusy(false);
    }
  }

  async function openLibrary() {
    if (library) {
      setLibrary(null);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const r = await api<{ items?: LibraryItem[] }>("/api/media?filter=all");
      setLibrary(
        (r.items ?? []).filter(
          (item) => item.url && (item.kind === "image" || item.kind === "video" || item.kind === "audio" || item.kind === "document")
        )
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Não foi possível abrir a biblioteca.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onFile(file);
        }}
      />
      <div className="flex flex-wrap gap-2">
        {KINDS.map((item) => (
          <button
            key={item.kind}
            type="button"
            disabled={busy}
            onClick={() => openFile(item.kind, item.accept)}
            className="rounded-lg border border-zinc-700 px-2 py-1 text-xs text-zinc-200 hover:border-emerald-500/40 disabled:opacity-60"
          >
            {item.label}
          </button>
        ))}
        <button
          type="button"
          disabled={busy}
          onClick={() => void openLibrary()}
          className="rounded-lg border border-zinc-700 px-2 py-1 text-xs text-zinc-200 hover:border-emerald-500/40 disabled:opacity-60"
        >
          Biblioteca do Zap
        </button>
      </div>
      {busy && <p className="text-xs text-zinc-500">Carregando arquivo…</p>}
      {error && <p className="text-xs text-amber-200">{error}</p>}
      {media && (
        <p className="flex items-center justify-between gap-2 rounded-lg bg-zinc-900 px-2 py-1 text-xs text-zinc-200">
          <span>
            {labelOf(media.kind)} · {media.filename || "arquivo"}
          </span>
          <button type="button" className="text-zinc-400" onClick={() => onChange(null)}>
            Tirar
          </button>
        </p>
      )}
      {library && (
        <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-zinc-800 p-1">
          {library.length === 0 && <p className="px-1 py-2 text-xs text-zinc-500">A biblioteca está vazia.</p>}
          {library.map((item) => (
            <button
              key={item.url}
              type="button"
              className="block w-full truncate rounded px-2 py-1 text-left text-xs text-zinc-200 hover:bg-zinc-900"
              onClick={() => {
                onChange({
                  kind: item.kind as BroadcastMediaPick["kind"],
                  url: item.url,
                  filename: item.previewLabel || item.filename
                });
                setLibrary(null);
              }}
            >
              {labelOf(item.kind)} · {item.previewLabel || item.filename}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function labelOf(kind: string): string {
  if (kind === "image") return "Imagem";
  if (kind === "video") return "Vídeo";
  if (kind === "audio") return "Áudio";
  return "Documento";
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    reader.readAsDataURL(file);
  });
}
