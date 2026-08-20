import { Resend } from "resend";
import { prisma } from "../../prisma.js";
import { decryptSecret, encryptSecret, maskSecret, isEncryptionConfigured } from "../secretCrypto.js";

export type EmailSettingsDto = {
  hasApiKey: boolean;
  apiKeyMasked: string | null;
  emailFrom: string;
  emailFromName: string;
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
    encryptionReady: isEncryptionConfigured()
  };
}

export async function saveEmailSettings(input: {
  apiKey?: string | null;
  removeApiKey?: boolean;
  emailFrom?: string;
  emailFromName?: string;
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

  await prisma!.appSettings.update({
    where: { id: "default" },
    data: {
      resendApiKeyEnc,
      emailFrom: emailFrom || null,
      emailFromName: emailFromName || null
    }
  });

  return getEmailSettingsDto();
}

async function loadResendClient(): Promise<{
  client: Resend;
  from: string;
  fromName: string;
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
    from,
    fromName: String(row.emailFromName ?? "").trim()
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
  replyTo?: string;
}): Promise<{ id: string | null }> {
  const { client, from, fromName } = await loadResendClient();
  const wrappedHtml = wrapEmailHtml(params.html);

  const { data, error } = await client.emails.send({
    from: formatFrom(from, fromName),
    to: [params.to],
    subject: params.subject,
    html: wrappedHtml,
    ...(params.replyTo ? { replyTo: params.replyTo } : {})
  });

  if (error) {
    throw new Error(error.message || "Falha ao enviar e-mail via Resend");
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

/** Envelope simples e-mail-safe (largura ~600px). */
export function wrapEmailHtml(bodyHtml: string): string {
  const inner = String(bodyHtml ?? "").trim();
  if (/<html[\s>]/i.test(inner)) return inner;
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>E-mail</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#18181b;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f4f5;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7;">
          <tr>
            <td style="padding:28px 28px 32px;font-size:15px;line-height:1.55;">
              ${inner}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
