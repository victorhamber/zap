import { useState } from "react";
import { WppConnectPanel } from "../components/wpp/WppConnectPanel";
import { WppInstancesManager } from "../components/wpp/WppInstancesManager";
import { AiAssistantPanel } from "../components/ai/AiAssistantPanel";
import { EmailSettingsPanel } from "../components/email/EmailSettingsPanel";
import { Icon, type IconName, PageHeader } from "../components/ui";

type Tab = "instances" | "connect" | "ai" | "email";

const TABS: { id: Tab; label: string; desc: string; icon: IconName }[] = [
  {
    id: "instances",
    label: "Conexão oficial",
    desc: "API oficial da Meta (Cloud API). O QR fica na aba ao lado.",
    icon: "inbox"
  },
  {
    id: "connect",
    label: "QR (WAHA)",
    desc: "Vincule o celular lendo o QR da sessão no servidor.",
    icon: "chat"
  },
  {
    id: "ai",
    label: "Assistente IA",
    desc: "Aprendizado, regras e auto-resposta por instância.",
    icon: "spark"
  },
  {
    id: "email",
    label: "E-mail",
    desc: "API Resend e remetente para o bloco Enviar e-mail nos fluxos.",
    icon: "send"
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
        subtitle="Duas formas de conectar: a API oficial da Meta, ou o QR da sessão WAHA. A IA e o e-mail ficam nas abas ao lado."
      />

      <div>
        <div
          role="tablist"
          aria-label="Seções de configuração"
          className="flex gap-1 rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-1 shadow-xs"
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
                className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs md:text-sm font-medium transition-colors ${
                  active
                    ? "bg-white/[0.08] text-white shadow-xs"
                    : "text-zinc-400 hover:bg-white/[0.03] hover:text-zinc-200"
                }`}
              >
                <Icon
                  name={t.icon}
                  className={`h-4 w-4 ${active ? "text-emerald-400" : "text-zinc-500"}`}
                />
                <span className="truncate">{t.label}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 px-1 text-xs text-zinc-400 leading-normal">{current?.desc}</p>
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
        {tab === "email" && <EmailSettingsPanel />}
      </div>
    </div>
  );
}
