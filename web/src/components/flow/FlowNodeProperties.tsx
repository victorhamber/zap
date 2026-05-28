import type { Node } from "@xyflow/react";
import { NODE_LABELS } from "./nodeMeta";

type Props = {
  selectedNode: Node;
  flowId?: string;
  config: Record<string, unknown>;
  onUpdate: (patch: Record<string, unknown>) => void;
  onClose: () => void;
};

export function FlowNodeProperties({
  selectedNode,
  flowId,
  config,
  onUpdate,
  onClose
}: Props) {
  const nodeType = String(selectedNode.data.nodeType);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-white">Propriedades</div>
          <div className="text-xs text-zinc-500">{NODE_LABELS[nodeType] ?? nodeType}</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg px-2 py-1 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
          aria-label="Fechar"
        >
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 text-sm">
        {nodeType === "send_text" && (
          <textarea
            rows={8}
            value={String(config.text ?? "")}
            onChange={(e) => onUpdate({ text: e.target.value })}
            className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs font-mono text-white"
            placeholder="Use {{name}}, {{phone}}, etc."
          />
        )}

        {(nodeType === "send_image" || nodeType === "send_video" || nodeType === "send_audio") && (
          <>
            <label className="text-xs text-zinc-500">URL do arquivo</label>
            <input
              value={String(config.url ?? "")}
              onChange={(e) => onUpdate({ url: e.target.value })}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-white"
            />
            {nodeType !== "send_audio" && (
              <>
                <label className="text-xs text-zinc-500">Legenda</label>
                <input
                  value={String(config.caption ?? "")}
                  onChange={(e) => onUpdate({ caption: e.target.value })}
                  className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-white"
                />
              </>
            )}
          </>
        )}

        {nodeType === "delay" && (
          <>
            <label className="text-xs text-zinc-500">Valor</label>
            <input
              type="number"
              min={0}
              value={Number(config.value ?? 1)}
              onChange={(e) => onUpdate({ value: Number(e.target.value) })}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
            />
            <label className="text-xs text-zinc-500">Unidade</label>
            <select
              value={String(config.unit ?? "days")}
              onChange={(e) => onUpdate({ unit: e.target.value })}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
            >
              <option value="minutes">Minutos</option>
              <option value="hours">Horas</option>
              <option value="days">Dias</option>
            </select>
          </>
        )}

        {nodeType === "schedule_at" && (
          <>
            <label className="text-xs text-zinc-500">Data e hora</label>
            <input
              type="datetime-local"
              value={String(config.datetime ?? "").slice(0, 16)}
              onChange={(e) => onUpdate({ datetime: e.target.value })}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
            />
          </>
        )}

        {nodeType === "trigger_inbound" && (
          <>
            <label className="text-xs text-zinc-500">Palavra-chave (opcional)</label>
            <input
              value={String(config.keyword ?? "")}
              onChange={(e) => onUpdate({ keyword: e.target.value })}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-3 py-2 text-white"
              placeholder="Vazio = qualquer mensagem"
            />
          </>
        )}

        {nodeType === "trigger_hotmart" && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-3 text-xs text-zinc-400">
            <p className="font-medium text-zinc-300 mb-1">Webhook Hotmart</p>
            <code className="break-all text-emerald-400/90">
              /api/webhooks/hotmart/{flowId}
            </code>
            <p className="mt-2">Variáveis: {"{{name}}"}, {"{{phone}}"}, {"{{login}}"}, etc.</p>
          </div>
        )}

        {nodeType === "trigger_manual" && (
          <p className="text-xs text-zinc-500">
            Use o botão &quot;Testar&quot; na barra superior com um telefone.
          </p>
        )}
      </div>
    </div>
  );
}
