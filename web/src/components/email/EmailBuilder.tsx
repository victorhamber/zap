import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { useEffect } from "react";
import { FLOW_TEMPLATE_VARIABLES, mustacheSnippet } from "../flow/flowTemplateVars";

type Props = {
  html: string;
  onChange: (html: string) => void;
};

const TEMPLATES: { id: string; label: string; html: string }[] = [
  {
    id: "simple",
    label: "Aviso simples",
    html: `<p>Olá <strong>{{name}}</strong>,</p>
<p>Temos uma novidade importante para você.</p>
<p style="color:#71717a;font-size:13px">Equipe de suporte</p>`
  },
  {
    id: "cta",
    label: "Com botão CTA",
    html: `<p>Olá <strong>{{name}}</strong>,</p>
<p>Seu acesso está pronto. Clique no botão abaixo para continuar:</p>
<p style="margin:24px 0;text-align:center">
  <a href="{{accessLink}}" style="display:inline-block;background:#10b981;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600">Acessar agora</a>
</p>
<p style="color:#71717a;font-size:13px">Se o botão não funcionar, copie o link: {{accessLink}}</p>`
  }
];

function ToolbarButton({
  label,
  active,
  onClick
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-2 py-1 text-[11px] font-medium transition ${
        active
          ? "bg-emerald-500/20 text-emerald-300"
          : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
      }`}
    >
      {label}
    </button>
  );
}

export function EmailBuilder({ html, onChange }: Props) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { style: "color:#059669;text-decoration:underline" }
      }),
      Image.configure({
        HTMLAttributes: { style: "max-width:100%;height:auto;border-radius:8px" }
      })
    ],
    content: html || "<p></p>",
    onUpdate: ({ editor: ed }) => {
      onChange(ed.getHTML());
    },
    editorProps: {
      attributes: {
        class:
          "min-h-[180px] max-h-[320px] overflow-y-auto rounded-b-xl border border-t-0 border-zinc-700 bg-white px-3 py-2 text-sm text-zinc-900 focus:outline-none prose prose-sm max-w-none"
      }
    }
  });

  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    if (html && html !== current && !editor.isFocused) {
      editor.commands.setContent(html, { emitUpdate: false });
    }
  }, [html, editor]);

  if (!editor) return null;

  function insertVar(key: string) {
    editor?.chain().focus().insertContent(mustacheSnippet(key)).run();
  }

  function applyTemplate(tplHtml: string) {
    editor?.commands.setContent(tplHtml);
    onChange(tplHtml);
  }

  function addLink() {
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("URL do link", prev || "https://");
    if (url === null) return;
    if (!url.trim()) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
  }

  function addCta() {
    const url = window.prompt("URL do botão", "https://");
    if (!url?.trim()) return;
    const label = window.prompt("Texto do botão", "Quero acessar") || "Quero acessar";
    editor
      .chain()
      .focus()
      .insertContent(
        `<p style="margin:24px 0;text-align:center"><a href="${url.trim()}" style="display:inline-block;background:#10b981;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600">${label}</a></p>`
      )
      .run();
  }

  function addImage() {
    const url = window.prompt("URL da imagem", "https://");
    if (!url?.trim()) return;
    editor.chain().focus().setImage({ src: url.trim() }).run();
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {TEMPLATES.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => applyTemplate(t.html)}
            className="rounded-full border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[11px] text-zinc-400 hover:border-emerald-500/40 hover:text-emerald-300"
          >
            Template: {t.label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-1 rounded-t-xl border border-zinc-700 bg-zinc-900/80 p-1.5">
        <ToolbarButton
          label="B"
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
        />
        <ToolbarButton
          label="I"
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        />
        <ToolbarButton
          label="H2"
          active={editor.isActive("heading", { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        />
        <ToolbarButton
          label="Lista"
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        />
        <ToolbarButton label="Link" active={editor.isActive("link")} onClick={addLink} />
        <ToolbarButton label="CTA" onClick={addCta} />
        <ToolbarButton label="Img" onClick={addImage} />
      </div>

      <EditorContent editor={editor} />

      <div>
        <div className="mb-1 text-[10px] uppercase tracking-wide text-zinc-600">Variáveis</div>
        <div className="flex flex-wrap gap-1">
          {FLOW_TEMPLATE_VARIABLES.slice(0, 8).map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => insertVar(v.key)}
              className="rounded-md border border-zinc-800 bg-zinc-950 px-1.5 py-0.5 font-mono text-[10px] text-emerald-400/90 hover:bg-zinc-900"
              title={v.label}
            >
              {mustacheSnippet(v.key)}
            </button>
          ))}
        </div>
      </div>

      <details className="rounded-xl border border-zinc-800 bg-zinc-950/60">
        <summary className="cursor-pointer px-3 py-2 text-xs text-zinc-500">Preview do HTML</summary>
        <div
          className="border-t border-zinc-800 bg-zinc-100 p-4 text-sm text-zinc-900"
          dangerouslySetInnerHTML={{ __html: html || "<p></p>" }}
        />
      </details>
    </div>
  );
}
