export type QuickReplyKind = "text" | "image" | "video" | "audio" | "document";

export type QuickReply = {
  id: string;
  title: string;
  color: string;
  kind: QuickReplyKind;
  text: string;
  mediaUrl: string;
  filename: string;
  useCount: number;
  lastUsedAt: number;
};

export function sortQuickReplies(list: QuickReply[]): QuickReply[] {
  return [...list].sort((a, b) => {
    if (b.useCount !== a.useCount) return b.useCount - a.useCount;
    return b.lastUsedAt - a.lastUsedAt;
  });
}
