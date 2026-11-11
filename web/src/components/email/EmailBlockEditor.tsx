import { useCallback, useRef, useState, type DragEvent } from "react";
import { api } from "../../api/client";
import { FLOW_TEMPLATE_VARIABLES, mustacheSnippet } from "../flow/flowTemplateVars";
import {
  blocksToHtml,
  createBlock,
  htmlToBlocks,
  newBlockId,
  reorderBlocks,
  type EmailBlock,
  type ButtonAlign
} from "./emailBlocks";

type Props = {
  html: string;
  onChange: (html: string) => void;
  subject?: string;
  preheader?: string;
};

const PALETTE: { title: string; items: { type: EmailBlock["type"]; label: string }[] }[] = [
  {
    title: "Básicos",
    items: [
      { type: "heading", label: "Título" },
      { type: "paragraph", label: "Texto" },
      { type: "list", label: "Lista" },
      { type: "button", label: "Botão" },
      { type: "divider", label: "Divisor" },
      { type: "spacer", label: "Espaço" }
    ]
  },
  { title: "Mídia", items: [{ type: "image", label: "Imagem" }] }
];

const BLOCK_TYPES = new Set<EmailBlock["type"]>([
  "heading",
  "paragraph",
  "list",
  "button",
  "image",
  "divider",
  "spacer"
]);

const BUTTON_PRESETS = [
  { label: "Verde", bg: "#10b981", text: "#ffffff" },
  { label: "Azul", bg: "#2563eb", text: "#ffffff" },
  { label: "Preto", bg: "#18181b", text: "#ffffff" },
  { label: "Outline", bg: "#ffffff", text: "#18181b" }
];

