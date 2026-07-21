import { useState } from "react";
import { WppConnectPanel } from "../components/wpp/WppConnectPanel";
import { WppInstancesManager } from "../components/wpp/WppInstancesManager";
import { AiAssistantPanel } from "../components/ai/AiAssistantPanel";
import { Icon, type IconName, PageHeader } from "../components/ui";

type Tab = "instances" | "connect" | "ai";

const TABS: { id: Tab; label: string; desc: string; icon: IconName }[] = [
  {
    id: "instances",
    label: "Instâncias",
    desc: "Números e sessões do WhatsApp conectadas ao painel.",
    icon: "inbox"
  },
  {
    id: "connect",
    label: "Conexão / QR",
    desc: "Vincule o aparelho lendo o QR Code.",
    icon: "chat"
  },
  {
    id: "ai",
    label: "Assistente IA",
    desc: "Aprendizado, regras e auto-resposta por instância.",
    icon: "spark"
  }
];

export function Settings() {
  const [tab, setTab] = useState<Tab>("connect");
  const [panelKey, setPanelKey] = useState(0);
  const current = TABS.find((t) => t.id === tab);

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Configurações"
        subtitle="Gerencie a instância ativa, conecte o WhatsApp e configure o assistente de IA. O atendimento fica no menu WhatsApp."
      />

      <div>
        <div
          role="tablist"
          aria-label="Seções de configuração"
          className="flex gap-1 rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-1"
        >
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setTab(t.id)}
                className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                  active
                    ? "bg-brand-500/12 text-brand-300 shadow-[0_0_0_1px_rgba(16,185,129,0.22)_inset]"
                    : "text-zinc-400 hover:bg-[var(--surface-2)] hover:text-zinc-200"
                }`}
              >
                <Icon name={t.icon} className="h-4 w-4" />
                <span className="truncate">{t.label}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-2.5 px-1 text-xs text-zinc-500">{current?.desc}</p>
      </div>

      <div className="zap-enter" key={tab}>
        {tab === "instances" && (
          <WppInstancesManager
            onActivated={() => {
              setPanelKey((k) => k + 1);
              setTab("connect");
            }}
          />
        )}
        {tab === "connect" && <WppConnectPanel key={panelKey} />}
        {tab === "ai" && <AiAssistantPanel />}
      </div>
    </div>
  );
}
