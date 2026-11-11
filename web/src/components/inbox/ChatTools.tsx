import { useEffect, useState } from "react";
import { api } from "../../api/client";

type Props = {
  chatId: string;
  phone: string;
  noteMode: boolean;
  onNoteMode: (value: boolean) => void;
  onArchived: () => void;
  onUseSuggestion: (text: string) => void;
};

type Mode = "auto" | "human";

export function ChatTools({ chatId, phone, noteMode, onNoteMode, onArchived, onUseSuggestion }: Props) {
  const [mode, setMode] = useState<Mode>("auto");
  const [notice, setNotice] = useState("");
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestText, setSuggestText] = useState("");
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancel = false;
    void api<{ mode?: Mode }>(`/api/inbox/mode?chatId=${encodeURIComponent(chatId)}`)
      .then((r) => {
        if (!cancel && (r.mode === "human" || r.mode === "auto")) setMode(r.mode);
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, [chatId]);

  async function setHuman(next: Mode) {
    await api("/api/inbox/mode", {
      method: "POST",
      body: JSON.stringify({ chatId, mode: next })
    });
    setMode(next);
    setNotice(next === "human" ? "Você assumiu. A IA não responde até devolver." : "A conversa voltou para a IA.");
  }

  async function suggest() {
    setBusy(true);
    setNotice("");
    try {
      const history = await api<{ messages?: { body: string; fromMe: boolean }[] }>(
        `/api/inbox/messages?chatId=${encodeURIComponent(chatId)}&sync=0`
      );
      const last = [...(history.messages ?? [])].reverse().find((m) => !m.fromMe && m.body.trim());
      const inbound = last?.body.trim() || "Olá";
      const hint = feedback.trim() ? `${inbound}\n\nPreferência de quem atende: ${feedback.trim()}` : inbound;
      const r = await api<{ ok?: boolean; reply?: string; error?: string }>("/api/ai/test-reply", {
        method: "POST",
        body: JSON.stringify({ chatId, inboundText: hint })
      });
      if (!r.reply) {
        setNotice(r.error ?? "A IA não devolveu um texto.");
        return;
      }
      setSuggestText(r.reply);
      setSuggestOpen(true);
    } catch (e: unknown) {
      setNotice(e instanceof Error ? e.message : "Não foi possível sugerir.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-b border-[#2a3942] bg-[#111b21] px-3 py-2 space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {[
          ["Reservar serviço", "O Zap não tem agenda de serviço."],
          ["Convidar", "O Zap não tem equipe para convidar."],
          ["Transferir", "O Zap não tem outro atendente para transferir."]
        ].map(([label, why]) => (
          <button
            key={label}
            type="button"
            className="rounded-lg bg-[#2a3942] px-2.5 py-1.5 text-xs text-[#e9edef]"
            onClick={() => setNotice(why)}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          className="rounded-lg bg-[#00a884] px-2.5 py-1.5 text-xs font-medium text-[#111b21]"
          onClick={() => void setHuman(mode === "human" ? "auto" : "human")}
        >
          {mode === "human" ? "Devolver para a IA" : "Assumir"}
        </button>
        <button
          type="button"
          className="rounded-lg bg-[#2a3942] px-2.5 py-1.5 text-xs text-[#e9edef]"
          onClick={() => {
            const hours = window.prompt("Lembrar daqui a quantas horas?", "2");
            const n = Number(hours);
            if (!hours || !Number.isFinite(n) || n <= 0) return;
            localStorage.setItem(`zap-remind:${chatId}`, String(Date.now() + n * 3600_000));
            setNotice(`Lembrete neste navegador para daqui a ${n} h.`);
          }}
        >
          Lembrar
        </button>
        <button type="button" className="rounded-lg bg-[#2a3942] px-2.5 py-1.5 text-xs text-[#e9edef]" onClick={() => void setHuman("human")}>
          Fechar
        </button>
        <button
          type="button"
          className="rounded-lg bg-[#2a3942] px-2.5 py-1.5 text-xs text-[#e9edef]"
          onClick={() => {
            void api("/api/inbox/archive", {
              method: "POST",
              body: JSON.stringify({ chatId, phone })
            }).then(() => onArchived());
          }}
        >
          Arquivar
        </button>
        <button
          type="button"
          className="rounded-lg bg-[#2a3942] px-2.5 py-1.5 text-xs text-[#e9edef]"
          onClick={() => {
            localStorage.setItem(`zap-personal:${chatId}`, "1");
            setNotice("Marcada como pessoal neste navegador.");
          }}
        >
          Marcar como pessoal
        </button>
        <button
          type="button"
          className={`rounded-lg px-2.5 py-1.5 text-xs ${noteMode ? "bg-[#00a884] text-[#111b21]" : "bg-[#2a3942] text-[#e9edef]"}`}
          onClick={() => onNoteMode(!noteMode)}
        >
          Nota interna
        </button>
        <button
          type="button"
          disabled={busy}
          className="rounded-lg bg-[#2a3942] px-2.5 py-1.5 text-xs text-[#e9edef] disabled:opacity-60"
          onClick={() => void suggest()}
        >
          {busy ? "Sugerindo…" : "Sugerir resposta"}
        </button>
      </div>
      {notice && <p className="text-xs text-[#8696a0]">{notice}</p>}
      {suggestOpen && (
        <div className="rounded-lg border border-[#2a3942] bg-[#202c33] p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm text-[#e9edef]">Sugestão para revisar</p>
            <button type="button" className="text-xs text-[#00a884]" onClick={() => void suggest()}>
              Sugerir resposta
            </button>
          </div>
          <p className="text-[11px] text-[#8696a0]">
            Aprovar envia somente este texto. Não altera dados, agenda ou a autonomia do agente.
          </p>
          <textarea
            value={suggestText}
            onChange={(e) => setSuggestText(e.target.value)}
            className="min-h-24 w-full rounded-lg border border-[#2a3942] bg-[#111b21] px-3 py-2 text-sm text-[#e9edef]"
          />
          <input
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Feedback para a próxima sugestão"
            className="w-full rounded-lg border border-[#2a3942] bg-[#111b21] px-3 py-2 text-sm text-[#e9edef]"
          />
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded-lg bg-[#00a884] px-3 py-1.5 text-xs font-medium text-[#111b21]"
              onClick={() => {
                const text = suggestText.trim();
                if (!text) return;
                onUseSuggestion(text);
                setSuggestOpen(false);
              }}
            >
              Aprovar e enviar
            </button>
            <button
              type="button"
              className="rounded-lg border border-[#3b4a54] px-3 py-1.5 text-xs text-[#e9edef]"
              onClick={() => setSuggestOpen(false)}
            >
              Rejeitar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
