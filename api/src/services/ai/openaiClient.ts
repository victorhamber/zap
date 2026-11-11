import type { LearnExtraction } from "../../types/ai.js";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export class OpenAiApiError extends Error {
  readonly status: number;
  readonly retryAfterMs?: number;

  constructor(message: string, status: number, retryAfterMs?: number) {
    super(message);
    this.name = "OpenAiApiError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export function isOpenAiRateLimitError(err: unknown): boolean {
  if (err instanceof OpenAiApiError) return err.status === 429;
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("429") || msg.includes("Rate limit");
}

function parseRetryAfterMs(status: number, errText: string, headers: Headers): number | undefined {
  if (status !== 429) return undefined;

  const hdr = headers.get("retry-after");
  if (hdr) {
    const n = Number(hdr);
    if (!Number.isNaN(n)) return n < 1000 ? n * 1000 : n;
  }

  const match = errText.match(/try again in ([\d.]+)\s*(ms|s)/i);
  if (match) {
    const val = parseFloat(match[1]);
    return match[2].toLowerCase() === "s" ? val * 1000 : val;
  }

  return 60_000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function openaiFetch(url: string, init: RequestInit, attempts = 6): Promise<Response> {
  let lastErr: OpenAiApiError | null = null;

  for (let i = 0; i < attempts; i++) {
    const res = await fetch(url, init);
    if (res.ok) return res;

    const errText = await res.text().catch(() => "");
    const retryAfterMs = parseRetryAfterMs(res.status, errText, res.headers);
    lastErr = new OpenAiApiError(
      `OpenAI ${res.status}: ${errText.slice(0, 240)}`,
      res.status,
      retryAfterMs
    );

    if (res.status === 429 && i < attempts - 1) {
      const wait = Math.max(retryAfterMs ?? 30_000, 3_000);
      await sleep(wait);
      continue;
    }

    throw lastErr;
  }

  throw lastErr ?? new OpenAiApiError("OpenAI request failed", 500);
}

export async function openaiChat(params: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  json?: boolean;
}): Promise<{ text: string; usage?: { prompt_tokens?: number; completion_tokens?: number } }> {
  const res = await openaiFetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${params.apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: params.model,
      messages: params.messages,
      temperature: params.temperature ?? 0.3,
      ...(params.json ? { response_format: { type: "json_object" } } : {})
    })
  });

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const text = data.choices?.[0]?.message?.content?.trim() ?? "";
  return { text, usage: data.usage };
}

export async function openaiVision(params: {
  apiKey: string;
  model: string;
  imageUrl: string;
  prompt: string;
}): Promise<string> {
  const res = await openaiFetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${params.apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: params.model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: params.prompt },
            { type: "image_url", image_url: { url: params.imageUrl, detail: "low" } }
          ]
        }
      ],
      temperature: 0.2
    })
  });

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

type ChatPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail: "low" } };

/** Texto e imagens na mesma resposta. O rascunho de mensagem usa isto. */
export async function openaiChatParts(params: {
  apiKey: string;
  model: string;
  system: string;
  userText: string;
  imageDataUrls?: string[];
  temperature?: number;
  json?: boolean;
}): Promise<string> {
  const content: ChatPart[] = [{ type: "text", text: params.userText }];
  for (const url of params.imageDataUrls ?? []) {
    content.push({ type: "image_url", image_url: { url, detail: "low" } });
  }
  const res = await openaiFetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${params.apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: params.model,
      temperature: params.temperature ?? 0.7,
      messages: [
        { role: "system", content: params.system },
        { role: "user", content }
      ],
      ...(params.json ? { response_format: { type: "json_object" } } : {})
    })
  });
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

