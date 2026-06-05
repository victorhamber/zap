import { FLOW_TEMPLATE_VARIABLES, mustacheSnippet } from "./flowTemplateVars";

type Props = {
  compact?: boolean;
  onInsert?: (snippet: string) => void;
};

export function TemplateVariablesHelp({ compact, onInsert }: Props) {
  return (
    <div className={`zap-card ${compact ? "p-2.5" : "p-3"}`}>
      <p className="text-[11px] font-medium text-neutral-300 mb-2">
        Variáveis — clique para inserir no texto
      </p>
      <div className={`flex flex-wrap gap-1.5 ${compact ? "max-h-28" : "max-h-40"} overflow-y-auto`}>
        {FLOW_TEMPLATE_VARIABLES.map((v) => (
          <button
            key={v.key}
            type="button"
            onClick={() => onInsert?.(mustacheSnippet(v.key))}
            className="zap-var-chip"
            title={v.label}
          >
            {mustacheSnippet(v.key)}
          </button>
        ))}
      </div>
      {!compact && (
        <ul className="mt-3 space-y-1 max-h-32 overflow-y-auto pr-1 border-t border-zap-border pt-2">
          {FLOW_TEMPLATE_VARIABLES.map((v) => (
            <li key={`desc-${v.key}`} className="text-[10px] text-zap-muted leading-snug">
              <span className="text-zap-purple font-mono">{mustacheSnippet(v.key)}</span>
              <span> — {v.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
