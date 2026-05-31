import { Handle, Position, type NodeProps } from "@xyflow/react";
import { NODE_LABELS } from "./nodeMeta";

/** Alturas fixas — handles calculados em px para alinhar com o nome da oferta. */
const OFFER_HEADER_H = 52;
const OFFER_ROW_H = 80;
const OFFER_TITLE_LINE_H = 32;

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

function handleTopForRow(rowIndex: number): number {
  return OFFER_HEADER_H + rowIndex * OFFER_ROW_H + OFFER_TITLE_LINE_H / 2;
}

function OfferOutputRow({
  outputNumber,
  title,
  codes,
  variant
}: {
  outputNumber: number;
  title: string;
  codes?: string;
  variant: "offer" | "default";
}) {
  const isDefault = variant === "default";

  return (
    <div
      className={`h-[80px] border-b border-zinc-800/70 last:border-b-0 ${
        isDefault ? "bg-zinc-900/50" : "bg-emerald-500/[0.05]"
      }`}
    >
      {/* Linha do nome — mesma altura em todas as saídas; a bolinha fica alinhada aqui */}
      <div
        className="flex h-8 items-center gap-2 px-2.5"
        style={{ height: OFFER_TITLE_LINE_H }}
      >
        <div
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[11px] font-bold ${
            isDefault
              ? "bg-zinc-800 text-zinc-400 ring-1 ring-zinc-600/50"
              : "bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/30"
          }`}
        >
          {outputNumber}
        </div>
        <div
          className={`min-w-0 flex-1 truncate text-[13px] font-semibold leading-none ${
            isDefault ? "text-zinc-200" : "text-white"
          }`}
        >
          {title}
        </div>
        <div
          className={`flex shrink-0 items-center gap-0.5 ${
            isDefault ? "text-zinc-500" : "text-emerald-400"
          }`}
          aria-hidden
        >
          <span className={`block h-px w-5 ${isDefault ? "bg-zinc-600" : "bg-emerald-500/50"}`} />
          <span className="text-base font-bold leading-none">→</span>
        </div>
        {/* Espaço reservado para a bolinha (Handle fica no nó pai, posição calculada) */}
        <div className="w-3 shrink-0" />
      </div>

      <div className="px-2.5 pb-2 pl-[46px]">
        {codes ? (
          <div
            className={`truncate font-mono text-[10px] leading-tight ${
              isDefault ? "text-zinc-500" : "text-emerald-400/75"
            }`}
            title={codes}
          >
            {isDefault ? "Demais códigos" : `cód.: ${codes}`}
          </div>
        ) : !isDefault ? (
          <div className="text-[10px] text-amber-500/90">configure os códigos →</div>
        ) : (
          <div className="text-[10px] text-zinc-600">não listados acima</div>
        )}
      </div>
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
    const slots = [
      ...branches.map((branch, index) => ({
        key: branch.id,
        handleId: branch.id,
        variant: "offer" as const,
        outputNumber: index + 1,
        title: branch.label?.trim() || "Sem nome",
        codes: branchCodesPreview(branch) || undefined
      })),
      {
        key: "default",
        handleId: "default",
        variant: "default" as const,
        outputNumber: branches.length + 1,
        title: "Outros",
        codes: undefined
      }
    ];

    return (
      <div
        className={`flow-offer-node relative w-[260px] overflow-visible rounded-xl border text-sm shadow-lg ${
          selected ? "border-emerald-400 bg-zinc-900" : "border-zinc-700 bg-zinc-950"
        }`}
      >
        <Handle
          type="target"
          position={Position.Left}
          className="!bg-emerald-400"
          style={{ top: OFFER_HEADER_H / 2 }}
        />

        <div
          className="border-b border-zinc-800/80 px-3 py-2.5"
          style={{ height: OFFER_HEADER_H }}
        >
          <div className="text-xs font-medium text-zinc-400">{label}</div>
          <div className="mt-1 text-[10px] leading-snug text-zinc-600">
            Ligue cada bolinha → na linha do nome da oferta
          </div>
        </div>

        {slots.map((slot, index) => (
          <OfferOutputRow
            key={slot.key}
            outputNumber={slot.outputNumber}
            title={slot.title}
            codes={slot.codes}
            variant={slot.variant}
          />
        ))}

        {slots.map((slot, index) => {
          const isDefault = slot.variant === "default";
          return (
            <Handle
              key={`handle-${slot.handleId}`}
              type="source"
              position={Position.Right}
              id={slot.handleId}
              className={`flow-offer-handle !h-3.5 !w-3.5 !border-2 !border-zinc-950 ${
                isDefault ? "!bg-zinc-400" : "!bg-emerald-400"
              }`}
              style={{
                top: handleTopForRow(index),
                right: -7
              }}
            />
          );
        })}
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
