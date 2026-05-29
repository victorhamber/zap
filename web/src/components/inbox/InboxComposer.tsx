import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import type { QuickReply } from "../../types/quickReply";

export type { QuickReply };

type Props = {
  draft: string;
  onDraftChange: (v: string) => void;
  onSendText: () => void;
  onSendMedia: (
    type: "image" | "video" | "audio" | "document",
    url: string,
    caption?: string,
    filename?: string
  ) => Promise<void>;
  quickReplies: QuickReply[];
  onUseQuickReply: (reply: QuickReply) => void | Promise<void>;
  disabled?: boolean;
};

async function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function uploadDataUrl(data: string, mime?: string): Promise<string> {
  const r = await api<{ ok: boolean; url?: string; message?: string }>("/api/inbox/upload", {
    method: "POST",
    body: JSON.stringify({ data, mime })
  });
  if (!r.ok || !r.url) throw new Error(r.message ?? "Falha no upload");
  return r.url;
}

function pickAudioMimeType(): string {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];
  for (const t of types) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
  }
  return "audio/webm";
}

function IconPlus() {
  return (
    <svg viewBox="0 0 24 24" className="w-[22px] h-[22px]" fill="currentColor" aria-hidden>
      <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
    </svg>
  );
}

function IconSmile() {
  return (
    <svg viewBox="0 0 24 24" className="w-[22px] h-[22px]" fill="currentColor" aria-hidden>
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z" />
    </svg>
  );
}

function IconMic() {
  return (
    <svg viewBox="0 0 24 24" className="w-[22px] h-[22px]" fill="currentColor" aria-hidden>
      <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
    </svg>
  );
}

function IconSend() {
  return (
    <svg viewBox="0 0 24 24" className="w-[20px] h-[20px]" fill="currentColor" aria-hidden>
      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg viewBox="0 0 24 24" className="w-[22px] h-[22px]" fill="currentColor" aria-hidden>
      <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
    </svg>
  );
}

const MAX_VIDEO_BYTES = 64 * 1024 * 1024;
const MAX_OTHER_BYTES = 25 * 1024 * 1024;

const ATTACH_ITEMS: Array<{
  id: string;
  label: string;
  color: string;
  accept?: string;
  kind: "image" | "video" | "audio" | "document";
}> = [
  { id: "doc", label: "Documento", color: "#7f66ff", kind: "document", accept: ".pdf,.doc,.docx,.txt" },
  {
    id: "media",
    label: "Fotos e vídeos",
    color: "#007bfc",
    kind: "image",
    accept: "image/*,video/*"
  },
  { id: "audio", label: "Áudio", color: "#ff7d3b", kind: "audio", accept: "audio/*" }
];

const EMOJIS = ["😀", "😂", "❤️", "👍", "🙏", "🔥", "✅", "😉", "🎉", "💬"];
/** ~5 linhas, similar ao WhatsApp Web antes de rolar. */
const DRAFT_MAX_HEIGHT_PX = 150;

