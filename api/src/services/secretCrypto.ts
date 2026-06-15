import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "../env.js";

const ALGO = "aes-256-gcm";

function encryptionKey(): Buffer | null {
  const hex = env.AI_ENCRYPTION_KEY?.trim();
  if (!hex || hex.length !== 64) return null;
  return Buffer.from(hex, "hex");
}

export function encryptSecret(plain: string): string {
  const key = encryptionKey();
  if (!key) {
    throw new Error("AI_ENCRYPTION_KEY inválida ou ausente (64 caracteres hex no servidor)");
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${enc.toString("hex")}`;
}

export function decryptSecret(stored: string): string {
  const key = encryptionKey();
  if (!key) throw new Error("AI_ENCRYPTION_KEY inválida ou ausente");
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
