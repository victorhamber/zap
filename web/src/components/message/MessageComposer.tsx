/** Uma mensagem só: texto, imagem e vídeo no mesmo bloco, com a prévia de como sai. */
import { useRef, useState } from "react";
import { api } from "../../api/client";

export type ComposerPart = {
  id: string;
  kind: "text" | "image" | "video";
  text: string;
  url: string;
  filename: string;
};

function newId(): string {
  return `p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

export function emptyTextPart(): ComposerPart {
  return { id: newId(), kind: "text", text: "", url: "", filename: "" };
}

export function MessageComposer({
  parts,
  onChange
}: {
  parts: ComposerPart[];
  onChange: (parts: ComposerPart[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [library, setLibrary] = useState<LibraryItem[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const kindRef = useRef<"image" | "video">("image");

  function patch(id: string, next: Partial<ComposerPart>) {
    onChange(parts.map((part) => (part.id === id ? { ...part, ...next } : part)));
  }

  function openFile(kind: "image" | "video") {
    kindRef.current = kind;
    const input = inputRef.current;
    if (!input) return;
    input.accept = kind === "image" ? "image/*" : "video/*";
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
      onChange([
        ...parts,
        { id: newId(), kind: kindRef.current, text: "", url: r.url, filename: file.name }
      ]);
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
          (item) => item.url && (item.kind === "image" || item.kind === "video")
        )
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Não foi possível abrir a biblioteca.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
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
        <button type="button" className={addClass} onClick={() => onChange([...parts, emptyTextPart()])}>
          Texto
        </button>
        <button type="button" className={addClass} disabled={busy} onClick={() => openFile("image")}>
          Imagem
        </button>
        <button type="button" className={addClass} disabled={busy} onClick={() => openFile("video")}>
          Vídeo
        </button>
        <button type="button" className={addClass} disabled={busy} onClick={() => void openLibrary()}>
          Biblioteca
        </button>
      </div>
      {library && (
        <div className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-zinc-800 p-1">
          {library.length === 0 && <p className="px-1 py-2 text-xs text-zinc-500">A biblioteca está vazia.</p>}
          {library.map((item) => (
            <button
              key={item.url}
              type="button"
              className="block w-full truncate rounded px-2 py-1 text-left text-xs text-zinc-200 hover:bg-zinc-900"
              onClick={() => {
                onChange([
                  ...parts,
                  {
                    id: newId(),
                    kind: item.kind === "video" ? "video" : "image",
                    text: "",
                    url: item.url,
                    filename: item.previewLabel || item.filename
                  }
                ]);
                setLibrary(null);
              }}
            >
              {item.kind === "video" ? "Vídeo" : "Imagem"} · {item.previewLabel || item.filename}
            </button>
          ))}
        </div>
      )}
      {busy && <p className="text-xs text-zinc-400">Carregando arquivo…</p>}
      {error && <p className="text-xs text-amber-200">{error}</p>}
      <div className="space-y-3 rounded-2xl bg-[#0b141a] p-3">
        {parts.length === 0 && (
          <p className="px-1 py-6 text-center text-sm text-zinc-400">
            Adicione texto, imagem ou vídeo. Tudo sai nesta mesma mensagem.
          </p>
        )}
        {parts.map((part) => (
          <div key={part.id} className="rounded-xl bg-[#202c33] p-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-xs text-zinc-300">
                {part.kind === "text" ? "Texto" : part.kind === "image" ? "Imagem" : "Vídeo"}
              </span>
              <button
                type="button"
                className="text-xs text-zinc-400"
                onClick={() => onChange(parts.filter((item) => item.id !== part.id))}
              >
                Tirar
              </button>
            </div>
            {part.kind === "text" ? (
              <textarea
                value={part.text}
                rows={4}
                onChange={(e) => patch(part.id, { text: e.target.value })}
                placeholder="Escreva a mensagem"
                className="w-full rounded-lg border-0 bg-[#2a3942] px-3 py-2 text-sm text-[#e9edef]"
              />
            ) : (
              <div className="space-y-2">
                {part.kind === "image" && part.url && (
                  <img src={part.url} alt={part.filename || "Imagem"} className="max-h-52 w-full rounded-lg object-contain" />
                )}
                {part.kind === "video" && part.url && (
                  <video src={part.url} controls className="max-h-52 w-full rounded-lg" />
                )}
                <textarea
                  value={part.text}
                  rows={2}
                  onChange={(e) => patch(part.id, { text: e.target.value })}
                  placeholder="Legenda, se quiser"
                  className="w-full rounded-lg border-0 bg-[#2a3942] px-3 py-2 text-sm text-[#e9edef]"
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

type LibraryItem = { url: string; kind: string; filename: string; previewLabel?: string };

const addClass =
  "rounded-full border border-zinc-700 px-3 py-1.5 text-sm text-zinc-100 hover:border-emerald-500/40 disabled:opacity-60";

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    reader.readAsDataURL(file);
  });
}
