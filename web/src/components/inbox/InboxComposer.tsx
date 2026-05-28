import { useEffect, useRef, useState } from "react";
import { api } from "../../api/client";

export type QuickReply = { id: string; title: string; text: string };

type Props = {
  draft: string;
  onDraftChange: (v: string) => void;
  onSendText: () => void;
  onSendMedia: (
    type: "image" | "video" | "audio" | "document",
    url: string,
    caption?: string,
    filename?: string
  ) => void;
  quickReplies: QuickReply[];
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

async function uploadDataUrl(data: string, mime?: string): Promise<string> {
  const r = await api<{ ok: boolean; url?: string; message?: string }>("/api/inbox/upload", {
    method: "POST",
    body: JSON.stringify({ data, mime })
  });
  if (!r.ok || !r.url) throw new Error(r.message ?? "Falha no upload");
  return r.url;
}

function IconPlus() {
  return (
    <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor">
      <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" />
    </svg>
  );
}

function IconSmile() {
  return (
    <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm3.5-9c.83 0 1.5-.67 1.5-1.5S16.33 8 15.5 8 14 8.67 14 9.5s.67 1.5 1.5 1.5zm-7 0c.83 0 1.5-.67 1.5-1.5S9.33 8 8.5 8 7 8.67 7 9.5 7.67 11 8.5 11zm3.5 6.5c2.33 0 4.31-1.46 5.11-3.5H6.89c.8 2.04 2.78 3.5 5.11 3.5z" />
    </svg>
  );
}

function IconMic() {
  return (
    <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor">
      <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
    </svg>
  );
}

function IconSend() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
      <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor">
      <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
    </svg>
  );
}

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

export function InboxComposer({
  draft,
  onDraftChange,
  onSendText,
  onSendMedia,
  quickReplies,
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

  const hasText = draft.trim().length > 0;

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

  function cancelRecording() {
    recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    recorderRef.current = null;
    streamRef.current = null;
    chunksRef.current = [];
    setRecording(false);
    setRecordSec(0);
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const reader = new FileReader();
        reader.onload = () => onSendMedia("audio", reader.result as string);
        reader.readAsDataURL(blob);
        setRecordSec(0);
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
      setRecordSec(0);
    } catch {
      alert("Permita o microfone para gravar áudio.");
    }
  }

  function finishRecording() {
    recorderRef.current?.stop();
    setRecording(false);
  }

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>, kind: typeof ATTACH_ITEMS[0]["kind"]) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || disabled) return;
    setAttachOpen(false);
    setUploading(true);
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const mime = file.type || "application/octet-stream";
      let type = kind;
      if (mime.startsWith("video/")) type = "video";
      if (mime.startsWith("image/")) type = "image";
      if (mime.startsWith("audio/")) type = "audio";

      if (type === "audio" && dataUrl.startsWith("data:")) {
        onSendMedia("audio", dataUrl);
      } else {
        const url = await uploadDataUrl(dataUrl, mime);
        onSendMedia(type, url, undefined, file.name);
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

  const EMOJIS = ["😀", "😂", "❤️", "👍", "🙏", "🔥", "✅", "😉", "🎉", "💬"];

  if (recording) {
    return (
      <div className="shrink-0 border-l border-[#2a3942] bg-[#202c33] px-3 py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={cancelRecording}
            className="text-[#8696a0] hover:text-[#e9edef] p-2"
            title="Descartar"
          >
            <IconTrash />
          </button>
          <span className="w-2 h-2 rounded-full bg-[#ea0038] shrink-0 animate-pulse" />
          <span className="text-[#e9edef] text-sm tabular-nums w-10">{formatRecordTime(recordSec)}</span>
          <div className="flex-1 h-2 rounded-full bg-[#2a3942] overflow-hidden">
            <div
              className="h-full bg-[#00a884] transition-all duration-300"
              style={{ width: `${Math.min(100, (recordSec / 60) * 100 + 8)}%` }}
            />
          </div>
          <button
            type="button"
            onClick={finishRecording}
            className="h-12 w-12 rounded-full bg-[#00a884] text-[#111b21] flex items-center justify-center shrink-0"
            title="Enviar áudio"
          >
            <IconSend />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="shrink-0 border-l border-[#2a3942] bg-[#202c33] relative" ref={attachRef}>
      {quickReplies.length > 0 && (
        <div className="flex gap-2 px-3 pt-2 overflow-x-auto">
          {quickReplies.map((q) => (
            <button
              key={q.id}
              type="button"
              disabled={disabled}
              onClick={() => onDraftChange(q.text)}
              className="shrink-0 rounded-full border border-[#3b4a54] px-3 py-1 text-xs text-[#aebac1] hover:bg-[#2a3942]"
            >
              {q.title}
            </button>
          ))}
        </div>
      )}

      {attachOpen && (
        <div className="absolute bottom-full left-3 mb-2 w-56 rounded-xl bg-[#233138] shadow-xl border border-[#2a3942] py-2 z-20">
          {ATTACH_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              disabled={disabled || uploading}
              onClick={() => openFilePicker(item)}
              className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-[#2a3942] text-left text-[#e9edef] text-[15px]"
            >
              <span
                className="w-6 h-6 rounded-full shrink-0"
                style={{ backgroundColor: item.color }}
              />
              {item.label}
            </button>
          ))}
        </div>
      )}

      {emojiOpen && (
        <div className="absolute bottom-full left-12 mb-2 p-3 rounded-xl bg-[#233138] border border-[#2a3942] shadow-xl z-20 flex flex-wrap gap-1 max-w-[280px]">
          {EMOJIS.map((em) => (
            <button
              key={em}
              type="button"
              className="text-xl p-1 hover:bg-[#2a3942] rounded"
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
        onChange={(e) => {
          const kind = (e.currentTarget.dataset.kind ?? "document") as (typeof ATTACH_ITEMS)[0]["kind"];
          void onPickFile(e, kind);
        }}
      />

      <footer className="flex items-end gap-1 px-2 py-2 pb-3">
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            setAttachOpen((v) => !v);
            setEmojiOpen(false);
          }}
          className="p-2 text-[#8696a0] hover:text-[#e9edef] shrink-0"
          title="Anexar"
        >
          <IconPlus />
        </button>

        <div className="flex-1 flex items-center gap-2 rounded-lg bg-[#2a3942] px-4 py-2 min-h-[42px] max-h-32">
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setEmojiOpen((v) => !v);
              setAttachOpen(false);
            }}
            className="text-[#8696a0] hover:text-[#e9edef] shrink-0 p-0.5"
            title="Emoji"
          >
            <IconSmile />
          </button>
          <textarea
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (hasText) onSendText();
              }
            }}
            rows={1}
            disabled={disabled}
            placeholder="Digite uma mensagem"
            className="flex-1 resize-none bg-transparent border-0 text-sm text-[#e9edef] placeholder:text-[#8696a0] max-h-28 py-2 focus:outline-none focus:ring-0 disabled:opacity-50"
          />
        </div>

        {hasText ? (
          <button
            type="button"
            onClick={onSendText}
            disabled={disabled || uploading}
            className="h-12 w-12 rounded-full bg-[#00a884] text-[#111b21] flex items-center justify-center shrink-0 disabled:opacity-40"
            aria-label="Enviar"
          >
            <IconSend />
          </button>
        ) : (
          <button
            type="button"
            disabled={disabled || uploading}
            onClick={() => startRecording()}
            className="p-2 text-[#8696a0] hover:text-[#e9edef] shrink-0"
            title="Gravar áudio"
          >
            <IconMic />
          </button>
        )}
      </footer>
    </div>
  );
}
