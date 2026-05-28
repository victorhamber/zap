import { Handle, Position, type NodeProps } from "@xyflow/react";
import { NODE_LABELS } from "./nodeMeta";

export function FlowNodeComponent({ data, selected }: NodeProps) {
  const type = String(data.nodeType ?? "node");
  const label = NODE_LABELS[type] ?? type;

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
