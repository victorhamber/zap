import { useRef, useState } from "react";

export type QuickReply = { id: string; title: string; text: string };

type Props = {
  draft: string;
  onDraftChange: (v: string) => void;
  onSendText: () => void;
  onSendMedia: (type: "image" | "video" | "audio" | "document", url: string, caption?: string) => void;
  quickReplies: QuickReply[];
  disabled?: boolean;
};

export function InboxComposer({
  draft,
  onDraftChange,
  onSendText,
  onSendMedia,
  quickReplies,
  disabled
}: Props) {
  const [showAttach, setShowAttach] = useState(false);
  const [mediaUrl, setMediaUrl] = useState("");
  const [mediaCaption, setMediaCaption] = useState("");
  const [recording, setRecording] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          onSendMedia("audio", dataUrl);
        };
        reader.readAsDataURL(blob);
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      alert("Permita o microfone para gravar áudio.");
    }
  }

  function stopRecording() {
    recorderRef.current?.stop();
    setRecording(false);
  }

  return (
    <div className="shrink-0 border-l border-[#2a3942] bg-[#202c33]">
      {quickReplies.length > 0 && (
        <div className="flex gap-2 px-3 pt-2 overflow-x-auto">
          {quickReplies.map((q) => (
            <button
              key={q.id}
              type="button"
              disabled={disabled}
              onClick={() => onDraftChange(q.text)}
              className="shrink-0 rounded-full border border-[#3b4a54] px-3 py-1 text-xs text-[#aebac1] hover:bg-[#2a3942]"
              title={q.text}
            >
              {q.title}
            </button>
          ))}
        </div>
      )}

      {showAttach && (
        <div className="mx-3 mt-2 p-3 rounded-lg bg-[#2a3942] space-y-2 text-sm">
          <p className="text-xs text-[#8696a0]">URL pública do arquivo (imagem, vídeo, PDF ou áudio)</p>
          <input
            value={mediaUrl}
            onChange={(e) => setMediaUrl(e.target.value)}
            placeholder="https://..."
            className="w-full rounded bg-[#111b21] px-3 py-2 border-0 text-[#e9edef]"
          />
          <input
            value={mediaCaption}
            onChange={(e) => setMediaCaption(e.target.value)}
            placeholder="Legenda (opcional)"
            className="w-full rounded bg-[#111b21] px-3 py-2 border-0 text-[#e9edef]"
          />
          <div className="flex flex-wrap gap-2">
            {(["image", "video", "document"] as const).map((t) => (
              <button
                key={t}
                type="button"
                disabled={!mediaUrl.trim() || disabled}
                onClick={() => {
                  onSendMedia(t, mediaUrl.trim(), mediaCaption.trim() || undefined);
                  setMediaUrl("");
                  setMediaCaption("");
                  setShowAttach(false);
                }}
                className="rounded-lg bg-[#00a884]/20 text-[#00a884] px-3 py-1.5 text-xs disabled:opacity-40"
              >
                {t === "image" ? "Imagem" : t === "video" ? "Vídeo" : "Documento"}
              </button>
            ))}
          </div>
        </div>
      )}

      <footer className="px-3 py-3 flex gap-2 items-end">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setShowAttach((v) => !v)}
          className="h-11 w-11 shrink-0 rounded-full text-[#8696a0] hover:bg-[#2a3942] text-xl"
          title="Anexar"
        >
          +
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => (recording ? stopRecording() : startRecording())}
          className={`h-11 w-11 shrink-0 rounded-full text-xl ${
            recording ? "bg-red-500/30 text-red-300 animate-pulse" : "text-[#8696a0] hover:bg-[#2a3942]"
          }`}
          title={recording ? "Parar gravação" : "Gravar áudio"}
        >
          🎤
        </button>
        <textarea
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSendText();
            }
          }}
          rows={1}
          disabled={disabled}
          placeholder="Digite uma mensagem"
          className="flex-1 resize-none rounded-lg bg-[#2a3942] border-0 px-4 py-2.5 text-sm text-[#e9edef] placeholder:text-[#8696a0] max-h-32 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={onSendText}
          disabled={disabled || !draft.trim()}
          className="h-11 w-11 rounded-full bg-[#00a884] flex items-center justify-center text-[#111b21] disabled:opacity-40 shrink-0"
          aria-label="Enviar"
        >
          ➤
        </button>
      </footer>
    </div>
  );
}
