import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { InstanceAiSettings } from "@prisma/client";
import { openaiTranscribe, openaiVision } from "./openaiClient.js";
import { downloadMediaForStoredMessage } from "../wppMedia.js";

const execFileAsync = promisify(execFile);

type InboxMsg = {
  body: string;
  type: string;
  mediaUrl: string | null;
  chatId: string;
  waMessageId: string | null;
};

function modalityFromType(type: string): string {
  const t = type.toLowerCase();
  if (t === "image" || t === "sticker") return "image";
  if (t === "audio" || t === "ptt") return "audio";
  if (t === "video") return "video";
  return "text";
}

export function detectModality(type: string): string {
  return modalityFromType(type);
}

export async function extractTextFromMessage(params: {
  session: string;
  message: InboxMsg;
  modality: string;
  flags: {
    text: boolean;
    image: boolean;
    audio: boolean;
    video: boolean;
  };
  settings: InstanceAiSettings;
  apiKey: string;
}): Promise<string | null> {
  const { message, modality, flags, settings, apiKey } = params;

  if (modality === "text" || modality === "chat") {
    return flags.text ? message.body.trim() || null : null;
  }

  if (modality === "image" && flags.image) {
    const url = await resolveMediaUrl(message);
    if (!url) return message.body;
    const desc = await openaiVision({
      apiKey,
      model: settings.modelVision,
      imageUrl: url,
      prompt: "Descreva o conteúdo factual desta imagem para base de conhecimento de atendimento. Seja objetivo."
    });
    return desc || message.body;
  }

  if (modality === "audio" && flags.audio) {
    const buffer = await loadAudioBuffer(message);
    if (!buffer) return message.body;
    return openaiTranscribe({
      apiKey,
      model: settings.modelTranscribe,
      audioBuffer: buffer,
      filename: "audio.ogg"
    });
  }

  if (modality === "video" && flags.video) {
    const buffer = await loadAudioBuffer(message, true);
    if (!buffer) return message.body;
    return openaiTranscribe({
      apiKey,
      model: settings.modelTranscribe,
      audioBuffer: buffer,
      filename: "audio.mp3"
    });
  }

  return message.body.trim() || null;
}

async function resolveMediaUrl(message: InboxMsg): Promise<string | null> {
  if (message.mediaUrl?.startsWith("http") || message.mediaUrl?.startsWith("data:")) {
    return message.mediaUrl;
  }
  if (message.waMessageId) {
    return downloadMediaForStoredMessage({
      chatId: message.chatId,
      waMessageId: message.waMessageId,
      type: message.type === "ptt" ? "audio" : message.type
    });
  }
  return null;
}

async function loadAudioBuffer(message: InboxMsg, fromVideo = false): Promise<Buffer | null> {
  const url = await resolveMediaUrl(message);
  if (!url) return null;

  let buffer: Buffer;
  if (url.startsWith("data:")) {
    const b64 = url.split(",")[1] ?? "";
    buffer = Buffer.from(b64, "base64");
  } else if (url.startsWith("http")) {
    const res = await fetch(url);
    if (!res.ok) return null;
    buffer = Buffer.from(await res.arrayBuffer());
  } else {
    return null;
  }

  if (!fromVideo) return buffer;

  const id = randomBytes(8).toString("hex");
  const inPath = join(tmpdir(), `zap-ai-${id}.bin`);
  const outPath = join(tmpdir(), `zap-ai-${id}.mp3`);
  try {
    await writeFile(inPath, buffer);
    await execFileAsync("ffmpeg", ["-y", "-i", inPath, "-vn", "-acodec", "libmp3lame", outPath], {
      timeout: 120_000
    });
    return readFile(outPath);
  } catch {
    return null;
  } finally {
    await unlink(inPath).catch(() => {});
    await unlink(outPath).catch(() => {});
  }
}

export async function extractInboundTextForReply(params: {
  message: InboxMsg;
  settings: InstanceAiSettings;
  apiKey: string;
}): Promise<string> {
  const modality = detectModality(params.message.type);
  const extracted = await extractTextFromMessage({
    session: "",
    message: params.message,
    modality,
    flags: {
      text: params.settings.replyText,
      image: params.settings.replyImage,
      audio: params.settings.replyAudio,
      video: params.settings.replyVideo
    },
    settings: params.settings,
    apiKey: params.apiKey
  });
  return extracted?.trim() || params.message.body.trim() || "(mensagem sem texto)";
}
