import { memo } from "react";
import { LinkifyText } from "./LinkifyText";

/**
 * Mensagens de template / botão são gravadas como texto + linhas "▸ Rótulo → url".
 * O painel não consegue reproduzir o botão nativo do WhatsApp, então cada botão
 * vira um link (ou um rótulo sem ação, quando o botão era de resposta rápida).
 */
const BUTTON_LINE = /^\s*▸\s*(.+)$/;
const LABEL_URL = /^(.*?)\s*→\s*(\S+)$/;
const BARE_URL = /^(?:https?:\/\/|www\.)\S+$/i;

export type TemplateButton = { label: string; url?: string };

export type ParsedTemplateBody = {
  text: string;
  buttons: TemplateButton[];
};

export function parseTemplateBody(body: string): ParsedTemplateBody {
  const lines = (body ?? "").split("\n");
  const textLines: string[] = [];
  const buttons: TemplateButton[] = [];

  for (const line of lines) {
    const match = BUTTON_LINE.exec(line);
    if (!match) {
      textLines.push(line);
      continue;
    }
    const raw = match[1].trim();
    const withUrl = LABEL_URL.exec(raw);
    if (withUrl) {
      buttons.push({ label: withUrl[1].trim() || withUrl[2], url: withUrl[2] });
    } else if (BARE_URL.test(raw)) {
      buttons.push({ label: raw, url: raw });
    } else {
      buttons.push({ label: raw });
    }
  }

  return { text: textLines.join("\n").trim(), buttons };
}

export function hasTemplateButtons(body: string | undefined): boolean {
  return typeof body === "string" && body.includes("▸");
}

function normalizeHref(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

export const TemplateMessageBody = memo(function TemplateMessageBody({
  body
}: {
  body: string;
}) {
  const { text, buttons } = parseTemplateBody(body);

  return (
    <div className="space-y-1.5">
      {text && (
        <p className="text-sm whitespace-pre-wrap">
          <LinkifyText text={text} />
        </p>
      )}
      {buttons.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-[#ffffff1a] pt-1.5">
          {buttons.map((b, i) =>
            b.url ? (
              <a
                key={`${i}-${b.url}`}
                href={normalizeHref(b.url)}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                title={b.url}
                className="flex items-center justify-center gap-1.5 rounded px-2 py-1 text-[13px] font-medium text-[#53bdeb] hover:bg-[#ffffff14] hover:underline break-all"
              >
                <span aria-hidden>🔗</span>
                <span className="truncate">{b.label}</span>
              </a>
            ) : (
              <span
                key={`${i}-${b.label}`}
                className="flex items-center justify-center rounded px-2 py-1 text-[13px] text-[var(--wa-text-secondary)] break-all"
              >
                {b.label}
              </span>
            )
          )}
        </div>
      )}
    </div>
  );
});
