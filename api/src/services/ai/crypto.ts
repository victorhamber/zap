import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../../env.js";

const ALGO = "aes-256-gcm";

function encryptionKey(): Buffer | null {
  const hex = env.AI_ENCRYPTION_KEY?.trim();
  if (!hex || hex.length !== 64) return null;
  return Buffer.from(hex, "hex");
}

export function encryptApiKey(plain: string): string {
  const key = encryptionKey();
  if (!key) throw new Error("AI_ENCRYPTION_KEY inválida ou ausente (32 bytes hex)");
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

export function decryptApiKey(stored: string): string {
  const key = encryptionKey();
  if (!key) throw new Error("AI_ENCRYPTION_KEY inválida ou ausente");
  const [ivHex, tagHex, dataHex] = stored.split(":");
  if (!ivHex || !tagHex || !dataHex) throw new Error("Chave criptografada inválida");
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const dec = Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final()
  ]);
  return dec.toString("utf8");
}

export function maskApiKey(key: string | null | undefined): string | null {
  if (!key?.trim()) return null;
  const k = key.trim();
  if (k.length <= 8) return "sk-…";
  return `${k.slice(0, 7)}…${k.slice(-4)}`;
}
