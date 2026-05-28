import { useState } from "react";
import { WppConnectPanel } from "../components/wpp/WppConnectPanel";
import { WppInstancesManager } from "../components/wpp/WppInstancesManager";
import { WppToolsPanel } from "../components/wpp/WppToolsPanel";

type Tab = "instances" | "connect" | "tools";

export function WhatsApp() {
  const [tab, setTab] = useState<Tab>("connect");
  const [panelKey, setPanelKey] = useState(0);

  const tabs: { id: Tab; label: string }[] = [
    { id: "instances", label: "Instâncias" },
    { id: "connect", label: "Conexão / QR" },
    { id: "tools", label: "Ferramentas" }
  ];

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold">Central WhatsApp</h1>
      <p className="text-sm text-zinc-400 mt-1 max-w-2xl leading-relaxed">
        Este é o único lugar para gerenciar WhatsApp: cada instância é um número (ou conexão).
        Crie quantas precisar, escaneie o QR aqui e troque entre elas — sem abrir o WPPConnect.
      </p>

      <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-4 py-3 text-sm text-zinc-300">
        <strong className="text-emerald-300">Outro número?</strong> Aba{" "}
        <button type="button" onClick={() => setTab("instances")} className="text-emerald-400 underline">
          Instâncias
        </button>
        {" → "}
        <em>+ Nova instância</em>
        {" → aba "}
        <button type="button" onClick={() => setTab("connect")} className="text-emerald-400 underline">
          Conexão / QR
        </button>
        {" e escaneie."}
      </div>

      <div className="mt-6 flex flex-wrap gap-1 rounded-xl border border-zinc-800 bg-zinc-950/80 p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-4 py-2 text-sm transition ${
              tab === t.id
                ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/25"
                : "text-zinc-400 hover:text-zinc-200 border border-transparent"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="mt-6 space-y-6">
        {tab === "instances" && (
          <WppInstancesManager
            onActivated={() => {
              setPanelKey((k) => k + 1);
              setTab("connect");
            }}
          />
        )}
        {tab === "connect" && <WppConnectPanel key={panelKey} />}
        {tab === "tools" && <WppToolsPanel />}
      </div>
    </div>
  );
}
