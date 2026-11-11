import { useMemo, useState } from "react";
import { AI_MODELS, AI_PROVIDERS, modelLabel, priceTitle, type AiProviderId } from "./aiCatalog";

type Props = {
  modelChat: string;
  disabled?: boolean;
  onPick: (apiId: string) => void;
};

export function AiProviderModelPicker({ modelChat, disabled, onPick }: Props) {
  const [provider, setProvider] = useState<AiProviderId>("openai");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");

  const models = useMemo(() => {
    const q = query.trim().toLowerCase();
    return AI_MODELS.filter((m) => m.provider === provider && (!q || m.label.toLowerCase().includes(q)));
  }, [provider, query]);

  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm text-white">A inteligência que ele usa</p>
        <label className="mt-2 block text-xs text-zinc-400" htmlFor="ai-provider">
          Empresa de inteligência artificial
        </label>
        <select
          id="ai-provider"
          className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100"
          value={provider}
          onChange={(e) => {
            setProvider(e.target.value as AiProviderId);
            setNotice("");
            setOpen(false);
          }}
        >
          {AI_PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <p className="text-xs text-zinc-400">Modelo</p>
        <button
          type="button"
          className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-left text-sm text-zinc-100"
          onClick={() => setOpen((v) => !v)}
          disabled={disabled}
        >
          {modelLabel(modelChat)}
        </button>
        {open && (
          <div className="mt-2 rounded-lg border border-zinc-700 bg-zinc-950">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar modelo"
              className="w-full border-b border-zinc-800 bg-transparent px-3 py-2 text-sm text-zinc-100 outline-none"
            />
            <ul className="max-h-64 overflow-y-auto py-1">
              {models.map((model) => (
                <li key={`${model.provider}-${model.label}`}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-zinc-100 hover:bg-emerald-700"
                    onClick={() => {
                      if (provider !== "openai" || !model.apiId) {
                        setNotice(
                          "O Zap só envia pela chave OpenAI. Esse nome fica na lista, e o atendimento continua no modelo já salvo."
                        );
                        return;
                      }
                      setNotice("");
                      setOpen(false);
                      onPick(model.apiId);
                    }}
                  >
                    <span>
                      {model.apiId === modelChat ? "✓ " : ""}
                      {model.label}
                      {model.apiId === "gpt-4o" ? " · padrão" : ""}
                    </span>
                    {priceTitle(model) && (
                      <span title={priceTitle(model)} className="text-zinc-400">
                        $
                      </span>
                    )}
                  </button>
                </li>
              ))}
              {models.length === 0 && <li className="px-3 py-2 text-sm text-zinc-500">Nenhum modelo com esse nome.</li>}
            </ul>
          </div>
        )}
      </div>
      {notice && <p className="text-xs text-amber-200/90">{notice}</p>}
    </div>
  );
}
