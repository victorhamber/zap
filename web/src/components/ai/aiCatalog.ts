/** Catálogo visível no Deskcomm. Só entra em modelChat quem tem apiId da OpenAI. */

export type AiProviderId =
  | "anthropic"
  | "openai"
  | "google"
  | "openrouter"
  | "deepseek"
  | "requesty"
  | "custom";

export type AiModelOption = {
  provider: AiProviderId;
  label: string;
  apiId?: string;
  inputPerMillion?: number;
  outputPerMillion?: number;
};

export const AI_PROVIDERS: { id: AiProviderId; label: string }[] = [
  { id: "anthropic", label: "Anthropic (Claude)" },
  { id: "openai", label: "OpenAI (GPT)" },
  { id: "google", label: "Google (Gemini)" },
  { id: "openrouter", label: "OpenRouter" },
  { id: "deepseek", label: "DeepSeek" },
  { id: "requesty", label: "Requesty" },
  { id: "custom", label: "Provedor personalizado (compatível com OpenAI)" }
];

export const AI_MODELS: AiModelOption[] = [
  { provider: "openai", label: "GPT-4o (legacy)", apiId: "gpt-4o", inputPerMillion: 2.5, outputPerMillion: 10 },
  { provider: "openai", label: "GPT-4o (2024-11-20)", apiId: "gpt-4o-2024-11-20", inputPerMillion: 2.5, outputPerMillion: 10 },
  { provider: "openai", label: "GPT-4o (2024-08-06)", apiId: "gpt-4o-2024-08-06", inputPerMillion: 2.5, outputPerMillion: 10 },
  { provider: "openai", label: "GPT-4o mini", apiId: "gpt-4o-mini", inputPerMillion: 0.15, outputPerMillion: 0.6 },
  { provider: "openai", label: "GPT-4.1", apiId: "gpt-4.1", inputPerMillion: 2, outputPerMillion: 8 },
  { provider: "openai", label: "GPT-4.1 mini", apiId: "gpt-4.1-mini", inputPerMillion: 0.4, outputPerMillion: 1.6 },
  { provider: "openai", label: "o3", apiId: "o3" },
  { provider: "openai", label: "o3-pro", apiId: "o3-pro" },
  { provider: "openai", label: "GPT-5", apiId: "gpt-5" },
  { provider: "openai", label: "GPT-5 Mini", apiId: "gpt-5-mini" },
  { provider: "openai", label: "GPT-5 Nano", apiId: "gpt-5-nano" },
  { provider: "openai", label: "GPT-5.1", apiId: "gpt-5.1" },
  { provider: "openai", label: "GPT-5.2", apiId: "gpt-5.2" },
  { provider: "openai", label: "GPT-5.2 Pro", apiId: "gpt-5.2-pro" },
  { provider: "openai", label: "GPT-5.4", apiId: "gpt-5.4" },
  { provider: "openai", label: "GPT-5.4 Mini", apiId: "gpt-5.4-mini" },
  { provider: "openai", label: "GPT-5.4 Nano", apiId: "gpt-5.4-nano" },
  { provider: "openai", label: "GPT-5.4 Pro", apiId: "gpt-5.4-pro" },
  { provider: "openai", label: "GPT-5.5", apiId: "gpt-5.5" },
  { provider: "openai", label: "GPT-5.5 Pro", apiId: "gpt-5.5-pro" },
  { provider: "openai", label: "GPT-5.6", apiId: "gpt-5.6" },
  { provider: "openai", label: "GPT-5.6 Terra", apiId: "gpt-5.6" },
  { provider: "openai", label: "GPT-5.6 Sol" },
  { provider: "openai", label: "GPT-5.6 Luna" },
  { provider: "openai", label: "GPT-6 Astra" },
  { provider: "openai", label: "GPT-6 Sol" },
  { provider: "openai", label: "GPT-6 Luna" },
  { provider: "openai", label: "GPT-6.1 Sol" },
  { provider: "openai", label: "GPT-6.1 Terra" },
  { provider: "openai", label: "Daybreak Red" },
  { provider: "openai", label: "Daybreak Blue" },
  { provider: "openai", label: "GPT-5.3 Codex", apiId: "gpt-5.3-codex" },
  { provider: "openai", label: "GPT-5.3 Codex Spark" },
  { provider: "anthropic", label: "Claude Sonnet" },
  { provider: "anthropic", label: "Claude Opus" },
  { provider: "google", label: "Gemini Pro" },
  { provider: "google", label: "Gemini Flash" },
  { provider: "openrouter", label: "Modelo do OpenRouter" },
  { provider: "deepseek", label: "DeepSeek Chat" },
  { provider: "requesty", label: "Modelo do Requesty" },
  { provider: "custom", label: "Modelo compatível com OpenAI" }
];

export function modelLabel(apiId: string): string {
  return AI_MODELS.find((m) => m.apiId === apiId)?.label ?? apiId;
}

export function priceTitle(model: AiModelOption): string | undefined {
  if (model.inputPerMillion == null || model.outputPerMillion == null) return undefined;
  const money = (n: number) => n.toFixed(2).replace(".", ",");
  return `Preço por 1 milhão de tokens. Entrada: US$ ${money(model.inputPerMillion)}. Saída: US$ ${money(model.outputPerMillion)}.`;
}
