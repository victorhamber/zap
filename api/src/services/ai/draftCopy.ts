/** Rascunho de mensagem ou e-mail. Imagem entra inteira. Vídeo entra por quadros e áudio. */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { UPLOAD_DIR } from "../uploads.js";
import { openaiChatParts, openaiTranscribe } from "./openaiClient.js";
import { getAiSettings, resolveOpenAiApiKey } from "./settings.js";

const execFileAsync = promisify(execFile);
const GOALS = new Set(["venda", "engajamento", "aviso", "relacionamento"]);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
const FRAME_COUNT = 4;

export type DraftChannel = "whatsapp" | "email";
export type DraftAudience = "group" | "person";

export type DraftResult = {
  text: string;
  subject: string;
  preheader: string;
  html: string;
};

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function uploadNameFromUrl(url: string): string | null {
  const match = url.trim().match(/\/uploads\/([A-Za-z0-9._-]+)$/);
  const name = match?.[1] ?? "";
  if (!name || name.includes("..")) return null;
  return name;
}

export function parseDraftJson(channel: DraftChannel, raw: string): DraftResult {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error("A IA não devolveu um texto utilizável.");
  }
  if (channel === "whatsapp") {
    const text = String(data.text ?? "").trim().slice(0, 4000);
    if (!text) throw new Error("A IA não devolveu a mensagem.");
    return { text, subject: "", preheader: "", html: "" };
  }
  const subject = String(data.subject ?? "").trim().slice(0, 180);
  const preheader = String(data.preheader ?? "").trim().slice(0, 180);
  const paragraphs = Array.isArray(data.paragraphs)
    ? data.paragraphs.map((item) => String(item ?? "").trim()).filter(Boolean).slice(0, 6)
    : [];
  if (!subject || paragraphs.length === 0) throw new Error("A IA não devolveu o e-mail.");
  const html = paragraphs.map((part) => `<p>${escapeHtml(part)}</p>`).join("");
  return { text: paragraphs.join("\n\n"), subject, preheader, html };
}

function systemPrompt(): string {
  return [
    "Você escreve a mensagem que a pessoa vai enviar. Responda só JSON.",
    "WhatsApp: {\"text\":\"...\"}. Tom de conversa, até uns 700 caracteres, sem hashtag e sem abertura vazia.",
    "E-mail: {\"subject\":\"\",\"preheader\":\"\",\"paragraphs\":[\"\"]}. Até 4 parágrafos.",
    "Em mensagem para uma pessoa ou em e-mail, pode usar {{name}}. Em grupo, não use {{name}}.",
    "O objetivo manda no tom: venda, engajamento, aviso ou relacionamento.",
    "Use a imagem ou os quadros do vídeo. Não invente preço, prazo ou resultado que não esteja no pedido nem na mídia."
  ].join(" ");
}

async function imageDataUrl(filename: string): Promise<string> {
  const buf = await readFile(join(UPLOAD_DIR, filename));
  if (buf.length > MAX_IMAGE_BYTES) throw new Error("A imagem passa de 8 MB.");
  const ext = filename.split(".").pop()?.toLowerCase() ?? "jpg";
  const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : ext === "gif" ? "image/gif" : "image/jpeg";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

async function watchVideo(
  filename: string,
  apiKey: string,
  transcribeModel: string
): Promise<{ images: string[]; audio: string }> {
  const buf = await readFile(join(UPLOAD_DIR, filename));
  if (buf.length > MAX_VIDEO_BYTES) throw new Error("O vídeo passa de 25 MB para a IA ver.");
  const workDir = await mkdtemp(join(tmpdir(), "zap-draft-"));
  const input = join(workDir, "input.bin");
  try {
    await writeFile(input, buf);
    const bin = (process.env.FFMPEG_PATH || "ffmpeg").trim() || "ffmpeg";
    let audio = "";
    try {
      const audioPath = join(workDir, "audio.mp3");
      await execFileAsync(bin, ["-y", "-i", input, "-vn", "-acodec", "libmp3lame", "-q:a", "5", audioPath], {
        timeout: 90_000
      });
      audio = (
        await openaiTranscribe({
          apiKey,
          model: transcribeModel || "whisper-1",
          audioBuffer: await readFile(audioPath),
          filename: "audio.mp3"
        })
      ).trim();
    } catch {
      audio = "";
    }
    let frames: string[] = [];
    try {
      await execFileAsync(
        bin,
        ["-y", "-i", input, "-vf", "fps=1/3,scale=640:-2", "-frames:v", String(FRAME_COUNT), join(workDir, "frame_%02d.jpg")],
        { timeout: 90_000 }
      );
      frames = (await readdir(workDir)).filter((name) => /^frame_\d+\.jpg$/i.test(name)).sort();
    } catch {
      frames = [];
    }
    const images: string[] = [];
    for (const frame of frames.slice(0, FRAME_COUNT)) {
      const jpg = await readFile(join(workDir, frame));
      images.push(`data:image/jpeg;base64,${jpg.toString("base64")}`);
    }
    if (!images.length && !audio) throw new Error("Não consegui ver o vídeo neste servidor.");
    return { images, audio };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function draftCopy(input: {
  session: string;
  channel: DraftChannel;
  audience: DraftAudience;
  goal: string;
  brief: string;
  mediaUrl?: string;
}): Promise<DraftResult> {
  const channel = input.channel === "email" ? "email" : "whatsapp";
  const audience = input.audience === "person" ? "person" : "group";
  const goal = input.goal.trim().toLowerCase();
  const brief = input.brief.trim();
  if (!GOALS.has(goal)) throw new Error("Escolha venda, engajamento, aviso ou relacionamento.");
  if (brief.length < 8) throw new Error("Conte um pouco melhor o que a mensagem precisa fazer.");
  if (brief.length > 2000) throw new Error("O pedido passa de 2000 caracteres.");

  const apiKey = await resolveOpenAiApiKey(input.session);
  if (!apiKey) throw new Error("Cadastre a chave da OpenAI nas configurações da IA.");
  const settings = await getAiSettings(input.session);
  const model = settings.modelVision || "gpt-4o";

  let images: string[] = [];
  let audioNote = "";
  const mediaUrl = input.mediaUrl?.trim() ?? "";
  if (mediaUrl) {
    const filename = uploadNameFromUrl(mediaUrl);
    if (!filename) throw new Error("A mídia precisa ser um arquivo enviado pelo Zap.");
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    if (["jpg", "jpeg", "png", "webp", "gif"].includes(ext)) {
      images = [await imageDataUrl(filename)];
    } else if (["mp4", "webm", "mov", "mkv"].includes(ext)) {
      const seen = await watchVideo(filename, apiKey, settings.modelTranscribe);
      images = seen.images;
      audioNote = seen.audio;
    } else {
      throw new Error("A IA olha imagem ou vídeo.");
    }
  }

  const userText = [
    `Canal: ${channel}`,
    `Público: ${audience === "group" ? "grupo" : "uma pessoa"}`,
    `Objetivo: ${goal}`,
    `Pedido: ${brief}`,
    audioNote ? `Áudio do vídeo: ${audioNote.slice(0, 4000)}` : ""
  ]
    .filter(Boolean)
    .join("\n");

  const raw = await openaiChatParts({
    apiKey,
    model,
    system: systemPrompt(),
    userText,
    imageDataUrls: images,
    json: true
  });
  return parseDraftJson(channel, raw);
}
