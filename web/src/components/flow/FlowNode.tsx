import { Handle, Position, type NodeProps } from "@xyflow/react";
import { NODE_LABELS } from "./nodeMeta";

/** Alturas fixas — handles calculados em px para alinhar com o nome da oferta. */
const OFFER_HEADER_H = 56;
const OFFER_ROW_H = 92;
const OFFER_ROW_PAD_TOP = 12;
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
  return OFFER_HEADER_H + rowIndex * OFFER_ROW_H + OFFER_ROW_PAD_TOP + OFFER_TITLE_LINE_H / 2;
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
      className={`border-b border-zinc-700/40 last:border-b-0 ${
        isDefault ? "bg-zinc-900/50" : "bg-emerald-500/[0.05]"
      }`}
      style={{ height: OFFER_ROW_H, paddingTop: OFFER_ROW_PAD_TOP, paddingBottom: 14 }}
    >
      <div
        className="flex items-center gap-2 px-3"
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
        <div className="w-4 shrink-0" aria-hidden />
      </div>

      <div className="mt-2.5 px-3 pl-[46px]">
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
          <div className="text-[10px] text-amber-500/90">configure os códigos</div>
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

  const tagConditionNames =
    type === "condition_contact_tag"
      ? ((config.tagNames as string[] | undefined) ?? [])
      : [];

  if (type === "condition_contact_tag") {
    const slots = [
      {
        key: "yes",
        handleId: "yes",
        variant: "offer" as const,
        outputNumber: 1,
        title: "Tem a tag",
        codes: tagConditionNames.join(", ") || undefined
      },
      {
        key: "no",
        handleId: "no",
        variant: "default" as const,
        outputNumber: 2,
        title: "Não tem a tag",
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
          className="border-b border-zinc-700/40 px-3 py-3"
          style={{ height: OFFER_HEADER_H }}
        >
          <div className="text-xs font-medium text-zinc-400">{label}</div>
          <div className="mt-1.5 text-[10px] leading-snug text-zinc-600">
            Saída 1 = tem tag · Saída 2 = não tem
          </div>
        </div>

        {slots.map((slot) => (
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
          className="border-b border-zinc-700/40 px-3 py-3"
          style={{ height: OFFER_HEADER_H }}
        >
          <div className="text-xs font-medium text-zinc-400">{label}</div>
          <div className="mt-1.5 text-[10px] leading-snug text-zinc-600">
            Ligue cada bolinha na linha do nome da oferta
          </div>
        </div>

        {slots.map((slot) => (
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
