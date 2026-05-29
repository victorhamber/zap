import { env } from "../../env.js";

export function isEvolutionProvider(): boolean {
  return env.WHATSAPP_PROVIDER === "evolution";
}

export function evolutionBaseUrl(): string {
  const internal = env.EVOLUTION_INTERNAL_URL?.trim().replace(/\/$/, "");
  if (internal) return internal;
  return env.EVOLUTION_BASE_URL.replace(/\/$/, "");
}

export function evolutionApiKey(): string {
  return env.EVOLUTION_API_KEY;
}
