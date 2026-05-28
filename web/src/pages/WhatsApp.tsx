import { WppConnectPanel } from "../components/wpp/WppConnectPanel";

export function WhatsApp() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">WhatsApp</h1>
      <p className="text-sm text-zinc-400 mt-1">Conecte sua conta sem sair do Zap</p>
      <div className="mt-6 max-w-lg">
        <WppConnectPanel />
      </div>
    </div>
  );
}
