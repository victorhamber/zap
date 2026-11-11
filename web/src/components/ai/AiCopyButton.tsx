/** Ícone que abre o pedido de texto para a IA. */
import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../api/client";

type Draft = { text: string; subject: string; preheader: string; html: string };
type Goal = "venda" | "engajamento" | "aviso" | "relacionamento";

const GOALS: { id: Goal; label: string }[] = [
  { id: "venda", label: "Venda" },
  { id: "engajamento", label: "Engajamento" },
  { id: "aviso", label: "Aviso" },
  { id: "relacionamento", label: "Relacionamento" }
];

export function AiCopyButton({
  channel,
  audience,
  onApply
}: {
  channel: "whatsapp" | "email";
  audience: "group" | "person";
  onApply: (draft: Draft) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 rounded-lg px-1.5 py-1 text-[#00a884] hover:bg-white/5"
        title="Criar com IA"
        aria-label="Criar com IA"
      >
        <Spark />
      </button>
      {open &&
        createPortal(
          <AiCopyDialog
            channel={channel}
            audience={audience}
            onClose={() => setOpen(false)}
            onApply={(draft) => {
              onApply(draft);
              setOpen(false);
            }}
          />,
          document.body
        )}
    </>
  );
}

function AiCopyDialog({
  channel,
  audience,
  onClose,
  onApply
}: {
  channel: "whatsapp" | "email";
  audience: "group" | "person";
  onClose: () => void;
  onApply: (draft: Draft) => void;
}) {
  const [goal, setGoal] = useState<Goal>("venda");
  const [brief, setBrief] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaName, setMediaName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function attach(file: File) {
    setBusy(true);
    setError("");
    try {
      const data = await readFile(file);
      const r = await api<{ ok: boolean; url?: string; message?: string }>("/api/inbox/upload", {
        method: "POST",
        body: JSON.stringify({ data, mime: file.type })
      });
      if (!r.url) throw new Error(r.message ?? "Não foi possível guardar o arquivo.");
      setMediaUrl(r.url);
      setMediaName(file.name);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Não foi possível guardar o arquivo.");
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    setBusy(true);
    setError("");
    setDraft(null);
    try {
      const r = await api<Draft & { ok?: boolean; error?: string }>("/api/ai/draft", {
        method: "POST",
        body: JSON.stringify({ channel, audience, goal, brief, mediaUrl })
      });
      if (!r.text && !r.html) throw new Error(r.error ?? "A IA não devolveu texto.");
      setDraft(r);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Não foi possível criar o texto.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/75 p-4" role="dialog" aria-label="Criar com IA">
      <div className="w-full max-w-lg space-y-3 rounded-2xl border border-zinc-700 bg-zinc-950 p-4 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-white">Criar com IA</h2>
            <p className="text-xs text-zinc-400">Diga o que a mensagem precisa fazer. Imagem ou vídeo entram como referência.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-zinc-500 hover:bg-zinc-800" aria-label="Fechar">
            ✕
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {GOALS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setGoal(item.id)}
              className={`rounded-lg border px-2 py-1 text-xs ${goal === item.id ? "border-emerald-500/50 text-emerald-300" : "border-zinc-700 text-zinc-300"}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          rows={4}
          placeholder="Ex.: avisar que o setup de hoje já está no grupo e chamar quem ainda não entrou."
          className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-white"
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void attach(file);
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
            className="rounded-lg border border-zinc-700 px-2 py-1 text-xs text-zinc-200 disabled:opacity-60"
          >
            Imagem ou vídeo
          </button>
          {mediaName && <span className="text-xs text-zinc-400">{mediaName}</span>}
        </div>
        <p className="text-[11px] text-zinc-500">O vídeo entra por alguns quadros e pelo áudio, até 25 MB.</p>
        {error && <p className="text-xs text-amber-200">{error}</p>}
        {draft && (
          <div className="max-h-40 overflow-y-auto rounded-xl bg-zinc-900 p-3 text-xs text-zinc-200 whitespace-pre-wrap">
            {draft.subject && <p className="mb-1 text-zinc-400">Assunto: {draft.subject}</p>}
            {draft.preheader && <p className="mb-2 text-zinc-500">{draft.preheader}</p>}
            {draft.text}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" disabled={busy || brief.trim().length < 8} onClick={() => void generate()} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 disabled:opacity-60">
            {busy ? "Criando…" : "Criar"}
          </button>
          <button
            type="button"
            disabled={!draft}
            onClick={() => draft && onApply(draft)}
            className="rounded-lg bg-[#00a884] px-3 py-1.5 text-sm font-medium text-[#111b21] disabled:opacity-50"
          >
            Usar este texto
          </button>
        </div>
      </div>
    </div>
  );
}

function Spark() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3l1.4 4.6L18 9l-4.6 1.4L12 15l-1.4-4.6L6 9l4.6-1.4L12 3z" fill="currentColor" />
      <path d="M18 14l.7 2.3L21 17l-2.3.7L18 20l-.7-2.3L15 17l2.3-.7L18 14z" fill="currentColor" />
    </svg>
  );
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    reader.readAsDataURL(file);
  });
}
