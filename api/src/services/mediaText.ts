/** Detecta payload base64 que não deve aparecer como texto no chat. */
export function isLikelyBase64Payload(text: string): boolean {
  const t = text.replace(/\s/g, "");
  if (t.length < 80) return false;
  if (t.startsWith("data:")) return true;
  return /^[A-Za-z0-9+/=]+$/.test(t.slice(0, Math.min(400, t.length)));
}

export function labelForMediaType(type: string): string {
  if (type === "image" || type === "sticker") return "📷 Imagem";
  if (type === "video") return "🎬 Vídeo";
  if (type === "audio" || type === "ptt") return "🎤 Áudio";
  if (type === "document") return "📎 Documento";
  if (type === "location") return "📍 Localização";
  return "";
}

export function captionFromText(type: string, text: string): string {
  if (isLikelyBase64Payload(text)) return labelForMediaType(type);
  const t = text.trim();
  if (!t) return labelForMediaType(type);
  return t;
}

export function mimeFromMessageType(type: string): string {
  if (type === "image" || type === "sticker") return "image/jpeg";
  if (type === "video") return "video/mp4";
  if (type === "audio" || type === "ptt") return "audio/ogg";
  return "application/octet-stream";
}
