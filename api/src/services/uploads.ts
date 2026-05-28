import { randomUUID } from "node:crypto";
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
  "application/pdf": "pdf"
};

export async function ensureUploadDir(): Promise<void> {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
}

export function publicUploadUrl(filename: string): string {
  const base = env.APP_PUBLIC_URL.replace(/\/$/, "");
  return `${base}/uploads/${filename}`;
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
  const ext = MIME_EXT[contentType] ?? "bin";
  const filename = `${randomUUID()}.${ext}`;
  await fs.writeFile(path.join(UPLOAD_DIR, filename), buf);

  return { url: publicUploadUrl(filename), filename };
}
