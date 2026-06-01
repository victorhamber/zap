import { FLOW_TEMPLATE_VARIABLES, mustacheSnippet } from "./flowTemplateVars";

type Props = {
  compact?: boolean;
};

export function TemplateVariablesHelp({ compact }: Props) {
  return (
    <div
      className={`rounded-xl border border-zinc-800 bg-zinc-900/50 ${
        compact ? "p-2.5" : "p-3"
      }`}
    >
      <p className="text-[11px] font-medium text-zinc-300 mb-2">
        Variáveis no texto — use entre chaves duplas
      </p>
      <ul className={`space-y-1.5 ${compact ? "max-h-36" : "max-h-52"} overflow-y-auto pr-1`}>
        {FLOW_TEMPLATE_VARIABLES.map((v) => (
          <li key={v.key} className="text-[11px] leading-snug">
            <code className="text-emerald-400/95 font-mono">{mustacheSnippet(v.key)}</code>
            <span className="text-zinc-500"> — {v.label}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[10px] text-zinc-600 leading-relaxed">
        Preenchidas automaticamente no fluxo Hotmart. Em teste manual ou outros gatilhos, campos sem
        valor ficam vazios.
      </p>
    </div>
  );
}