export async function openaiTranscribe(params: {
  apiKey: string;
  model: string;
  audioBuffer: Buffer;
  filename?: string;
}): Promise<string> {
  const form = new FormData();
  const blob = new Blob([new Uint8Array(params.audioBuffer)]);
  form.append("file", blob, params.filename ?? "audio.ogg");
  form.append("model", params.model);

  const res = await openaiFetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${params.apiKey}` },
    body: form
  });

  const data = (await res.json()) as { text?: string };
  return data.text?.trim() ?? "";
}

export async function extractKnowledge(params: {
  apiKey: string;
  model: string;
  messageText: string;
  productContext: string;
  priorQuestion?: string;
  kind: "question" | "answer";
}): Promise<LearnExtraction> {
  const messageText = params.messageText.trim().slice(0, 6000);
  const productContext = params.productContext.trim().slice(0, 4000);

  const system = [
    "Extraia conhecimento factual de mensagens de atendimento WhatsApp.",
    "NÃO copie tom pessoal nem frases literais longas.",
    "Retorne JSON: { topic, summary, qaPair?: { question, answerBase } }",
    "summary = base factual curta para futuras respostas.",
    params.kind === "answer"
      ? params.priorQuestion
        ? `A mensagem é uma resposta do atendente à(s) pergunta(s) do cliente: "${params.priorQuestion.slice(0, 500)}"`
        : "A mensagem é uma resposta/informação do atendente (a pergunta original não foi localizada). NÃO a trate como dúvida do cliente."
      : "A mensagem é uma pergunta ou dúvida do cliente."
  ].join("\n");

  const { text } = await openaiChat({
    apiKey: params.apiKey,
    model: params.model,
    json: true,
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: `Contexto produto:\n${productContext || "(vazio)"}\n\nMensagem:\n${messageText}`
      }
    ]
  });

  try {
    const parsed = JSON.parse(text) as LearnExtraction;
    return {
      topic: String(parsed.topic ?? "geral").slice(0, 120),
      summary: String(parsed.summary ?? messageText).slice(0, 2000),
      qaPair: parsed.qaPair
        ? {
            question: String(parsed.qaPair.question ?? "").slice(0, 500),
            answerBase: String(parsed.qaPair.answerBase ?? "").slice(0, 2000)
          }
        : undefined
    };
  } catch {
    return { topic: "geral", summary: messageText.slice(0, 500) };
  }
}

// gpt-4o tem 128k de contexto. 8000 chars (~2k tokens) cortava metade de
// prompts de venda elaborados justamente na parte final (FAQ, fechamento). Um
// teto maior custa centavos e deixa o prompt inteiro chegar ao modelo.
const MAX_SYSTEM_PROMPT_CHARS = 24000;

export async function generateReply(params: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  chatHistory: string;
  officialFacts?: string;
  knowledgeSnippets: string[];
  inboundText: string;
  recentAiReplies?: string[];
  retryAvoidRepeat?: boolean;
}): Promise<string> {
  const officialBlock = params.officialFacts?.trim()
    ? [
        "## FATOS OFICIAIS (PRIORIDADE ABSOLUTA — sobrescrevem aprendizado histórico)",
        "Use estes valores e regras fixas. Ignore qualquer aprendizado histórico que contradiga estes fatos.",
        "",
        params.officialFacts.trim()
      ].join("\n")
    : "";

  const learnedBlock =
    params.knowledgeSnippets.length > 0
      ? [
          "## APRENDIZADO DE CONVERSAS ANTERIORES",
          "Use como modelo de tom e procedimentos, exceto quando conflitar com os fatos oficiais acima.",
          "Nomes próprios nestes exemplos são de OUTROS clientes. Nunca cumprimente o lead atual com o nome de um exemplo.",
          "Se houver qa_pair relevante, baseie sua resposta nele — mas NÃO copie fechamentos tipo \"estou à disposição\".",
          "Capital/banca/depósito de corretora: se o aprendizado citar reais (R$), ignore e use USD dos fatos oficiais.",
          "Conta cent: números altos (ex. 15000) são a TELA em cents (= USD/100). Sempre explique em dólares primeiro para não parecer que precisa de milhares de dólares.",
          "",
          params.knowledgeSnippets.join("\n---\n")
        ].join("\n")
      : "## APRENDIZADO DE CONVERSAS ANTERIORES\n(nenhum item relevante no histórico)";

  const knowledgeBlock = [officialBlock, learnedBlock].filter(Boolean).join("\n\n");

  const recentBlock =
    params.recentAiReplies && params.recentAiReplies.length > 0
      ? `\n\n## Suas respostas recentes neste chat (NÃO repita estas frases)\n${params.recentAiReplies.map((r) => `- ${r.slice(0, 200)}`).join("\n")}`
      : "";

  const repeatHint = params.retryAvoidRepeat
    ? "\n\nIMPORTANTE: Sua resposta anterior seria repetitiva. Responda de forma diferente e responda diretamente à pergunta do cliente."
    : "";

  const inboundLabel =
    params.inboundText.includes("\n")
      ? "Mensagens recentes do cliente (responda todas):"
      : "Última mensagem do cliente:";

  const { text } = await openaiChat({
    apiKey: params.apiKey,
    model: params.model,
    messages: [
      { role: "system", content: params.systemPrompt.slice(0, MAX_SYSTEM_PROMPT_CHARS) },
      {
        role: "user",
        content: [
          knowledgeBlock,
          "",
          "## MEMÓRIA E MENSAGENS DESTA CONVERSA",
          params.chatHistory.slice(0, 8000) || "(primeiro contato — sem histórico nesta conversa)",
          recentBlock,
          "",
          `## ${inboundLabel}`,
          params.inboundText.slice(0, 4000),
          repeatHint,
          "",
          "Responda em uma única mensagem concisa.",
          "Não termine com despedida nem \"estou à disposição\" / \"se precisar de mais\".",
          "Capital e banca: dólares (USD). Conta cent: se citar o número da tela, diga que é cents (USD × 100), nunca deixe parecer que precisa de milhares de dólares."
        ].join("\n")
      }
    ],
    temperature: params.retryAvoidRepeat ? 0.25 : 0.3
  });

  return text.trim();
}
