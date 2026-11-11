import { useCallback, useMemo, useState, type DragEvent, type ReactNode } from "react";
import { FLOW_TEMPLATE_VARIABLES, mustacheSnippet } from "../flow/flowTemplateVars";
import {
  blocksToHtml,
  createBlock,
  htmlToBlocks,
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

const BLOCK_PALETTE: { type: EmailBlock["type"]; label: string; hint: string }[] = [
  { type: "heading", label: "Título", hint: "H1 / H2 / H3" },
  { type: "paragraph", label: "Texto", hint: "Parágrafo" },
  { type: "list", label: "Lista", hint: "Bullet points" },
  { type: "button", label: "Botão", hint: "CTA visual" },
  { type: "image", label: "Imagem", hint: "URL da imagem" },
  { type: "divider", label: "Divisor", hint: "Linha horizontal" },
  { type: "spacer", label: "Espaço", hint: "Margem vertical" }
];

const BUTTON_PRESETS = [
  { label: "Verde", bg: "#10b981", text: "#ffffff" },
  { label: "Azul", bg: "#2563eb", text: "#ffffff" },
  { label: "Preto", bg: "#18181b", text: "#ffffff" },
  { label: "Outline", bg: "#ffffff", text: "#18181b" }
];

function BlockShell({
  index,
  title,
  blockId,
  onRemove,
  onDragStart,
  onDragOver,
  onDrop,
  children
}: {
  index: number;
  title: string;
  blockId: string;
  onRemove: () => void;
  onDragStart: (id: string) => void;
  onDragOver: (e: DragEvent) => void;
  onDrop: (id: string) => void;
  children: ReactNode;
}) {
  return (
    <div
      className="group rounded-xl border border-zinc-700/80 bg-zinc-900/60 overflow-hidden"
      onDragOver={onDragOver}
      onDrop={(e) => {
        e.preventDefault();
        onDrop(blockId);
      }}
    >
      <div className="flex items-center gap-2 border-b border-zinc-800/80 bg-zinc-950/50 px-2 py-1.5">
        <button
          type="button"
          draggable
          onDragStart={() => onDragStart(blockId)}
          className="cursor-grab touch-none rounded p-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300 active:cursor-grabbing"
          title="Arrastar bloco"
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="currentColor">
            <circle cx="5" cy="4" r="1.2" />
            <circle cx="11" cy="4" r="1.2" />
            <circle cx="5" cy="8" r="1.2" />
            <circle cx="11" cy="8" r="1.2" />
            <circle cx="5" cy="12" r="1.2" />
            <circle cx="11" cy="12" r="1.2" />
          </svg>
        </button>
        <span className="text-[11px] font-medium text-zinc-400 flex-1">
          {index + 1}. {title}
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="rounded p-1 text-zinc-600 hover:bg-red-500/10 hover:text-red-400 opacity-0 group-hover:opacity-100 transition"
          title="Remover bloco"
        >
          ✕
        </button>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

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
          <input
            value={block.src}
            onChange={(e) => onChange({ ...block, src: e.target.value })}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-mono text-white"
            placeholder="URL da imagem"
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
          {block.src.startsWith("http") && (
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

export function EmailBlockEditor({ html, onChange, subject, preheader }: Props) {
  const [blocks, setBlocks] = useState<EmailBlock[]>(() => htmlToBlocks(html));
  const [dragId, setDragId] = useState<string | null>(null);

  const previewHtml = useMemo(() => blocksToHtml(blocks), [blocks]);

  const commit = useCallback(
    (next: EmailBlock[]) => {
      setBlocks(next);
      onChange(blocksToHtml(next));
    },
    [onChange]
  );

  const updateBlock = (id: string, patch: EmailBlock) => {
    commit(blocks.map((b) => (b.id === id ? patch : b)));
  };

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {BLOCK_PALETTE.map((item) => (
            <button
              key={item.type}
              type="button"
              title={item.hint}
              onClick={() => commit([...blocks, createBlock(item.type)])}
              className="rounded-full border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:border-emerald-500/40 hover:bg-zinc-900"
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="max-h-[min(58vh,520px)] space-y-3 overflow-y-auto pr-1">
          {blocks.length === 0 && (
            <p className="py-8 text-center text-sm text-zinc-400">
              Adicione um bloco para começar o e-mail.
            </p>
          )}
          {blocks.map((block, index) => (
            <BlockShell
              key={block.id}
              index={index}
              title={blockTitle(block)}
              blockId={block.id}
              onRemove={() => commit(blocks.filter((b) => b.id !== block.id))}
              onDragStart={setDragId}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(targetId) => {
                if (dragId) commit(reorderBlocks(blocks, dragId, targetId));
                setDragId(null);
              }}
            >
              <BlockEditor block={block} onChange={(patch) => updateBlock(block.id, patch)} />
            </BlockShell>
          ))}
        </div>
      </div>

      <aside className="w-full shrink-0 lg:w-[340px]">
        <p className="mb-2 text-sm text-zinc-300">Como chega na caixa</p>
        <div className="overflow-hidden rounded-2xl border border-zinc-700 bg-[#f4f4f5]">
          <div className="border-b border-zinc-200 bg-white px-4 py-3">
            <p className="text-sm font-medium text-zinc-900">{subject?.trim() || "Sem assunto"}</p>
            <p className="mt-0.5 text-xs text-zinc-500">{preheader?.trim() || "Sem linha de pré-visualização"}</p>
          </div>
          <div
            className="max-h-[min(52vh,480px)] overflow-y-auto px-4 py-4 text-sm text-zinc-900"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        </div>
      </aside>
    </div>
  );
}
