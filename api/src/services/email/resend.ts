import { Resend } from "resend";
import { prisma } from "../../prisma.js";
import { env } from "../../env.js";
import { decryptSecret, encryptSecret, maskSecret, isEncryptionConfigured } from "../secretCrypto.js";
import {
  htmlToPlainText,
  summarizeResendDomains,
  unsubscribeUrl,
  wrapEmailHtml,
  type DomainCheck
} from "./deliverability.js";

export type EmailSettingsDto = {
  hasApiKey: boolean;
  apiKeyMasked: string | null;
  emailFrom: string;
  emailFromName: string;
  emailReplyTo: string;
  emailPostalAddress: string;
  encryptionReady: boolean;
};

async function getSettingsRow() {
  if (!prisma) throw new Error("Banco indisponível");
  return prisma.appSettings.upsert({
    where: { id: "default" },
    update: {},
    create: { id: "default" }
  });
}

export async function getEmailSettingsDto(): Promise<EmailSettingsDto> {
  const row = await getSettingsRow();
  let apiKeyMasked: string | null = null;
  if (row.resendApiKeyEnc) {
    try {
      apiKeyMasked = maskSecret(decryptSecret(row.resendApiKeyEnc));
    } catch {
      apiKeyMasked = "re_…";
    }
  }
  return {
    hasApiKey: Boolean(row.resendApiKeyEnc),
    apiKeyMasked,
    emailFrom: row.emailFrom ?? "",
    emailFromName: row.emailFromName ?? "",
    emailReplyTo: row.emailReplyTo ?? "",
    emailPostalAddress: row.emailPostalAddress ?? "",
    encryptionReady: isEncryptionConfigured()
  };
}

export async function saveEmailSettings(input: {
  apiKey?: string | null;
  removeApiKey?: boolean;
  emailFrom?: string;
  emailFromName?: string;
  emailReplyTo?: string;
  emailPostalAddress?: string;
}): Promise<EmailSettingsDto> {
  const row = await getSettingsRow();
  let resendApiKeyEnc = row.resendApiKeyEnc;

  if (input.removeApiKey) {
    resendApiKeyEnc = null;
  } else if (typeof input.apiKey === "string" && input.apiKey.trim()) {
    if (!isEncryptionConfigured()) {
      throw new Error("Criptografia não configurada (AI_ENCRYPTION_KEY ou JWT_SECRET)");
    }
    resendApiKeyEnc = encryptSecret(input.apiKey.trim());
  }

  const emailFrom =
    input.emailFrom !== undefined ? input.emailFrom.trim() : (row.emailFrom ?? "");
  const emailFromName =
    input.emailFromName !== undefined ? input.emailFromName.trim() : (row.emailFromName ?? "");
  const emailReplyTo =
    input.emailReplyTo !== undefined ? input.emailReplyTo.trim() : (row.emailReplyTo ?? "");
  const emailPostalAddress =
    input.emailPostalAddress !== undefined
      ? input.emailPostalAddress.trim()
      : (row.emailPostalAddress ?? "");

  await prisma!.appSettings.update({
    where: { id: "default" },
    data: {
      resendApiKeyEnc,
      emailFrom: emailFrom || null,
      emailFromName: emailFromName || null,
      emailReplyTo: emailReplyTo || null,
      emailPostalAddress: emailPostalAddress || null
    }
  });

  return getEmailSettingsDto();
}

async function loadResendClient(): Promise<{
  client: Resend;
  apiKey: string;
  from: string;
  fromName: string;
  replyTo: string;
  postalAddress: string;
}> {
  const row = await getSettingsRow();
  if (!row.resendApiKeyEnc) {
    throw new Error("API key do Resend não configurada. Vá em Configurações → E-mail.");
  }
  let apiKey: string;
  try {
    apiKey = decryptSecret(row.resendApiKeyEnc);
  } catch {
    throw new Error("Não foi possível descriptografar a API key do Resend.");
  }
  const from = String(row.emailFrom ?? "").trim();
  if (!from || !from.includes("@")) {
    throw new Error("Remetente (From) inválido. Configure o e-mail em Configurações → E-mail.");
  }
  return {
    client: new Resend(apiKey),
    apiKey,
    from,
    fromName: String(row.emailFromName ?? "").trim(),
    replyTo: String(row.emailReplyTo ?? "").trim(),
    postalAddress: String(row.emailPostalAddress ?? "").trim()
  };
}

function formatFrom(from: string, fromName: string): string {
  if (!fromName) return from;
  // "Name <email@domain>"
  const safe = fromName.replace(/[<>"]/g, "").trim();
  return safe ? `${safe} <${from}>` : from;
}

export async function sendTransactionalEmail(params: {
  to: string;
  subject: string;
  html: string;
  preheader?: string;
  replyTo?: string;
}): Promise<{ id: string | null; skipped?: "unsubscribed" }> {
  const to = params.to.trim().toLowerCase();
  if (prisma) {
    const blocked = await prisma.emailSuppression.findUnique({ where: { email: to } });
    if (blocked) return { id: null, skipped: "unsubscribed" };
  }

  const { client, from, fromName, replyTo: defaultReplyTo, postalAddress } = await loadResendClient();
  const replyTo = (params.replyTo || defaultReplyTo).trim();
  const cancelHref = unsubscribeUrl(env.APP_PUBLIC_URL, to, env.JWT_SECRET);
  const wrappedHtml = wrapEmailHtml({
    bodyHtml: params.html,
    preheader: params.preheader,
    from,
    fromName,
    postalAddress,
    unsubscribeHref: cancelHref
  });
  const text = [
    htmlToPlainText(params.html),
    "",
    "Não quero mais receber:",
    cancelHref
  ].join("\n");
  const mailto = replyTo || from;

  const { data, error } = await client.emails.send({
    from: formatFrom(from, fromName),
    to: [to],
    subject: params.subject,
    html: wrappedHtml,
    text,
    headers: {
      "List-Unsubscribe": `<mailto:${mailto}?subject=Cancelar%20e-mails>, <${cancelHref}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"
    },
    ...(replyTo ? { replyTo } : {})
  });

  if (error) {
    const msg = error.message || "Falha ao enviar e-mail via Resend";
    if (/429|rate|too many/i.test(msg)) {
      throw new Error(`Resend recusou (rate limit): ${msg}`);
    }
    throw new Error(msg);
  }
  return { id: data?.id ?? null };
}

export async function sendTestEmail(to: string): Promise<{ id: string | null }> {
  return sendTransactionalEmail({
    to,
    subject: "Zap — e-mail de teste",
    html: `<p>Se você recebeu este e-mail, a integração Resend está funcionando.</p>
<p style="color:#71717a;font-size:13px">Enviado pelo painel Zap.</p>`
  });
}

export async function inspectSendingDomain(): Promise<DomainCheck> {
  const { apiKey, from } = await loadResendClient();
  const response = await fetch("https://api.resend.com/domains", {
    headers: { Authorization: `Bearer ${apiKey}` }
  });
  if (!response.ok) {
    throw new Error("A Resend não devolveu os domínios. Confira a API key.");
  }
  const payload: unknown = await response.json();
  return summarizeResendDomains(payload, from);
}
