import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { env } from "../env.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const UPLOAD_DIR = path.resolve(__dirname, "../../uploads");

const MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx"
};

export const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
/** Upload de vídeo no painel (envio usa URL interna, não base64). */
export const UPLOAD_MAX_VIDEO_BYTES = 64 * 1024 * 1024;
/** Vídeo nativo no WhatsApp (player inline) — acima disso enviamos como documento .mp4. */
export const WHATSAPP_INLINE_VIDEO_MAX_BYTES = 16 * 1024 * 1024;
/** Acima disso a Evolution recebe URL interna em vez de base64. */
export const MEDIA_SEND_URL_THRESHOLD_BYTES = 4 * 1024 * 1024;

export async function ensureUploadDir(): Promise<void> {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
}

export function publicUploadUrl(filename: string): string {
  const base = env.APP_PUBLIC_URL.replace(/\/$/, "");
  return `${base}/uploads/${filename}`;
}

/** URL que o container WPPConnect usa para buscar arquivos (rede interna). */
export function uploadUrlForWpp(filename: string): string {
  const internal = env.ZAP_INTERNAL_URL?.replace(/\/$/, "");
  if (internal) return `${internal}/uploads/${filename}`;
  return publicUploadUrl(filename);
}

/** Reescreve link público de upload para URL acessível pelo WPP na rede interna. */
export function rewriteUploadUrlForWpp(url: string): string {
  const internal = env.ZAP_INTERNAL_URL?.replace(/\/$/, "");
  if (!internal) return url;
  try {
    const u = new URL(url);
    if (u.pathname.startsWith("/uploads/")) {
      return `${internal}${u.pathname}`;
    }
  } catch {
    /* mantém */
  }
  return url;
}

export function uploadFilenameFromUrl(url: string): string | null {
  const m = url.match(/\/uploads\/([^?#/]+)/i);
  return m?.[1] ?? null;
}

export function isPersistedUploadUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return url.includes("/uploads/");
}

/** Converte URL interna Docker (http://zap:3000/uploads/…) para URL pública do painel. */
export function toPublicMediaUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const name = uploadFilenameFromUrl(url);
  if (name) return publicUploadUrl(name);
  const internal = env.ZAP_INTERNAL_URL?.replace(/\/$/, "");
  if (internal && url.startsWith(internal)) {
    const name2 = uploadFilenameFromUrl(url);
    if (name2) return publicUploadUrl(name2);
  }
  return url;
}

export async function readUploadFileBase64(
  publicOrInternalUrl: string
): Promise<{ base64: string; filename: string } | null> {
  const name = uploadFilenameFromUrl(publicOrInternalUrl);
  if (!name) return null;
  try {
    const buf = await fs.readFile(path.join(UPLOAD_DIR, name));
    return { base64: buf.toString("base64"), filename: name };
  } catch {
    return null;
  }
}

/** Lê upload do disco ou baixa via HTTP (worker pode não ter volume de uploads). */
export async function loadUploadMediaBase64(
  publicOrInternalUrl: string
): Promise<{ base64: string; filename: string } | null> {
  const local = await readUploadFileBase64(publicOrInternalUrl);
  if (local?.base64) return local;

  const name = uploadFilenameFromUrl(publicOrInternalUrl);
  if (!name) return null;

  const candidates = [
    uploadUrlForWpp(name),
    publicUploadUrl(name),
    publicOrInternalUrl.trim()
  ].filter((u, i, arr) => Boolean(u) && arr.indexOf(u) === i);

  for (const url of candidates) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(45_000) });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length === 0) continue;
      return { base64: buf.toString("base64"), filename: name };
    } catch {
      /* tenta próxima URL */
    }
  }
  return null;
}

/** Baixa URL externa e retorna base64 (para imagens no fluxo). */
export async function fetchRemoteMediaBase64(
  url: string,
  maxBytes: number
): Promise<{ base64: string; mimeType: string } | null> {
  const trimmed = url.trim();
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) return null;
  try {
    const res = await fetch(trimmed, { signal: AbortSignal.timeout(45_000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > maxBytes) return null;
    const mimeType = res.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
    return { base64: buf.toString("base64"), mimeType };
  } catch {
    return null;
  }
}

export async function getUploadFileSize(publicOrInternalUrl: string): Promise<number | null> {
  const name = uploadFilenameFromUrl(publicOrInternalUrl);
  if (!name) return null;
  try {
    const stat = await fs.stat(path.join(UPLOAD_DIR, name));
    return stat.size;
  } catch {
    return null;
  }
}

/** Salva data URL ou base64 e retorna URL pública para o WPP baixar o arquivo. */
export async function saveUploadFromData(
  data: string,
  mime?: string
): Promise<{ url: string; filename: string }> {
  await ensureUploadDir();

  let base64 = data;
  let contentType = mime ?? "application/octet-stream";

  const dataUrl = data.match(/^data:([^;]+);base64,(.+)$/);
  if (dataUrl) {
    contentType = dataUrl[1];
    base64 = dataUrl[2];
  }

  const buf = Buffer.from(base64, "base64");
  const maxBytes = contentType.startsWith("video/") ? UPLOAD_MAX_VIDEO_BYTES : UPLOAD_MAX_BYTES;
  if (buf.length > maxBytes) {
    const mb = Math.round(maxBytes / (1024 * 1024));
    const kind = contentType.startsWith("video/") ? " para vídeo" : "";
    throw new Error(`Arquivo muito grande (máximo ${mb} MB${kind})`);
  }
  const ext = MIME_EXT[contentType] ?? "bin";

  const hash = createHash("sha256").update(buf).digest("hex").slice(0, 48);
  const dedupeFilename = `${hash}.${ext}`;
  const dedupePath = path.join(UPLOAD_DIR, dedupeFilename);

  try {
    await fs.access(dedupePath);
    return { url: publicUploadUrl(dedupeFilename), filename: dedupeFilename };
  } catch {
    /* arquivo novo — grava uma vez e reutiliza em outros chats/grupos */
  }

  const filename = dedupeFilename;
  await fs.writeFile(dedupePath, buf);

  return { url: publicUploadUrl(filename), filename };
}
