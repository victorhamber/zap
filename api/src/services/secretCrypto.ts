import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "../env.js";

const ALGO = "aes-256-gcm";

/** Chave de 32 bytes: AI_ENCRYPTION_KEY (hex) ou derivada do JWT_SECRET já usado no login. */
function resolveEncryptionKey(): Buffer | null {
  const hex = env.AI_ENCRYPTION_KEY?.trim();
  if (hex && hex.length === 64) {
    return Buffer.from(hex, "hex");
  }

  const jwt = env.JWT_SECRET?.trim();
  if (jwt && jwt.length >= 32) {
    return createHash("sha256").update(`zap-secrets:${jwt}`).digest();
  }

  return null;
}

export function isEncryptionConfigured(): boolean {
  return resolveEncryptionKey() !== null;
}

export function encryptSecret(plain: string): string {
  const key = resolveEncryptionKey();
  if (!key) {
    throw new Error(
      "Servidor sem chave de criptografia (defina JWT_SECRET com pelo menos 32 caracteres)"
    );
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

export function decryptSecret(stored: string): string {
  const key = resolveEncryptionKey();
  if (!key) throw new Error("Servidor sem chave de criptografia");
  const [ivHex, tagHex, dataHex] = stored.split(":");
  if (!ivHex || !tagHex || !dataHex) throw new Error("Segredo criptografado inválido");
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final()
  ]);
  return dec.toString("utf8");
}

export function maskSecret(value: string | null | undefined, visible = 4): string | null {
  if (!value?.trim()) return null;
  const k = value.trim();
  if (k.length <= visible + 3) return "••••";
  return `${k.slice(0, Math.min(7, visible + 3))}…${k.slice(-visible)}`;
}
