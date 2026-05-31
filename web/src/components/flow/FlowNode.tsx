import { Handle, Position, type NodeProps } from "@xyflow/react";
import { NODE_LABELS } from "./nodeMeta";

type OfferBranch = {
  id: string;
  label: string;
  codes?: string[];
  codesText?: string;
};

function branchCodesPreview(branch: OfferBranch): string {
  if (typeof branch.codesText === "string" && branch.codesText.trim()) {
    return branch.codesText.trim();
  }
  return (branch.codes ?? []).join(", ");
}

function OfferOutputRow({
  outputNumber,
  title,
  subtitle,
  codes,
  handleId,
  variant
}: {
  outputNumber: number;
  title: string;
  subtitle: string;
  codes?: string;
  handleId: string;
  variant: "offer" | "default";
}) {
  const isDefault = variant === "default";

  return (
    <div
      className={`relative flex items-stretch gap-0 border-b border-zinc-800/60 last:border-b-0 min-h-[52px] ${
        isDefault ? "bg-zinc-900/40" : "bg-emerald-500/[0.06]"
      }`}
    >
      <div
        className={`flex w-[52px] shrink-0 flex-col items-center justify-center border-r px-1 ${
          isDefault ? "border-zinc-700/80 bg-zinc-800/30" : "border-emerald-500/20 bg-emerald-500/10"
        }`}
      >
        <span
          className={`text-[8px] font-semibold uppercase tracking-wider ${
            isDefault ? "text-zinc-500" : "text-emerald-500/90"
          }`}
        >
          Saída
        </span>
        <span
          className={`text-base font-bold leading-none ${
            isDefault ? "text-zinc-400" : "text-emerald-400"
          }`}
        >
          {outputNumber}
        </span>
      </div>

      <div className="min-w-0 flex-1 py-2 pl-2.5 pr-10">
        <div
          className={`text-xs font-semibold truncate ${
            isDefault ? "text-zinc-300" : "text-zinc-100"
          }`}
        >
          {title}
        </div>
        <div className="text-[10px] text-zinc-500 mt-0.5">{subtitle}</div>
        {codes ? (
          <div
            className="mt-1 text-[10px] font-mono text-emerald-400/80 truncate"
            title={codes}
          >
            {codes}
          </div>
        ) : !isDefault ? (
          <div className="mt-1 text-[10px] text-amber-500/90">⚠ configure os códigos</div>
        ) : null}
      </div>

      <div
        className={`absolute right-8 top-1/2 -translate-y-1/2 text-[9px] font-medium whitespace-nowrap ${
          isDefault ? "text-zinc-500" : "text-emerald-500/80"
        }`}
      >
        conectar →
      </div>

      <Handle
        type="source"
        position={Position.Right}
        id={handleId}
        title={`Saída ${outputNumber}: ${title}`}
        className={`!h-3 !w-3 !border-2 !border-zinc-950 ${
          isDefault ? "!bg-zinc-400" : "!bg-emerald-400"
        }`}
        style={{
          position: "absolute",
          right: -8,
          top: "50%",
          transform: "translateY(-50%)"
        }}
      />
    </div>
  );
}

export function FlowNodeComponent({ data, selected }: NodeProps) {
  const type = String(data.nodeType ?? "node");
  const label = NODE_LABELS[type] ?? type;
  const config = (data.config ?? {}) as Record<string, unknown>;
  const branches =
    type === "condition_offer_code"
      ? ((config.branches as OfferBranch[] | undefined) ?? [])
      : [];

  if (type === "condition_offer_code") {
    return (
      <div
        className={`relative min-w-[248px] max-w-[280px] overflow-visible rounded-xl border text-sm shadow-lg ${
          selected ? "border-emerald-400 bg-zinc-900" : "border-zinc-700 bg-zinc-950"
        }`}
      >
        <Handle
          type="target"
          position={Position.Left}
          className="!bg-emerald-400"
          style={{ top: 32 }}
        />

        <div className="border-b border-zinc-800/70 px-3 py-2">
          <div className="text-xs font-medium text-zinc-400">{label}</div>
          <div className="text-[10px] text-zinc-600 mt-0.5 leading-snug">
            Cada saída numerada → ligue ao bloco de mensagem correspondente
          </div>
        </div>

        {branches.map((branch, index) => {
          const codes = branchCodesPreview(branch);
          const name = branch.label?.trim() || "Sem nome";
          return (
            <OfferOutputRow
              key={branch.id}
              outputNumber={index + 1}
              title={name}
              subtitle="Se o código da compra for:"
              codes={codes || undefined}
              handleId={branch.id}
              variant="offer"
            />
          );
        })}

        <OfferOutputRow
          outputNumber={branches.length + 1}
          title="Outros"
          subtitle="Qualquer código que não esteja nas saídas acima"
          handleId="default"
          variant="default"
        />
      </div>
    );
  }

  return (
    <div
      className={`min-w-[140px] rounded-xl border px-3 py-2 text-sm shadow-lg ${
        selected ? "border-emerald-400 bg-zinc-900" : "border-zinc-700 bg-zinc-950"
      }`}
    >
      <Handle type="target" position={Position.Left} className="!bg-emerald-400" />
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="font-medium truncate">{String(data.summary ?? "")}</div>
      <Handle type="source" position={Position.Right} className="!bg-emerald-400" />
    </div>
  );
}

export const flowNodeTypes = {
  flowNode: FlowNodeComponent
};
