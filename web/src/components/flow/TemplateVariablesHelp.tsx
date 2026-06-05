import { FLOW_TEMPLATE_VARIABLES, mustacheSnippet } from "./flowTemplateVars";

type Props = {
  compact?: boolean;
  onInsert?: (snippet: string) => void;
};

export function TemplateVariablesHelp({ compact, onInsert }: Props) {
  return (
    <div
      className={`rounded-xl border border-zinc-800 bg-zinc-900/50 ${
        compact ? "p-2.5" : "p-3"
      }`}
    >
      <p className="text-[11px] font-medium text-zinc-300 mb-2">
        {onInsert ? "Variáveis — clique para inserir no texto" : "Variáveis no texto — use entre chaves duplas"}
      </p>
      {onInsert ? (
        <div className={`flex flex-wrap gap-1.5 ${compact ? "max-h-28" : "max-h-40"} overflow-y-auto`}>
          {FLOW_TEMPLATE_VARIABLES.map((v) => (
            <button
              key={v.key}
              type="button"
              onClick={() => onInsert(mustacheSnippet(v.key))}
              className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[11px] text-emerald-300 hover:bg-emerald-500/20"
              title={v.label}
            >
              {mustacheSnippet(v.key)}
            </button>
          ))}
        </div>
      ) : null}
      <ul
        className={`space-y-1.5 ${onInsert ? "mt-3 max-h-32 border-t border-zinc-800 pt-2" : compact ? "max-h-36" : "max-h-52"} overflow-y-auto pr-1`}
      >
        {FLOW_TEMPLATE_VARIABLES.map((v) => (
          <li key={v.key} className="text-[11px] leading-snug">
            <code className="text-emerald-400/95 font-mono">{mustacheSnippet(v.key)}</code>
            <span className="text-zinc-500"> — {v.label}</span>
          </li>
        ))}
      </ul>
      {!compact && (
        <p className="mt-2 text-[10px] text-zinc-600 leading-relaxed">
          Preenchidas automaticamente no fluxo Hotmart. Em teste manual ou outros gatilhos, campos sem
          valor ficam vazios.
        </p>
      )}
    </div>
  );
}
