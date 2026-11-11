import { createHmac, timingSafeEqual } from "node:crypto";

export type DnsRecordState = "verified" | "pending" | "missing";

export type DomainCheck = {
  domain: string;
  found: boolean;
  status: string | null;
  spf: DnsRecordState;
  dkim: DnsRecordState;
  dmarc: DnsRecordState;
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

/** Versão texto do mesmo corpo. Caixas desconfiam de e-mail que só tem HTML. */
export function htmlToPlainText(html: string): string {
  const withLinks = html.replace(
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_all, href: string, label: string) => {
      const name = label.replace(/<[^>]+>/g, "").trim();
      return name && name !== href ? `${name} (${href})` : href;
    }
  );
  const text = withLinks
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h1|h2|h3|div|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  return decodeEntities(text)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function signUnsubscribeToken(email: string, secret: string): string {
  const normalized = email.trim().toLowerCase();
  const body = Buffer.from(normalized, "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(normalized).digest("base64url");
  return `${body}.${sig}`;
}

export function readUnsubscribeToken(token: string, secret: string): string | null {
  const splitAt = token.lastIndexOf(".");
  if (splitAt <= 0) return null;
  const body = token.slice(0, splitAt);
  const sig = token.slice(splitAt + 1);
  let email: string;
  try {
    email = Buffer.from(body, "base64url").toString("utf8").trim().toLowerCase();
  } catch {
    return null;
  }
  if (!email.includes("@") || email.includes("\n")) return null;
  const expected = createHmac("sha256", secret).update(email).digest("base64url");
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  return email;
}

export function unsubscribeUrl(publicBase: string, email: string, secret: string): string {
  const base = publicBase.replace(/\/$/, "");
  const token = signUnsubscribeToken(email, secret);
  return `${base}/api/email/unsubscribe?t=${encodeURIComponent(token)}`;
}

export function wrapEmailHtml(options: {
  bodyHtml: string;
  preheader?: string;
  from: string;
  fromName: string;
  postalAddress?: string;
  unsubscribeHref: string;
}): string {
  const inner = String(options.bodyHtml ?? "").trim();
  const preheader = (options.preheader ?? "").trim();
  const who = options.fromName.trim() || options.from;
  const address = (options.postalAddress ?? "").trim();
  const footer = `<p style="margin:28px 0 0;padding-top:16px;border-top:1px solid #e4e4e7;font-size:12px;line-height:1.5;color:#71717a;">
Você recebe este e-mail porque pediu um contato ou uma compra.<br/>
${escapeHtml(who)} · ${escapeHtml(options.from)}${address ? `<br/>${escapeHtml(address)}` : ""}<br/>
<a href="${escapeHtml(options.unsubscribeHref)}" style="color:#52525b;">Não quero mais receber</a>
</p>`;
  const preview = preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheader)}</div>`
    : "";

  if (/<html[\s>]/i.test(inner)) {
    if (/<\/body>/i.test(inner)) {
      return inner.replace(/<\/body>/i, `${preview}${footer}</body>`);
    }
    return `${inner}${preview}${footer}`;
  }

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>E-mail</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#18181b;">
  ${preview}
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f4f5;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;border:1px solid #e4e4e7;">
          <tr>
            <td style="padding:28px 28px 32px;font-size:15px;line-height:1.55;">
              ${inner}
              ${footer}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function recordState(records: unknown[], name: string): DnsRecordState {
  const matches = records.filter((row) => {
    if (!row || typeof row !== "object") return false;
    const record = String((row as { record?: string }).record ?? "").toLowerCase();
    return record === name.toLowerCase();
  }) as { status?: string }[];
  if (matches.length === 0) return "missing";
  if (matches.every((row) => String(row.status ?? "").toLowerCase() === "verified")) return "verified";
  return "pending";
}

/** Lê a lista de domínios da Resend e diz se SPF, DKIM e DMARC estão verificados. */
export function summarizeResendDomains(payload: unknown, fromEmail: string): DomainCheck {
  const domain = fromEmail.split("@")[1]?.trim().toLowerCase() ?? "";
  const list = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)
      ? (payload as { data: unknown[] }).data
      : [];
  const hit = list.find((row) => {
    if (!row || typeof row !== "object") return false;
    return String((row as { name?: string }).name ?? "").trim().toLowerCase() === domain;
  }) as { status?: string; records?: unknown[] } | undefined;
  const records = Array.isArray(hit?.records) ? hit.records : [];
  return {
    domain,
    found: Boolean(hit),
    status: hit ? String(hit.status ?? "") || null : null,
    spf: recordState(records, "SPF"),
    dkim: recordState(records, "DKIM"),
    dmarc: recordState(records, "DMARC")
  };
}
