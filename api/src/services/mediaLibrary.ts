import fs from "node:fs/promises";
import path from "node:path";
import { prisma } from "../prisma.js";
import {
  UPLOAD_DIR,
  isPersistedUploadUrl,
  publicUploadUrl,
  toPublicMediaUrl,
  uploadFilenameFromUrl
} from "./uploads.js";

export type MediaKind = "image" | "video" | "audio" | "document" | "other";

export type MediaLibraryItem = {
  filename: string;
  url: string;
  kind: MediaKind;
  sizeBytes: number;
  messageCount: number;
  receivedCount: number;
  sentCount: number;
  lastAt: string;
  previewLabel: string;
};

export type MediaLibrarySummary = {
  items: MediaLibraryItem[];
  totalBytes: number;
  totalFiles: number;
};

type MediaFilter = "all" | "received" | "sent";

async function getSessionName(): Promise<string> {
  if (!prisma) return "default";
  const s = await prisma.appSettings.findUnique({ where: { id: "default" } });
  return (s?.wppSession ?? "default").trim().toLowerCase();
}

export function isSafeUploadFilename(filename: string): boolean {
  const base = path.basename(filename);
  if (base !== filename) return false;
  if (!base || base.includes("..")) return false;
  return /^[a-zA-Z0-9._-]+$/.test(base);
}

function inferKind(filename: string, msgType?: string): MediaKind {
  const type = (msgType ?? "").toLowerCase();
  if (type === "ptt" || type === "audio") return "audio";
  if (type === "image" || type === "sticker") return "image";
  if (type === "video") return "video";
  if (type === "document") return "document";

  const ext = path.extname(filename).toLowerCase();
  if (/\.(jpe?g|png|gif|webp|bmp|svg)$/i.test(ext)) return "image";
  if (/\.(mp4|webm|mov|mkv|avi)$/i.test(ext)) return "video";
  if (/\.(ogg|mp3|m4a|wav|aac|opus)$/i.test(ext)) return "audio";
  if (/\.(pdf|doc|docx|xls|xlsx|txt|zip|rar)$/i.test(ext)) return "document";
  return "other";
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export { formatBytes };

type Agg = {
  filename: string;
  kind: MediaKind;
  messageCount: number;
  receivedCount: number;
  sentCount: number;
  lastAt: Date;
  previewLabel: string;
};

export async function listMediaLibrary(filter: MediaFilter = "all"): Promise<MediaLibrarySummary> {
  const byFile = new Map<string, Agg>();

  if (prisma) {
    const session = await getSessionName();
    const rows = await prisma.inboxMessage.findMany({
      where: {
        session,
        mediaUrl: { not: null }
      },
      select: {
        mediaUrl: true,
        type: true,
        fromMe: true,
        timestamp: true,
        body: true
      },
      orderBy: { timestamp: "desc" }
    });

    for (const row of rows) {
      const publicUrl = toPublicMediaUrl(row.mediaUrl) ?? row.mediaUrl;
      if (!publicUrl || !isPersistedUploadUrl(publicUrl)) continue;

      const filename = uploadFilenameFromUrl(publicUrl);
      if (!filename || !isSafeUploadFilename(filename)) continue;

      const existing = byFile.get(filename);
      const label = row.body?.trim().slice(0, 80) || inferKind(filename, row.type);
      if (!existing) {
        byFile.set(filename, {
          filename,
          kind: inferKind(filename, row.type),
          messageCount: 1,
          receivedCount: row.fromMe ? 0 : 1,
          sentCount: row.fromMe ? 1 : 0,
          lastAt: row.timestamp,
          previewLabel: label
        });
      } else {
        existing.messageCount += 1;
        if (row.fromMe) existing.sentCount += 1;
        else existing.receivedCount += 1;
        if (row.timestamp > existing.lastAt) {
          existing.lastAt = row.timestamp;
          if (label) existing.previewLabel = label;
        }
      }
    }
  }

  let dirFiles: string[] = [];
  try {
    dirFiles = await fs.readdir(UPLOAD_DIR);
  } catch {
    dirFiles = [];
  }

  for (const filename of dirFiles) {
    if (!isSafeUploadFilename(filename)) continue;
    if (!byFile.has(filename)) {
      const stat = await fs.stat(path.join(UPLOAD_DIR, filename)).catch(() => null);
      byFile.set(filename, {
        filename,
        kind: inferKind(filename),
        messageCount: 0,
        receivedCount: 0,
        sentCount: 0,
        lastAt: stat?.mtime ?? new Date(0),
        previewLabel: "Arquivo no servidor"
      });
    }
  }

  const items: MediaLibraryItem[] = [];

  for (const agg of byFile.values()) {
    if (filter === "received" && agg.receivedCount === 0) continue;
    if (filter === "sent" && agg.sentCount === 0) continue;

    const stat = await fs.stat(path.join(UPLOAD_DIR, agg.filename)).catch(() => null);
    items.push({
      filename: agg.filename,
      url: publicUploadUrl(agg.filename),
      kind: agg.kind,
      sizeBytes: stat?.size ?? 0,
      messageCount: agg.messageCount,
      receivedCount: agg.receivedCount,
      sentCount: agg.sentCount,
      lastAt: agg.lastAt.toISOString(),
      previewLabel: agg.previewLabel
    });
  }

  items.sort((a, b) => new Date(b.lastAt).getTime() - new Date(a.lastAt).getTime());

  const totalBytes = items.reduce((sum, i) => sum + i.sizeBytes, 0);
  return { items, totalBytes, totalFiles: items.length };
}

async function clearQuickReplyMedia(filename: string): Promise<void> {
  if (!prisma) return;
  const s = await prisma.appSettings.findUnique({ where: { id: "default" } });
  if (!Array.isArray(s?.quickReplies)) return;

  let changed = false;
  const next = (s.quickReplies as Record<string, unknown>[]).map((raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const mediaUrl = String(raw.mediaUrl ?? "");
    const name = uploadFilenameFromUrl(mediaUrl);
    if (name !== filename) return raw;
    changed = true;
    return {
      ...raw,
      mediaUrl: "",
      filename: "",
      kind: "text"
    };
  });

  if (changed) {
    await prisma.appSettings.update({
      where: { id: "default" },
      data: { quickReplies: next as object }
    });
  }
}

export async function deleteMediaFile(
  filename: string
): Promise<{ ok: boolean; message?: string }> {
  if (!isSafeUploadFilename(filename)) {
    return { ok: false, message: "Nome de arquivo inválido" };
  }

  const filePath = path.join(UPLOAD_DIR, filename);
  try {
    await fs.unlink(filePath);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, message };
    }
  }

  if (prisma) {
    const session = await getSessionName();
    const rows = await prisma.inboxMessage.findMany({
      where: {
        session,
        mediaUrl: { contains: filename }
      },
      select: { id: true, mediaUrl: true }
    });

    for (const row of rows) {
      const name = uploadFilenameFromUrl(toPublicMediaUrl(row.mediaUrl) ?? row.mediaUrl ?? "");
      if (name !== filename) continue;
      await prisma.inboxMessage.update({
        where: { id: row.id },
        data: { mediaUrl: null }
      });
    }

    await clearQuickReplyMedia(filename);
  }

  return { ok: true };
}
