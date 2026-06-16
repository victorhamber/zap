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
    params.kind === "answer" && params.priorQuestion
      ? `A mensagem é uma resposta manual à pergunta: "${params.priorQuestion.slice(0, 500)}"`
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

export async function generateReply(params: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  chatHistory: string;
  knowledgeSnippets: string[];
  inboundText: string;
}): Promise<string> {
  const knowledge =
    params.knowledgeSnippets.length > 0
      ? `\n\nBase de conhecimento:\n${params.knowledgeSnippets.join("\n---\n")}`
      : "";

  const { text } = await openaiChat({
    apiKey: params.apiKey,
    model: params.model,
    messages: [
      { role: "system", content: params.systemPrompt.slice(0, 8000) },
      {
        role: "user",
        content: `Histórico desta conversa (mesmo número):\n${params.chatHistory.slice(0, 6000)}${knowledge}\n\nÚltima mensagem do cliente:\n${params.inboundText.slice(0, 4000)}\n\nResponda ao cliente de forma coerente com o histórico e as tags do lead. Não repita ofertas já feitas:`
      }
    ],
    temperature: 0.4
  });

  return text.trim();
}