function VarChips({ onInsert }: { onInsert: (snippet: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1 mt-2">
      {FLOW_TEMPLATE_VARIABLES.slice(0, 10).map((v) => (
        <button
          key={v.key}
          type="button"
          onClick={() => onInsert(mustacheSnippet(v.key))}
          className="rounded-md border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 font-mono text-[10px] text-emerald-400/90 hover:bg-zinc-900"
          title={v.label}
        >
          {mustacheSnippet(v.key)}
        </button>
      ))}
    </div>
  );
}

function EmailImageLibrary({ onPick }: { onPick: (url: string, alt: string) => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<{ url: string; label: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setOpen(true);
    if (items.length > 0) return;
    setLoading(true);
    setError("");
    try {
      const r = await api<{
        items?: { url: string; kind: string; filename: string; previewLabel?: string }[];
      }>("/api/media?filter=all");
      setItems(
        (r.items ?? [])
          .filter((item) => item.kind === "image" && item.url)
          .map((item) => ({ url: item.url, label: item.previewLabel || item.filename }))
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Não foi possível abrir a biblioteca.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => void load()}
        className="rounded-lg border border-zinc-700 px-2 py-1 text-xs text-zinc-200 hover:border-emerald-500/40"
      >
        Biblioteca do Zap
      </button>
      {open && (
        <div className="max-h-40 overflow-y-auto rounded-lg border border-zinc-800 p-1">
          {loading && <p className="px-1 py-2 text-xs text-zinc-500">Carregando imagens…</p>}
          {error && <p className="px-1 py-2 text-xs text-amber-200">{error}</p>}
          {!loading && !error && items.length === 0 && (
            <p className="px-1 py-2 text-xs text-zinc-500">Nenhuma imagem na biblioteca.</p>
          )}
          <div className="grid grid-cols-3 gap-1">
            {items.map((item) => (
              <button
                key={item.url}
                type="button"
                title={item.label}
                onClick={() => onPick(item.url, item.label)}
                className="overflow-hidden rounded border border-zinc-800 hover:border-emerald-500"
              >
                <img src={item.url} alt="" className="h-16 w-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BlockEditor({
  block,
  onChange
}: {
  block: EmailBlock;
  onChange: (block: EmailBlock) => void;
}) {
  const insertInto = useCallback(
    (field: "text" | "html" | "label" | "href", snippet: string) => {
      if (block.type === "heading" && field === "text") {
        onChange({ ...block, text: block.text + snippet });
      } else if (block.type === "paragraph" && field === "html") {
        onChange({ ...block, html: block.html + snippet });
      } else if (block.type === "button" && (field === "label" || field === "href")) {
        onChange({ ...block, [field]: block[field] + snippet });
      }
    },
    [block, onChange]
  );

  switch (block.type) {
    case "heading":
      return (
        <div className="space-y-2">
          <div className="flex gap-2">
            {([1, 2, 3] as const).map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => onChange({ ...block, level })}
                className={`rounded-md px-2 py-1 text-xs ${
                  block.level === level
                    ? "bg-emerald-500/20 text-emerald-300"
                    : "bg-zinc-800 text-zinc-400"
                }`}
              >
                H{level}
              </button>
            ))}
          </div>
          <input
            value={block.text}
            onChange={(e) => onChange({ ...block, text: e.target.value })}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white"
            placeholder="Título"
          />
          <VarChips onInsert={(s) => insertInto("text", s)} />
        </div>
      );

    case "paragraph":
      return (
        <div>
          <textarea
            value={block.html}
            onChange={(e) => onChange({ ...block, html: e.target.value })}
            rows={4}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white resize-y min-h-[96px]"
            placeholder="Texto do parágrafo…"
          />
          <VarChips onInsert={(s) => insertInto("html", s)} />
        </div>
      );

    case "list":
      return (
        <div className="space-y-2">
          {block.items.map((item, idx) => (
            <div key={idx} className="flex gap-2">
              <span className="text-zinc-600 pt-2">•</span>
              <input
                value={item}
                onChange={(e) => {
                  const items = [...block.items];
                  items[idx] = e.target.value;
                  onChange({ ...block, items });
                }}
                className="flex-1 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-white"
              />
              <button
                type="button"
                onClick={() =>
                  onChange({ ...block, items: block.items.filter((_, i) => i !== idx) })
                }
                className="text-zinc-600 hover:text-red-400 px-1"
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => onChange({ ...block, items: [...block.items, "Novo item"] })}
            className="text-xs text-emerald-400 hover:text-emerald-300"
          >
            + Item
          </button>
        </div>
      );

    case "button":
      return (
        <div className="space-y-3">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950/80 p-3">
            <p className="mb-2 text-xs text-zinc-500">Como o botão chega</p>
            <div style={{ textAlign: block.align }}>
              <span
                style={{
                  display: "inline-block",
                  background: block.bgColor,
                  color: block.textColor,
                  padding: "10px 20px",
                  borderRadius: 8,
                  fontWeight: 600,
                  fontSize: 14,
                  border:
                    block.bgColor.toLowerCase() === "#ffffff" ? "1px solid #d4d4d8" : undefined
                }}
              >
                {block.label || "Botão"}
              </span>
            </div>
          </div>
          <label className="block text-[11px] text-zinc-500">Texto do botão</label>
          <input
            value={block.label}
            onChange={(e) => onChange({ ...block, label: e.target.value })}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white"
          />
          <label className="block text-[11px] text-zinc-500">Link (URL ou variável)</label>
          <input
            value={block.href}
            onChange={(e) => onChange({ ...block, href: e.target.value })}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-mono text-white"
            placeholder="https:// ou {{accessLink}}"
          />
          <div className="flex gap-2">
            {(["left", "center", "right"] as ButtonAlign[]).map((align) => (
              <button
                key={align}
                type="button"
                onClick={() => onChange({ ...block, align })}
                className={`flex-1 rounded-md py-1 text-xs ${
                  block.align === align
                    ? "bg-emerald-500/20 text-emerald-300"
                    : "bg-zinc-800 text-zinc-400"
                }`}
              >
                {align === "left" ? "Esquerda" : align === "center" ? "Centro" : "Direita"}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {BUTTON_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => onChange({ ...block, bgColor: p.bg, textColor: p.text })}
                className="rounded-full border border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-400 hover:border-emerald-500/40"
                style={{ background: p.bg, color: p.text }}
              >
                {p.label}
              </button>
            ))}
          </div>
          <VarChips onInsert={(s) => insertInto("href", s)} />
        </div>
      );

    case "image":
      return (
        <div className="space-y-2">
          <EmailImageLibrary
            onPick={(url, alt) => onChange({ ...block, src: url, alt: block.alt.trim() || alt })}
          />
          <input
            value={block.src}
            onChange={(e) => onChange({ ...block, src: e.target.value })}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-mono text-white"
            placeholder="Ou cole o link da imagem"
          />
          <input
            value={block.alt}
            onChange={(e) => onChange({ ...block, alt: e.target.value })}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white"
            placeholder="Texto alternativo (obrigatório para a imagem)"
          />
          {!block.alt.trim() && (
            <p className="text-xs text-amber-200">Sem descrição, filtros tratam a imagem como risco.</p>
          )}
          {block.src.trim() && (
            <img
              src={block.src}
              alt={block.alt}
              className="max-h-32 rounded-lg border border-zinc-800 object-contain"
            />
          )}
        </div>
      );

    case "divider":
      return (
        <div className="py-2">
          <hr className="border-zinc-700" />
          <p className="text-[11px] text-zinc-600 mt-2">Linha divisória</p>
        </div>
      );

    case "spacer":
      return (
        <div className="space-y-2">
          <label className="text-[11px] text-zinc-500">Altura (px): {block.px}</label>
          <input
            type="range"
            min={8}
            max={80}
            value={block.px}
            onChange={(e) => onChange({ ...block, px: Number(e.target.value) })}
            className="w-full"
          />
        </div>
      );

    default:
      return null;
  }
}

function blockTitle(block: EmailBlock): string {
  switch (block.type) {
    case "heading":
      return `Título H${block.level}`;
    case "paragraph":
      return "Texto";
    case "list":
      return "Lista";
    case "button":
      return "Botão CTA";
    case "image":
      return "Imagem";
    case "divider":
      return "Divisor";
    case "spacer":
      return "Espaço";
    default:
      return "Bloco";
  }
}

function cloneBlock(block: EmailBlock): EmailBlock {
  if (block.type === "list") return { ...block, id: newBlockId(), items: [...block.items] };
  return { ...block, id: newBlockId() };
}

export function EmailBlockEditor({ html, onChange, subject, preheader }: Props) {
  const origin = useRef<EmailBlock[]>([]);
  const [blocks, setBlocks] = useState<EmailBlock[]>(() => {
    const start = htmlToBlocks(html);
    origin.current = start;
    return start;
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const historyRef = useRef<EmailBlock[][] | null>(null);
  const historyIndex = useRef(0);
  const pending = useRef<number | null>(null);
  const latest = useRef(blocks);
  latest.current = blocks;

  const selected = blocks.find((b) => b.id === selectedId) ?? null;

  const remember = useCallback((next: EmailBlock[]) => {
    const base = historyRef.current ?? [origin.current];
    const cut = base.slice(0, historyIndex.current + 1);
    const last = cut[cut.length - 1];
    if (last && JSON.stringify(last) === JSON.stringify(next)) {
      historyRef.current = cut;
      return;
    }
    cut.push(next);
    if (cut.length > 40) cut.shift();
    historyRef.current = cut;
    historyIndex.current = cut.length - 1;
    setCanUndo(historyIndex.current > 0);
    setCanRedo(false);
  }, []);

  const commit = useCallback(
    (next: EmailBlock[], immediate = false) => {
      latest.current = next;
      setBlocks(next);
      onChange(blocksToHtml(next));
      if (pending.current) window.clearTimeout(pending.current);
      if (immediate) {
        remember(next);
        return;
      }
      pending.current = window.setTimeout(() => remember(next), 500);
    },
    [onChange, remember]
  );

  function applyHistory(index: number) {
    const snap = historyRef.current?.[index];
    if (!snap) return;
    historyIndex.current = index;
    latest.current = snap;
    setBlocks(snap);
    onChange(blocksToHtml(snap));
    setCanUndo(index > 0);
    setCanRedo(index < (historyRef.current?.length ?? 1) - 1);
  }

  function undo() {
    if (pending.current) {
      window.clearTimeout(pending.current);
      pending.current = null;
      remember(latest.current);
    }
    if (historyIndex.current <= 0) return;
    applyHistory(historyIndex.current - 1);
  }

  function redo() {
    const stack = historyRef.current;
    if (!stack || historyIndex.current >= stack.length - 1) return;
    applyHistory(historyIndex.current + 1);
  }

  function addBlock(type: EmailBlock["type"], beforeId?: string) {
    const created = createBlock(type);
    if (!beforeId) {
      commit([...blocks, created], true);
    } else {
      const idx = blocks.findIndex((b) => b.id === beforeId);
      const next = [...blocks];
      next.splice(idx < 0 ? next.length : idx, 0, created);
      commit(next, true);
    }
    setSelectedId(created.id);
  }

  function onDrop(e: DragEvent, beforeId?: string) {
    e.preventDefault();
    e.stopPropagation();
    const raw = e.dataTransfer.getData("text/zap-block") as EmailBlock["type"];
    if (BLOCK_TYPES.has(raw)) {
      addBlock(raw, beforeId);
      setDragId(null);
      return;
    }
    if (dragId && beforeId) commit(reorderBlocks(blocks, dragId, beforeId), true);
    setDragId(null);
  }

  return (
    <div className="grid h-auto min-h-[420px] grid-cols-1 rounded-xl border border-zinc-800 lg:h-[min(62vh,640px)] lg:overflow-hidden lg:grid-cols-[180px_minmax(0,1fr)_300px]">
      <aside className="min-h-0 overflow-y-auto border-b border-zinc-800 bg-zinc-950 p-3 lg:border-b-0 lg:border-r">
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-zinc-500">Elementos</p>
        {PALETTE.map((group) => (
          <div key={group.title} className="mb-4">
            <p className="mb-1.5 text-[11px] text-zinc-500">{group.title}</p>
            <div className="space-y-1">
              {group.items.map((item) => (
                <button
                  key={item.type}
                  type="button"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/zap-block", item.type);
                    e.dataTransfer.effectAllowed = "copy";
                  }}
                  onClick={() => addBlock(item.type)}
                  className="w-full cursor-grab rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-left text-sm text-zinc-200 hover:border-zinc-600"
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </aside>

      <section className="flex min-h-0 flex-col overflow-hidden bg-zinc-900">
        <div className="flex items-center gap-1 border-b border-zinc-800 px-2 py-1.5">
          <button type="button" disabled={!canUndo} onClick={undo} className="rounded px-2 py-1 text-sm text-zinc-300 disabled:opacity-30" title="Desfazer">
            ↶
          </button>
          <button type="button" disabled={!canRedo} onClick={redo} className="rounded px-2 py-1 text-sm text-zinc-300 disabled:opacity-30" title="Refazer">
            ↷
          </button>
          <button
            type="button"
            className="ml-auto rounded px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200"
            onClick={() => {
              if (!window.confirm("Limpar todos os blocos deste e-mail?")) return;
              setSelectedId(null);
              commit([], true);
            }}
          >
            Limpar
          </button>
        </div>
        <div
          className="min-h-0 flex-1 overflow-y-auto bg-[#e7e5e4] p-4"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => onDrop(e)}
        >
          <div className="mx-auto max-w-xl overflow-hidden rounded-lg bg-white shadow-sm">
            <div className="border-b border-zinc-200 px-5 py-3">
              <p className="text-sm font-medium text-zinc-900">{subject?.trim() || "Sem assunto"}</p>
              <p className="mt-0.5 text-xs text-zinc-500">
                {preheader?.trim() || "Sem linha de pré-visualização"}
              </p>
            </div>
            <div className="space-y-1 px-5 py-4">
              {blocks.length === 0 && (
                <p className="py-10 text-center text-sm text-zinc-400">Arraste um elemento para começar</p>
              )}
              {blocks.map((block) => {
                const on = block.id === selectedId;
                return (
                  <div
                    key={block.id}
                    draggable
                    onDragStart={() => setDragId(block.id)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => onDrop(e, block.id)}
                    onClick={() => setSelectedId(block.id)}
                    className={`cursor-pointer rounded-md px-1 ${on ? "ring-2 ring-emerald-500" : "hover:ring-1 hover:ring-zinc-300"}`}
                  >
                    <div
                      className="pointer-events-none text-zinc-900"
                      dangerouslySetInnerHTML={{ __html: blocksToHtml([block]) }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <aside className="min-h-0 overflow-y-auto border-t border-zinc-800 bg-zinc-950 p-3 lg:border-l lg:border-t-0">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">Propriedades</p>
          {selected && (
            <div className="flex gap-1">
              <button
                type="button"
                className="rounded px-1.5 py-0.5 text-[11px] text-zinc-400 hover:bg-zinc-900"
                onClick={() => {
                  const copy = cloneBlock(selected);
                  const idx = blocks.findIndex((b) => b.id === selected.id);
                  const next = [...blocks];
                  next.splice(idx + 1, 0, copy);
                  commit(next, true);
                  setSelectedId(copy.id);
                }}
              >
                Duplicar
              </button>
              <button
                type="button"
                className="rounded px-1.5 py-0.5 text-[11px] text-red-300 hover:bg-zinc-900"
                onClick={() => {
                  commit(blocks.filter((b) => b.id !== selected.id), true);
                  setSelectedId(null);
                }}
              >
                Remover
              </button>
            </div>
          )}
        </div>
        {!selected && (
          <p className="px-2 py-8 text-center text-sm text-zinc-500">
            Selecione um elemento para editar
          </p>
        )}
        {selected && (
          <div>
            <p className="mb-2 text-sm text-zinc-200">{blockTitle(selected)}</p>
            <BlockEditor block={selected} onChange={(patch) => commit(blocks.map((b) => (b.id === selected.id ? patch : b)))} />
          </div>
        )}
      </aside>
    </div>
  );
}
