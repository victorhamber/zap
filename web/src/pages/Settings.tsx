import { useState } from "react";
import { WppConnectPanel } from "../components/wpp/WppConnectPanel";
import { WppInstancesManager } from "../components/wpp/WppInstancesManager";
import { WppToolsPanel } from "../components/wpp/WppToolsPanel";

type Tab = "instances" | "connect" | "tools";

export function Settings() {
  const [tab, setTab] = useState<Tab>("connect");
  const [panelKey, setPanelKey] = useState(0);

  const tabs: { id: Tab; label: string; desc: string }[] = [
    { id: "instances", label: "Instâncias", desc: "Números e sessões WPP" },
    { id: "connect", label: "Conexão / QR", desc: "Conectar aparelho" },
    { id: "tools", label: "Ferramentas", desc: "API WPPConnect" }
  ];

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-semibold text-white">Configurações</h1>
      <p className="text-sm text-zinc-400 mt-1 max-w-2xl leading-relaxed">
        Gerencie instâncias WhatsApp, QR Code e integração com o servidor WPP. O atendimento e
        conversas ficam no menu <strong className="text-zinc-300">WhatsApp</strong>.
      </p>

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

      <p className="mt-2 text-xs text-zinc-500">{tabs.find((t) => t.id === tab)?.desc}</p>

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

      <div className="mt-8 rounded-2xl border border-zinc-800/60 bg-zinc-950/40 p-5 text-sm text-zinc-500">
        <p>
          URL do WPP e chave secreta ficam nas variáveis de ambiente do EasyPanel (
          <code className="text-zinc-400">WPP_BASE_URL</code>,{" "}
          <code className="text-zinc-400">WPP_INTERNAL_URL</code>,{" "}
          <code className="text-zinc-400">WPP_SECRET_KEY</code>).
        </p>
      </div>
    </div>
  );
}
