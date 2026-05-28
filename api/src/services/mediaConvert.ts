import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { UPLOAD_DIR, ensureUploadDir, publicUploadUrl, saveUploadFromData } from "./uploads.js";

const execFileAsync = promisify(execFile);

/** WhatsApp PTT exige OGG/Opus — gravação do navegador vem em WebM. */
export async function convertWebmDataUrlToOgg(
  dataUrl: string
): Promise<{ base64: string; url: string }> {
  await ensureUploadDir();

  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/s);
  const base64 = match ? match[2].replace(/\s/g, "") : dataUrl.replace(/\s/g, "");

  const webmPath = path.join(UPLOAD_DIR, `${randomUUID()}.webm`);
  const oggName = `${randomUUID()}.ogg`;
  const oggPath = path.join(UPLOAD_DIR, oggName);

  try {
    await fs.writeFile(webmPath, Buffer.from(base64, "base64"));
    await execFileAsync(
      "ffmpeg",
      ["-y", "-i", webmPath, "-ac", "1", "-c:a", "libopus", "-b:a", "64k", oggPath],
      { timeout: 60_000 }
    );
    const oggBuf = await fs.readFile(oggPath);
    return {
      base64: oggBuf.toString("base64"),
      url: publicUploadUrl(oggName)
    };
  } finally {
    await fs.unlink(webmPath).catch(() => {});
  }
}

export async function persistInboundMedia(
  raw: string,
  mime: string
): Promise<string> {
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  const data =
    raw.startsWith("data:") ? raw : `data:${mime};base64,${raw.replace(/\s/g, "")}`;
  const { url } = await saveUploadFromData(data, mime);
  return url;
}
