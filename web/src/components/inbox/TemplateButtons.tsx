import { memo } from "react";
import { LinkifyText } from "./LinkifyText";

/**
 * Mensagens de template / botão são gravadas como texto + linhas "▸ Rótulo → url".
 * O painel não consegue reproduzir o botão nativo do WhatsApp, então cada botão
 * vira um link (ou um rótulo sem ação, quando o botão era de resposta rápida).
 *
 * Templates recebidos via Evolution (Meta→você) às vezes vêm sem corpo hidratado —
 * gravamos um aviso explícito para o atendente olhar no celular.
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
      // Lixo estrutural que o parser antigo às vezes gravava no corpo.
      const t = line.trim();
      if (
        /^(cta_url|cta_call|quick_reply|copy_code)$/i.test(t) ||
        (/^[{\[]/.test(t) && /[}\]]$/.test(t)) ||
        /^\d{10,}$/.test(t)
      ) {
        continue;
      }
      textLines.push(line);
      continue;
    }
    const raw = match[1].trim();
    if (/^(cta_url|cta_call|quick_reply|copy_code)$/i.test(raw)) continue;
    if (/^[{\[]/.test(raw) && /[}\]]$/.test(raw)) continue;
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

/** Placeholder de template/botão sem texto hidratado (Evolution/Baileys). */
export function isOpaqueInteractiveBody(body: string | undefined): boolean {
  if (!body) return false;
  const t = body.replace(/^\uFEFF/, "").trim();
  return (
    /^(📄\s*)?(Mensagem com botões|Mensagem interativa)(\s*\(|$)/i.test(t.split("\n")[0] ?? "") ||
    /^📄\s*Template:/i.test(t) ||
    /não chega pela Evolution/i.test(t) ||
    /nao chega pela Evolution/i.test(t)
  );
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
  const opaque = isOpaqueInteractiveBody(body);
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const title = lines[0] ?? "📄 Mensagem interativa";
  const rest = lines.slice(1);

  if (opaque) {
    return (
      <div className="space-y-1.5 min-w-[200px]">
        <div className="flex items-start gap-2">
          <span className="text-base leading-none mt-0.5" aria-hidden>
            📄
          </span>
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium text-[#e9edef]">
              {title.replace(/^📄\s*/, "")}
            </p>
            {rest.map((line, i) => (
              <p key={i} className="text-[12px] leading-snug text-[#8696a0]">
                {line}
              </p>
            ))}
            {rest.length === 0 && (
              <p className="text-[12px] leading-snug text-[#8696a0]">
                O texto completo não chega pela Evolution. Veja no WhatsApp do celular.
              </p>
            )}
          </div>
        </div>
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
  }

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
