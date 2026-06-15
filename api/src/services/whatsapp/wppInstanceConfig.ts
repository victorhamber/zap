import { prisma } from "../../prisma.js";
import { encryptSecret, decryptSecret, maskSecret } from "../secretCrypto.js";
import { env } from "../../env.js";

export type WppIntegration = "baileys" | "business";

export type BusinessConfigInput = {
  metaPhoneNumberId: string;
  metaBusinessId: string;
  metaAccessToken: string;
  metaWebhookVerifyToken: string;
};

export type BusinessConfigDto = {
  integration: WppIntegration;
  metaPhoneNumberId: string | null;
  metaBusinessId: string | null;
  metaAccessTokenMasked: string | null;
  metaWebhookVerifyTokenMasked: string | null;
  hasMetaAccessToken: boolean;
  hasMetaWebhookVerifyToken: boolean;
  metaWebhookUrl: string | null;
};

function metaWebhookPublicUrl(): string | null {
  const base = env.APP_PUBLIC_URL?.replace(/\/$/, "");
  return base ? `${base}/api/webhooks/meta` : null;
}

export async function getWppInstanceConfig(name: string): Promise<{
  integration: WppIntegration;
  metaPhoneNumberId: string | null;
  metaBusinessId: string | null;
  metaAccessToken: string | null;
  metaWebhookVerifyToken: string | null;
} | null> {
  if (!prisma) return null;
  const row = await prisma.wppInstance.findUnique({
    where: { name: name.trim().toLowerCase() }
  });
  if (!row) return null;

  let metaAccessToken: string | null = null;
  let metaWebhookVerifyToken: string | null = null;
  try {
    if (row.metaAccessTokenEnc) metaAccessToken = decryptSecret(row.metaAccessTokenEnc);
    if (row.metaWebhookVerifyTokenEnc) {
      metaWebhookVerifyToken = decryptSecret(row.metaWebhookVerifyTokenEnc);
    }
  } catch {
    /* credenciais corrompidas */
  }

  return {
    integration: (row.integration === "business" ? "business" : "baileys") as WppIntegration,
    metaPhoneNumberId: row.metaPhoneNumberId,
    metaBusinessId: row.metaBusinessId,
    metaAccessToken,
    metaWebhookVerifyToken
  };
}

export async function getBusinessConfigDto(name: string): Promise<BusinessConfigDto> {
  const cfg = await getWppInstanceConfig(name);
  return {
    integration: cfg?.integration ?? "baileys",
    metaPhoneNumberId: cfg?.metaPhoneNumberId ?? null,
    metaBusinessId: cfg?.metaBusinessId ?? null,
    metaAccessTokenMasked: maskSecret(cfg?.metaAccessToken),
    metaWebhookVerifyTokenMasked: maskSecret(cfg?.metaWebhookVerifyToken),
    hasMetaAccessToken: Boolean(cfg?.metaAccessToken),
    hasMetaWebhookVerifyToken: Boolean(cfg?.metaWebhookVerifyToken),
    metaWebhookUrl: metaWebhookPublicUrl()
  };
}

export async function saveBusinessConfig(
  name: string,
  input: Partial<BusinessConfigInput> & { integration?: WppIntegration }
): Promise<BusinessConfigDto> {
  if (!prisma) throw new Error("Banco indisponível");
  const n = name.trim().toLowerCase();

  const existing = await prisma.wppInstance.findUnique({ where: { name: n } });
  if (!existing) throw new Error("Instância não encontrada");

  const integration: WppIntegration =
    input.integration === "business" ? "business" : input.integration === "baileys" ? "baileys" : (existing.integration === "business" ? "business" : "baileys");

  let metaAccessTokenEnc = existing.metaAccessTokenEnc;
  let metaWebhookVerifyTokenEnc = existing.metaWebhookVerifyTokenEnc;

  if (input.metaAccessToken?.trim()) {
    metaAccessTokenEnc = encryptSecret(input.metaAccessToken.trim());
  }
  if (input.metaWebhookVerifyToken?.trim()) {
    metaWebhookVerifyTokenEnc = encryptSecret(input.metaWebhookVerifyToken.trim());
  }

  const metaPhoneNumberId = input.metaPhoneNumberId?.trim() || existing.metaPhoneNumberId;
  const metaBusinessId = input.metaBusinessId?.trim() || existing.metaBusinessId;

  if (integration === "business") {
    if (!metaPhoneNumberId || !metaBusinessId) {
      throw new Error("Phone Number ID e Business ID são obrigatórios para API oficial");
    }
    if (!metaAccessTokenEnc) {
      throw new Error("Access Token da Meta é obrigatório para API oficial");
    }
    if (!metaWebhookVerifyTokenEnc) {
      throw new Error("Token de verificação do webhook é obrigatório para API oficial");
    }
  }

  await prisma.wppInstance.update({
    where: { name: n },
    data: {
      integration,
      metaPhoneNumberId: integration === "business" ? metaPhoneNumberId : null,
      metaBusinessId: integration === "business" ? metaBusinessId : null,
      metaAccessTokenEnc: integration === "business" ? metaAccessTokenEnc : null,
      metaWebhookVerifyTokenEnc: integration === "business" ? metaWebhookVerifyTokenEnc : null
    }
  });

  return getBusinessConfigDto(n);
}

export async function findInstanceByMetaWebhookToken(token: string): Promise<string | null> {
  if (!prisma || !token.trim()) return null;
  const rows = await prisma.wppInstance.findMany({
    where: { integration: "business", metaWebhookVerifyTokenEnc: { not: null } }
  });
  for (const row of rows) {
    try {
      if (row.metaWebhookVerifyTokenEnc && decryptSecret(row.metaWebhookVerifyTokenEnc) === token) {
        return row.name;
      }
    } catch {
      /* skip */
    }
  }
  return null;
}

export async function findInstanceByPhoneNumberId(phoneNumberId: string): Promise<string | null> {
  if (!prisma || !phoneNumberId.trim()) return null;
  const row = await prisma.wppInstance.findFirst({
    where: { integration: "business", metaPhoneNumberId: phoneNumberId.trim() }
  });
  return row?.name ?? null;
}