export function InboxComposer({
  draft,
  onDraftChange,
  onSendText,
  onSendMedia,
  quickReplies,
  onUseQuickReply,
  disabled
}: Props) {
  const [attachOpen, setAttachOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSec, setRecordSec] = useState(0);
  const [uploading, setUploading] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingAccept, setPendingAccept] = useState("image/*,video/*");
  const attachRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const mimeRef = useRef("audio/webm");

  const hasText = draft.trim().length > 0;

  const resizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "0px";
    const next = Math.min(el.scrollHeight, DRAFT_MAX_HEIGHT_PX);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > DRAFT_MAX_HEIGHT_PX ? "auto" : "hidden";
  }, []);

  useEffect(() => {
    resizeTextarea();
  }, [draft, resizeTextarea]);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setRecordSec((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  useEffect(() => {
    if (!attachOpen) return;
    const close = (e: MouseEvent) => {
      if (attachRef.current && !attachRef.current.contains(e.target as Node)) {
        setAttachOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [attachOpen]);

  function formatRecordTime(sec: number) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  function cancelRecording() {
    try {
      recorderRef.current?.stop();
    } catch {
      /* ignore */
    }
    stopStream();
    recorderRef.current = null;
    chunksRef.current = [];
    setRecording(false);
    setRecordSec(0);
  }

  async function sendRecordedBlob(blob: Blob, mime: string) {
    if (blob.size < 200) return;
    setUploading(true);
    try {
      const dataUrl = await blobToDataUrl(blob);
      if (mime.includes("webm") || mime.includes("ogg")) {
        onSendMedia("audio", dataUrl);
      } else {
        const url = await uploadDataUrl(dataUrl, mime);
        onSendMedia("audio", url);
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Erro ao enviar áudio");
    } finally {
      setUploading(false);
      setRecordSec(0);
    }
  }

  async function startRecording() {
    if (disabled || uploading) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = pickAudioMimeType();
      mimeRef.current = mime;
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        stopStream();
        const blob = new Blob(chunksRef.current, { type: mimeRef.current });
        chunksRef.current = [];
        void sendRecordedBlob(blob, mimeRef.current);
      };
      recorderRef.current = rec;
      rec.start(250);
      setRecording(true);
      setRecordSec(0);
    } catch {
      alert("Permita o microfone para gravar áudio.");
    }
  }

  function finishRecording() {
    if (!recorderRef.current || recorderRef.current.state === "inactive") return;
    recorderRef.current.stop();
    setRecording(false);
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>, kind: typeof ATTACH_ITEMS[0]["kind"]) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || disabled) return;
    setAttachOpen(false);

    const mime = file.type || "application/octet-stream";
    let type = kind;
    if (mime.startsWith("video/")) type = "video";
    if (mime.startsWith("image/")) type = "image";
    if (mime.startsWith("audio/")) type = "audio";

    const maxBytes = type === "video" ? MAX_VIDEO_BYTES : MAX_OTHER_BYTES;
    if (file.size > maxBytes) {
      const mb = Math.round(maxBytes / (1024 * 1024));
      alert(
        type === "video"
          ? `Vídeo muito grande. Máximo ${mb} MB no painel.`
          : `Arquivo muito grande (máximo ${mb} MB).`
      );
      return;
    }

    setUploading(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);

      if (type === "audio" && dataUrl.startsWith("data:")) {
        await onSendMedia("audio", dataUrl);
      } else {
        const url = await uploadDataUrl(dataUrl, mime);
        await onSendMedia(type, url, undefined, file.name);
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Erro ao enviar arquivo");
    } finally {
      setUploading(false);
    }
  }

  function openFilePicker(item: (typeof ATTACH_ITEMS)[0]) {
    setPendingAccept(item.accept ?? "*/*");
    setTimeout(() => {
      if (fileInputRef.current) {
        fileInputRef.current.accept = item.accept ?? "*/*";
        fileInputRef.current.dataset.kind = item.kind;
        fileInputRef.current.click();
      }
    }, 0);
    setAttachOpen(false);
  }

  if (recording) {
    return (
      <div className="wa-composer shrink-0 px-3 py-3">
        <div className="flex items-center gap-3 rounded-2xl bg-[var(--wa-bg-input)] px-3 py-2.5">
          <button
            type="button"
            onClick={cancelRecording}
            className="text-[var(--wa-text-secondary)] hover:text-[var(--wa-text-primary)] p-2 rounded-full hover:bg-white/5"
            title="Descartar"
          >
            <IconTrash />
          </button>
          <span className="w-2 h-2 rounded-full bg-[#ea0038] shrink-0 animate-pulse" />
          <span className="text-[var(--wa-text-primary)] text-sm tabular-nums min-w-[2.5rem]">
            {formatRecordTime(recordSec)}
          </span>
          <div className="flex-1 h-1.5 rounded-full bg-[#3b4a54] overflow-hidden">
            <div
              className="h-full bg-[var(--wa-accent)] transition-all duration-300 rounded-full"
              style={{ width: `${Math.min(100, 12 + recordSec * 3)}%` }}
            />
          </div>
          <button
            type="button"
            onClick={finishRecording}
            className="h-11 w-11 rounded-full bg-[var(--wa-accent)] text-[#052e24] flex items-center justify-center shrink-0 shadow-md"
            title="Enviar áudio"
          >
            <IconSend />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="wa-composer shrink-0 relative px-2 pb-2 pt-1" ref={attachRef}>
      {attachOpen && (
        <div className="absolute bottom-full left-2 mb-2 w-52 rounded-2xl bg-[#233138] shadow-2xl border border-[#3b4a54]/60 py-1.5 z-20 overflow-hidden">
          {ATTACH_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              disabled={disabled || uploading}
              onClick={() => openFilePicker(item)}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-[#2a3942] text-left text-[var(--wa-text-primary)] text-sm transition-colors"
            >
              <span
                className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-white text-xs font-bold"
                style={{ backgroundColor: item.color }}
              >
                {item.label.charAt(0)}
              </span>
              {item.label}
            </button>
          ))}
        </div>
      )}

      {emojiOpen && (
        <div className="absolute bottom-full left-10 mb-2 p-2.5 rounded-2xl bg-[#233138] border border-[#3b4a54]/60 shadow-2xl z-20 flex flex-wrap gap-0.5 max-w-[260px]">
          {EMOJIS.map((em) => (
            <button
              key={em}
              type="button"
              className="text-xl p-1.5 hover:bg-[#2a3942] rounded-xl transition-colors"
              onClick={() => {
                onDraftChange(draft + em);
                setEmojiOpen(false);
              }}
            >
              {em}
            </button>
          ))}
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept={pendingAccept}
        onChange={(e) => {
          const kind = (e.currentTarget.dataset.kind ?? "document") as (typeof ATTACH_ITEMS)[0]["kind"];
          void onPickFile(e, kind);
        }}
      />

      {uploading && (
        <p className="px-3 pb-1 text-xs text-[var(--wa-text-secondary)] animate-pulse">
          Enviando… (vídeos grandes podem levar alguns minutos)
        </p>
      )}

      <footer className="flex items-end gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setAttachOpen((v) => !v);
            setEmojiOpen(false);
          }}
          className="mb-1 p-2.5 rounded-full text-[var(--wa-text-secondary)] hover:text-[var(--wa-text-primary)] hover:bg-white/5 transition-colors shrink-0"
          title="Anexar"
        >
          <IconPlus />
        </button>

        <div className="flex-1 flex items-end gap-1 rounded-3xl bg-[var(--wa-bg-input)] px-3 py-1.5 min-h-[44px] border border-transparent focus-within:border-[#3b4a54]/80">
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setEmojiOpen((v) => !v);
              setAttachOpen(false);
            }}
            className="mb-1 text-[var(--wa-text-secondary)] hover:text-[var(--wa-text-primary)] shrink-0 p-1 rounded-full hover:bg-white/5"
            title="Emoji"
          >
            <IconSmile />
          </button>
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (hasText && !disabled && !uploading) onSendText();
              }
            }}
            rows={1}
            disabled={disabled || uploading}
            placeholder="Mensagem"
            className="flex-1 w-full min-h-[24px] resize-none overflow-hidden bg-transparent border-0 text-[15px] leading-snug text-[var(--wa-text-primary)] placeholder:text-[var(--wa-text-secondary)] py-2 focus:outline-none focus:ring-0 disabled:opacity-50"
          />
        </div>

        {hasText ? (
          <button
            type="button"
            onClick={onSendText}
            disabled={disabled || uploading}
            className="mb-0.5 h-11 w-11 rounded-full bg-[var(--wa-accent)] text-[#052e24] flex items-center justify-center shrink-0 disabled:opacity-40 shadow-md transition-transform active:scale-95"
            aria-label="Enviar"
          >
            <IconSend />
          </button>
        ) : (
          <button
            type="button"
            disabled={disabled || uploading}
            onClick={() => void startRecording()}
            className="mb-1 p-2.5 rounded-full text-[var(--wa-text-secondary)] hover:text-[var(--wa-text-primary)] hover:bg-white/5 shrink-0 transition-colors"
            title="Gravar áudio"
          >
            <IconMic />
          </button>
        )}
      </footer>

      {quickReplies.length > 0 && (
        <div className="flex flex-wrap gap-1.5 px-1 pt-2 max-h-[88px] overflow-y-auto">
          {quickReplies.map((q) => (
            <button
              key={q.id}
              type="button"
              disabled={disabled || uploading}
              onClick={() => void onUseQuickReply(q)}
              className="shrink-0 rounded-full px-3 py-1.5 text-xs font-medium text-white border border-white/10 hover:brightness-110 transition"
              style={{ backgroundColor: q.color || "#25D366" }}
              title={
                q.kind === "text"
                  ? q.text.slice(0, 120)
                  : `${q.kind}${q.text ? `: ${q.text}` : ""}`
              }
            >
              {q.title}
              {q.kind !== "text" && (
                <span className="ml-1 opacity-80">
                  {q.kind === "image"
                    ? "📷"
                    : q.kind === "video"
                      ? "🎬"
                      : q.kind === "audio"
                        ? "🎤"
                        : "📎"}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
