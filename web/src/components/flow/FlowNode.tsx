import { Handle, Position, type NodeProps } from "@xyflow/react";
import { NODE_LABELS } from "./nodeMeta";

type OfferBranch = {
  id: string;
  label: string;
  codes?: string[];
};

export function FlowNodeComponent({ data, selected }: NodeProps) {
  const type = String(data.nodeType ?? "node");
  const label = NODE_LABELS[type] ?? type;
  const config = (data.config ?? {}) as Record<string, unknown>;
  const branches =
    type === "condition_offer_code"
      ? ((config.branches as OfferBranch[] | undefined) ?? [])
      : [];

  if (type === "condition_offer_code") {
    const slots = [...branches, { id: "default", label: "Outros" }];
    const slotCount = slots.length;

    return (
      <div
        className={`relative min-w-[180px] rounded-xl border px-3 py-2 pb-3 text-sm shadow-lg ${
          selected ? "border-emerald-400 bg-zinc-900" : "border-zinc-700 bg-zinc-950"
        }`}
      >
        <Handle type="target" position={Position.Left} className="!bg-emerald-400" />
        {slots.map((slot, index) => {
          const top = `${((index + 1) / (slotCount + 1)) * 100}%`;
          const isDefault = slot.id === "default";
          return (
            <Handle
              key={slot.id}
              type="source"
              position={Position.Right}
              id={slot.id}
              style={{ top }}
              className={isDefault ? "!bg-zinc-500" : "!bg-emerald-400"}
            />
          );
        })}
        <div className="text-xs text-zinc-500">{label}</div>
        <div className="font-medium truncate">{String(data.summary ?? "")}</div>
        <div className="mt-2 space-y-0.5">
          {slots.map((slot) => (
            <div
              key={`label-${slot.id}`}
              className={`text-[10px] text-right pr-2 ${
                slot.id === "default" ? "text-zinc-500" : "text-zinc-400"
              }`}
            >
              {slot.label}
            </div>
          ))}
        </div>
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
