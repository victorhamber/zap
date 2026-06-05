import { useState } from "react";
import { WppConnectPanel } from "../components/wpp/WppConnectPanel";
import { WppInstancesManager } from "../components/wpp/WppInstancesManager";

type Tab = "instances" | "connect";

export function Settings() {
  const [tab, setTab] = useState<Tab>("connect");
  const [panelKey, setPanelKey] = useState(0);

  const tabs: { id: Tab; label: string; desc: string }[] = [
    { id: "instances", label: "Instâncias", desc: "Números e sessões do WhatsApp" },
    { id: "connect", label: "Conexão / QR", desc: "Vincular aparelho com QR Code" }
  ];

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold text-white">Configurações</h1>
      <p className="text-sm text-zinc-400 mt-1 leading-relaxed">
        Gerencie a instância ativa e conecte o WhatsApp. O atendimento fica no menu{" "}
        <strong className="text-zinc-300">WhatsApp</strong>.
      </p>

      <div className="mt-6 flex gap-1 rounded-xl border border-zinc-800 bg-zinc-950/80 p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-medium transition ${
              tab === t.id
                ? "bg-zap-orange-muted text-zap-orange border border-zap-orange/25 shadow-sm"
                : "text-zinc-400 hover:text-zinc-200 border border-transparent"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <p className="mt-2 text-xs text-zinc-500">{tabs.find((t) => t.id === tab)?.desc}</p>

      <div className="mt-6">
        {tab === "instances" && (
          <WppInstancesManager
            onActivated={() => {
              setPanelKey((k) => k + 1);
              setTab("connect");
            }}
          />
        )}
        {tab === "connect" && <WppConnectPanel key={panelKey} />}
      </div>
    </div>
  );
}
