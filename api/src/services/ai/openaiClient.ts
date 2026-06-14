import type { LearnExtraction } from "../../types/ai.js";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export async function openaiChat(params: {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  json?: boolean;
}): Promise<{ text: string; usage?: { prompt_tokens?: number; completion_tokens?: number } }> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
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

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`OpenAI chat ${res.status}: ${errText.slice(0, 200)}`);
  }

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
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
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
            { type: "image_url", image_url: { url: params.imageUrl } }
          ]
        }
      ],
      temperature: 0.2
    })
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`OpenAI vision ${res.status}: ${errText.slice(0, 200)}`);
  }

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

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { authorization: `Bearer ${params.apiKey}` },
    body: form
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`OpenAI whisper ${res.status}: ${errText.slice(0, 200)}`);
  }

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
  const system = [
    "Extraia conhecimento factual de mensagens de atendimento WhatsApp.",
    "NÃO copie tom pessoal nem frases literais longas.",
    "Retorne JSON: { topic, summary, qaPair?: { question, answerBase } }",
    "summary = base factual curta para futuras respostas.",
    params.kind === "answer" && params.priorQuestion
      ? `A mensagem é uma resposta manual à pergunta: "${params.priorQuestion}"`
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
        content: `Contexto produto:\n${params.productContext || "(vazio)"}\n\nMensagem:\n${params.messageText}`
      }
    ]
  });

  try {
    const parsed = JSON.parse(text) as LearnExtraction;
    return {
      topic: String(parsed.topic ?? "geral").slice(0, 120),
      summary: String(parsed.summary ?? params.messageText).slice(0, 2000),
      qaPair: parsed.qaPair
        ? {
            question: String(parsed.qaPair.question ?? "").slice(0, 500),
            answerBase: String(parsed.qaPair.answerBase ?? "").slice(0, 2000)
          }
        : undefined
    };
  } catch {
    return { topic: "geral", summary: params.messageText.slice(0, 500) };
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
      { role: "system", content: params.systemPrompt },
      {
        role: "user",
        content: `Histórico recente:\n${params.chatHistory}${knowledge}\n\nÚltima mensagem do cliente:\n${params.inboundText}\n\nResponda ao cliente:`
      }
    ],
    temperature: 0.4
  });

  return text.trim();
}
