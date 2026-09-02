export type ButtonAlign = "left" | "center" | "right";

export type EmailBlock =
  | { id: string; type: "heading"; level: 1 | 2 | 3; text: string }
  | { id: string; type: "paragraph"; html: string }
  | { id: string; type: "list"; items: string[] }
  | {
      id: string;
      type: "button";
      label: string;
      href: string;
      align: ButtonAlign;
      bgColor: string;
      textColor: string;
    }
  | { id: string; type: "image"; src: string; alt: string }
  | { id: string; type: "divider" }
  | { id: string; type: "spacer"; px: number };

export function newBlockId(): string {
  return `b_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createBlock(type: EmailBlock["type"]): EmailBlock {
  const id = newBlockId();
  switch (type) {
    case "heading":
      return { id, type: "heading", level: 2, text: "Título do e-mail" };
    case "paragraph":
      return { id, type: "paragraph", html: "Olá {{name}},\n\nEscreva sua mensagem aqui." };
    case "list":
      return { id, type: "list", items: ["Item 1", "Item 2"] };
    case "button":
      return {
        id,
        type: "button",
        label: "Quero acessar",
        href: "{{accessLink}}",
        align: "center",
        bgColor: "#10b981",
        textColor: "#ffffff"
      };
    case "image":
      return { id, type: "image", src: "https://", alt: "" };
    case "divider":
      return { id, type: "divider" };
    case "spacer":
      return { id, type: "spacer", px: 24 };
    default:
      return { id, type: "paragraph", html: "" };
  }
}

function alignStyle(align: ButtonAlign): string {
  if (align === "left") return "text-align:left";
  if (align === "right") return "text-align:right";
  return "text-align:center";
}

function paragraphHtmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return (doc.body.textContent ?? html).trim();
}

function textToParagraphHtml(text: string): string {
  const lines = text.split("\n");
  if (lines.length <= 1) {
    return `<p>${escapeForHtml(lines[0] ?? "")}</p>`;
  }
  return lines.map((line) => `<p>${escapeForHtml(line)}</p>`).join("");
}

function escapeForHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Converte blocos visuais em HTML compatível com Resend / clientes de e-mail. */
export function blocksToHtml(blocks: EmailBlock[]): string {
  const parts: string[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case "heading":
        parts.push(`<h${block.level}>${escapeForHtml(block.text)}</h${block.level}>`);
        break;
      case "paragraph": {
        const raw = block.html.trim();
        if (!raw) break;
        if (raw.startsWith("<")) {
          parts.push(raw);
        } else {
          parts.push(textToParagraphHtml(raw));
        }
        break;
      }
      case "list":
        if (block.items.length === 0) break;
        parts.push(
          `<ul>${block.items.map((i) => `<li>${escapeForHtml(i)}</li>`).join("")}</ul>`
        );
        break;
      case "button":
        if (!block.label.trim()) break;
        parts.push(
          `<p style="margin:24px 0;${alignStyle(block.align)}"><a href="${block.href.trim()}" style="display:inline-block;background:${block.bgColor};color:${block.textColor};text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600">${escapeForHtml(block.label)}</a></p>`
        );
        break;
      case "image":
        if (!block.src.trim()) break;
        parts.push(
          `<p style="text-align:center"><img src="${block.src.trim()}" alt="${escapeForHtml(block.alt)}" style="max-width:100%;height:auto;border-radius:8px" /></p>`
        );
        break;
      case "divider":
        parts.push(`<hr style="border:none;border-top:1px solid #e4e4e7;margin:24px 0" />`);
        break;
      case "spacer":
        parts.push(`<div style="height:${Math.max(8, block.px)}px"></div>`);
        break;
      default:
        break;
    }
  }
  return parts.join("\n") || "<p></p>";
}

function parseButtonFromParagraph(el: HTMLElement): EmailBlock | null {
  const a = el.querySelector("a");
  if (!a) return null;
  const style = (el.getAttribute("style") ?? "").toLowerCase();
  const align: ButtonAlign = style.includes("right")
    ? "right"
    : style.includes("left")
      ? "left"
      : "center";
  const aStyle = a.getAttribute("style") ?? "";
  const bgMatch = aStyle.match(/background:\s*([^;]+)/i);
  const colorMatch = aStyle.match(/(?:^|;)color:\s*([^;]+)/i);
  return {
    id: newBlockId(),
    type: "button",
    label: a.textContent?.trim() || "Botão",
    href: a.getAttribute("href") || "https://",
    align,
    bgColor: bgMatch?.[1]?.trim() || "#10b981",
    textColor: colorMatch?.[1]?.trim() || "#ffffff"
  };
}

/** Importa HTML existente (TipTap / templates) para blocos editáveis. */
export function htmlToBlocks(html: string): EmailBlock[] {
  const trimmed = html?.trim();
  if (!trimmed) {
    return [createBlock("paragraph")];
  }

  const doc = new DOMParser().parseFromString(trimmed, "text/html");
  const blocks: EmailBlock[] = [];

  for (const el of Array.from(doc.body.children)) {
    const tag = el.tagName.toUpperCase();
    if (tag === "H1" || tag === "H2" || tag === "H3") {
      blocks.push({
        id: newBlockId(),
        type: "heading",
        level: Number(tag.slice(1)) as 1 | 2 | 3,
        text: el.textContent?.trim() || ""
      });
    } else if (tag === "UL" || tag === "OL") {
      blocks.push({
        id: newBlockId(),
        type: "list",
        items: Array.from(el.querySelectorAll("li")).map((li) => li.textContent?.trim() || "")
      });
    } else if (tag === "HR") {
      blocks.push({ id: newBlockId(), type: "divider" });
    } else if (tag === "IMG") {
      blocks.push({
        id: newBlockId(),
        type: "image",
        src: el.getAttribute("src") || "",
        alt: el.getAttribute("alt") || ""
      });
    } else if (tag === "P") {
      const btn = parseButtonFromParagraph(el as HTMLElement);
      if (btn) {
        blocks.push(btn);
      } else if (el.querySelector("img")) {
        const img = el.querySelector("img")!;
        blocks.push({
          id: newBlockId(),
          type: "image",
          src: img.getAttribute("src") || "",
          alt: img.getAttribute("alt") || ""
        });
      } else {
        blocks.push({
          id: newBlockId(),
          type: "paragraph",
          html: paragraphHtmlToText(el.innerHTML) || el.textContent?.trim() || ""
        });
      }
    } else if (tag === "DIV") {
      const h = (el as HTMLElement).style.height;
      const px = h ? parseInt(h, 10) : 0;
      if (px > 0) {
        blocks.push({ id: newBlockId(), type: "spacer", px });
      } else {
        blocks.push({
          id: newBlockId(),
          type: "paragraph",
          html: el.textContent?.trim() || ""
        });
      }
    }
  }

  return blocks.length > 0 ? blocks : [createBlock("paragraph")];
}

export function reorderBlocks(blocks: EmailBlock[], fromId: string, toId: string): EmailBlock[] {
  if (fromId === toId) return blocks;
  const fromIdx = blocks.findIndex((b) => b.id === fromId);
  const toIdx = blocks.findIndex((b) => b.id === toId);
  if (fromIdx < 0 || toIdx < 0) return blocks;
  const next = [...blocks];
  const [moved] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, moved);
  return next;
}

export function htmlPreviewText(html: string, maxLen = 120): string {
  let text = "";
  if (typeof DOMParser !== "undefined") {
    const doc = new DOMParser().parseFromString(html, "text/html");
    text = (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
  } else {
    text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  if (text.length <= maxLen) return text || "(vazio)";
  return `${text.slice(0, maxLen)}…`;
}
