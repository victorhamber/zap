import { useState } from "react";

type Mode = "auto" | "human";

type Props = {
  isGroup: boolean;
  mode: Mode;
  stage: string | null;
  onMode: (mode: Mode) => Promise<void>;
  onStage: (stage: string, lostReason?: string) => Promise<void>;
  onArchive: () => Promise<void>;
  onCloseChat: () => Promise<void>;
};

const STAGES = [
  { id: "em_conversa", label: "Em conversa" },
  { id: "comprou", label: "Comprou" },
  { id: "perdido", label: "Perdido" }
] as const;

const LOST = [
  { id: "preco", label: "Preço" },
  { id: "sumiu", label: "Sumiu" },
  { id: "ja_tem", label: "Já tem" },
  { id: "outro", label: "Outro" }
] as const;

export function ChatTools({ isGroup, mode, stage, onMode, onStage, onArchive, onCloseChat }: Props) {
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [askLost, setAskLost] = useState(false);
  const current = stage || "novo";

  async function run(action: () => Promise<void>, ok: string) {
    setNotice("");
    setBusy(true);
    try {
      await action();
      setNotice(ok);
    } catch (e: unknown) {
      setNotice(e instanceof Error ? e.message : "Não foi possível concluir.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-b border-[#2a3942] bg-[#111b21] px-3 py-2 space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {!isGroup && (
          <button
            type="button"
            disabled={busy}
            className="rounded-lg bg-[#00a884] px-2.5 py-1.5 text-xs font-medium text-[#111b21] disabled:opacity-60"
            onClick={() =>
              void run(
                () => onMode(mode === "human" ? "auto" : "human"),
                mode === "human" ? "A IA voltou a responder." : "Você assumiu. A IA parou."
              )
            }
          >
            {mode === "human" ? "Devolver para a IA" : "Assumir"}
          </button>
        )}
        {!isGroup &&
          STAGES.map((step) => (
            <button
              key={step.id}
              type="button"
              disabled={busy}
              className={`rounded-lg px-2.5 py-1.5 text-xs disabled:opacity-60 ${
                current === step.id ? "bg-[#00a884] text-[#111b21]" : "bg-[#2a3942] text-[#e9edef]"
              }`}
              onClick={() => {
                if (step.id === "perdido") {
                  setAskLost(true);
                  setNotice("Escolha o motivo de perdido.");
                  return;
                }
                setAskLost(false);
                void run(
                  () => onStage(step.id),
                  step.id === "em_conversa"
                    ? "Etapa Em conversa. A retomada segue o que está em Configurações."
                    : "Etapa Comprou gravada no contato."
                );
              }}
            >
              {step.label}
            </button>
          ))}
        <button
          type="button"
          disabled={busy}
          className="rounded-lg bg-[#2a3942] px-2.5 py-1.5 text-xs text-[#e9edef] disabled:opacity-60"
          onClick={() => {
            if (!window.confirm("Arquivar tira a conversa da lista. Ela volta quando a pessoa escrever.")) return;
            void run(() => onArchive(), "Conversa arquivada.");
          }}
        >
          Arquivar
        </button>
        <button
          type="button"
          disabled={busy}
          className="rounded-lg bg-[#2a3942] px-2.5 py-1.5 text-xs text-[#e9edef] disabled:opacity-60"
          onClick={() => {
            const why = isGroup
              ? "Fechar tira o grupo da lista. Ele volta se chegar mensagem nova."
              : "Fechar para a IA e tira a conversa da lista. Ela volta se a pessoa escrever, ainda sem a IA.";
            if (!window.confirm(why)) return;
            void run(() => onCloseChat(), "Conversa fechada.");
          }}
        >
          Fechar
        </button>
      </div>
      {askLost && !isGroup && (
        <div className="flex flex-wrap gap-1.5">
          {LOST.map((reason) => (
            <button
              key={reason.id}
              type="button"
              disabled={busy}
              className="rounded-md bg-[#2a3942] px-2 py-1 text-[11px] text-[#e9edef] disabled:opacity-60"
              onClick={() => {
                setAskLost(false);
                void run(() => onStage("perdido", reason.id), `Marcado como perdido: ${reason.label}.`);
              }}
            >
              {reason.label}
            </button>
          ))}
        </div>
      )}
      <p className="text-xs text-[#8696a0]">
        {notice ||
          (isGroup
            ? "A IA não responde em grupo. A estrela no campo sugere um texto para você enviar."
            : mode === "human"
              ? "Você assumiu. A IA não responde até devolver."
              : "A IA responde nesta conversa. A estrela no campo sugere um texto para revisar e enviar.")}
      </p>
    </div>
  );
}
