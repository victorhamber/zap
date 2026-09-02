import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { EmailBlockEditor } from "./EmailBlockEditor";

type Props = {
  open: boolean;
  html: string;
  subject?: string;
  onClose: () => void;
  onSave: (html: string) => void;
};

export function EmailEditorModal({ open, html, subject, onClose, onSave }: Props) {
  const [draft, setDraft] = useState(html);
  const [editorKey, setEditorKey] = useState(0);

  useEffect(() => {
    if (open) {
      setDraft(html);
      setEditorKey((k) => k + 1);
    }
  }, [open, html]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      aria-label="Editor de e-mail"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="flex flex-col w-full max-w-6xl max-h-[min(94vh,900px)] rounded-2xl border border-zinc-700 bg-zinc-950 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-zinc-800 px-5 py-4 shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-white">Editor de e-mail</h2>
            <p className="text-sm text-zinc-500 mt-0.5">
              Monte o corpo com blocos arrastáveis, títulos e botões visuais.
              {subject ? (
                <>
                  {" "}
                  Assunto: <span className="text-zinc-400">{subject}</span>
                </>
              ) : null}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            aria-label="Fechar"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
          <EmailBlockEditor key={editorKey} html={html} onChange={setDraft} />
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-zinc-800 px-5 py-4 shrink-0 bg-zinc-950/95">
          <p className="text-[11px] text-zinc-600 hidden sm:block">
            Arraste pelo ícone ≡ para reordenar blocos
          </p>
          <div className="flex gap-2 ml-auto">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-900"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => {
                onSave(draft);
                onClose();
              }}
              className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
            >
              Salvar e-mail
            </button>
          </div>
        </footer>
      </div>
    </div>,
    document.body
  );
}
