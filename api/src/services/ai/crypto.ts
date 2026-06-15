import { encryptSecret, decryptSecret, maskSecret } from "../secretCrypto.js";

export function encryptApiKey(plain: string): string {
  return encryptSecret(plain);
}

export function decryptApiKey(stored: string): string {
  return decryptSecret(stored);
}

export function maskApiKey(key: string | null | undefined): string | null {
  return maskSecret(key);
}
