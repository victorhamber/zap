import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, readFile, unlink, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InstanceAiSettings } from "@prisma/client";
import { openaiTranscribe, openaiVision } from "./openaiClient.js";
import { downloadMediaForStoredMessage } from "../wppMedia.js";

const execFileAsync = promisify(execFile);

/** Máx. de frames enviados à Vision — só em temp, nunca persistidos no VPS. */
const VIDEO_FRAME_COUNT = 5;

type InboxMsg = {
  body: string;
  type: string;
  mediaUrl: string | null;
  chatId: string;
  waMessageId: string | null;
};

function ffmpegBin(): string {
  return (process.env.FFMPEG_PATH || "ffmpeg").trim() || "ffmpeg";
}

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

async function safeRmDir(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true }).catch(() => {});
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
    const dataUrl = await resolveImageDataUrl(message);
    if (!dataUrl) return message.body;
    const desc = await openaiVision({
      apiKey,
      model: settings.modelVision,
      imageUrl: dataUrl,
      prompt:
        "Descreva o conteúdo factual desta imagem para atendimento no WhatsApp. Seja objetivo. Inclua texto visível se houver."
    });
    return desc || message.body;
  }

  if (modality === "audio" && flags.audio) {
    const buffer = await loadMediaBuffer(message);
    if (!buffer) {
      console.warn("[ai/media] áudio sem buffer", message.waMessageId ?? message.mediaUrl);
      return message.body;
    }
    try {
      return await openaiTranscribe({
        apiKey,
        model: settings.modelTranscribe,
        audioBuffer: buffer,
        filename: "audio.ogg"
      });
    } catch (err) {
      console.error("[ai/media] whisper áudio falhou", err);
      return message.body;
    }
  }

  if (modality === "video" && flags.video) {
    const out = await extractVideoForAi({ message, settings, apiKey });
    return out ?? message.body;
  }

  return message.body.trim() || null;
}

/**
 * Vídeo → Whisper (faixa de áudio) + Vision (keyframes).
 * Tudo em os.tmpdir(); apaga no finally. Não grava na library/VPS.
 */
async function extractVideoForAi(params: {
  message: InboxMsg;
  settings: InstanceAiSettings;
  apiKey: string;
}): Promise<string | null> {
  const { message, settings, apiKey } = params;
  const buffer = await loadMediaBuffer(message);
  if (!buffer) {
    console.warn("[ai/media] vídeo sem buffer", message.waMessageId ?? message.mediaUrl);
    return null;
  }

  const workDir = await mkdtemp(join(tmpdir(), "zap-ai-vid-"));
  const inPath = join(workDir, "input.bin");
  const audioPath = join(workDir, "audio.mp3");
  const framePattern = join(workDir, "frame_%02d.jpg");

  try {
    await writeFile(inPath, buffer);
    const bin = ffmpegBin();

    let audioText = "";
    try {
      await execFileAsync(
        bin,
        ["-y", "-i", inPath, "-vn", "-acodec", "libmp3lame", "-q:a", "4", audioPath],
        { timeout: 120_000 }
      );
      const audioBuf = await readFile(audioPath);
      audioText = (
        await openaiTranscribe({
          apiKey,
          model: settings.modelTranscribe,
          audioBuffer: audioBuf,
          filename: "audio.mp3"
        })
      ).trim();
    } catch (err) {
      console.warn("[ai/media] extrair/transcrever áudio do vídeo falhou", err);
    }

    let visualText = "";
    try {
      await execFileAsync(
        bin,
        [
          "-y",
          "-i",
          inPath,
          "-vf",
          "fps=1,scale=640:-2",
          "-frames:v",
          String(VIDEO_FRAME_COUNT),
          framePattern
        ],
        { timeout: 120_000 }
      );
      const files = (await readdir(workDir))
        .filter((f) => /^frame_\d+\.jpg$/i.test(f))
        .sort()
        .slice(0, VIDEO_FRAME_COUNT);

      const descs: string[] = [];
      for (const file of files) {
        const jpg = await readFile(join(workDir, file));
        const dataUrl = `data:image/jpeg;base64,${jpg.toString("base64")}`;
        const desc = await openaiVision({
          apiKey,
          model: settings.modelVision,
          imageUrl: dataUrl,
          prompt:
            "Frame de um vídeo de WhatsApp. Descreva o que se vê de forma objetiva (pessoas, texto na tela, ações). Sem inventar."
        });
        if (desc?.trim()) descs.push(desc.trim());
      }
      if (descs.length) visualText = descs.map((d, i) => `Frame ${i + 1}: ${d}`).join("\n");
    } catch (err) {
      console.warn("[ai/media] frames do vídeo falharam", err);
    }

    const parts: string[] = [];
    if (audioText) parts.push(`[Áudio do vídeo]\n${audioText}`);
    if (visualText) parts.push(`[Visual do vídeo]\n${visualText}`);
    return parts.length ? parts.join("\n\n") : null;
  } finally {
    await safeRmDir(workDir);
  }
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

async function loadMediaBuffer(message: InboxMsg): Promise<Buffer | null> {
  const url = await resolveMediaUrl(message);
  if (!url) return null;

  if (url.startsWith("data:")) {
    const b64 = url.split(",")[1] ?? "";
    return Buffer.from(b64, "base64");
  }
  if (url.startsWith("http")) {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn("[ai/media] download HTTP falhou", res.status, url.slice(0, 80));
      return null;
    }
    return Buffer.from(await res.arrayBuffer());
  }
  return null;
}

/** Prefer data URL para a OpenAI não depender de APP_PUBLIC_URL. */
async function resolveImageDataUrl(message: InboxMsg): Promise<string | null> {
  const url = await resolveMediaUrl(message);
  if (!url) return null;
  if (url.startsWith("data:")) return url;

  const buffer = await loadMediaBuffer(message);
  if (!buffer) return url.startsWith("http") ? url : null;

  const mime = message.type.toLowerCase() === "sticker" ? "image/webp" : "image/jpeg";
  return `data:${mime};base64,${buffer.toString("base64")}`;
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
