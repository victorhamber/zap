import { Link } from "react-router-dom";

export function Settings() {
  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-semibold">Configurações</h1>
      <p className="text-sm text-zinc-400 mt-1">Preferências gerais do painel</p>

      <div className="mt-8 rounded-2xl border border-zinc-800 bg-zinc-950/60 p-6">
        <h2 className="text-lg font-semibold text-white">WhatsApp e instâncias</h2>
        <p className="mt-2 text-sm text-zinc-400 leading-relaxed">
          Conectar outro número, criar instância, ver QR Code, trocar sessão ativa e usar as
          ferramentas do WPPConnect — tudo é feito aqui no Zap. Você{" "}
          <strong className="text-zinc-300 font-medium">não precisa abrir</strong> o painel do
          WPPConnect para o dia a dia.
        </p>
        <Link
          to="/whatsapp"
          className="mt-5 inline-flex rounded-xl bg-emerald-500 px-5 py-2.5 text-sm font-semibold text-zinc-950 hover:bg-emerald-400"
        >
          Abrir central WhatsApp →
        </Link>
      </div>

      <div className="mt-6 rounded-2xl border border-zinc-800/60 bg-zinc-950/40 p-5 text-sm text-zinc-500">
        <p>
          A URL do servidor WPP e a chave secreta ficam só nas variáveis de ambiente do EasyPanel
          (configuração de infraestrutura, uma vez no deploy). O restante é 100% pelo painel.
        </p>
      </div>
    </div>
  );
}
