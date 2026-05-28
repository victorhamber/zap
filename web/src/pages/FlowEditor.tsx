import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { api } from "../api/client";
import { flowNodeTypes } from "../components/flow/FlowNode";
import { PALETTE, defaultNodeData, NODE_LABELS } from "../components/flow/nodeMeta";

type FlowRecord = {
  id: string;
  name: string;
  enabled: boolean;
  graphJson: {
    nodes: Array<{
      id: string;
      type: string;
      position: { x: number; y: number };
      data: Record<string, unknown>;
    }>;
    edges: Array<{ id: string; source: string; target: string }>;
  };
};

function summaryFor(type: string, data: Record<string, unknown>): string {
  if (type === "send_text") return String(data.text ?? "").slice(0, 40);
  if (type === "delay") return `${data.value} ${data.unit}`;
  if (type === "schedule_at") return String(data.datetime ?? "").slice(0, 16);
  if (type.startsWith("send_")) return String(data.url ?? "").slice(0, 30);
  if (type === "trigger_inbound" && data.keyword) return `Palavra: ${data.keyword}`;
  return type;
}

function toReactFlowNodes(
  graphNodes: FlowRecord["graphJson"]["nodes"]
): Node[] {
  return graphNodes.map((n) => ({
    id: n.id,
    type: "flowNode",
    position: n.position,
    data: {
      nodeType: n.type,
      summary: summaryFor(n.type, n.data),
      config: n.data
    }
  }));
}

function toReactFlowEdges(graphEdges: FlowRecord["graphJson"]["edges"]): Edge[] {
  return graphEdges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target
  }));
}

export function FlowEditor() {
  const { id } = useParams();
  const [flow, setFlow] = useState<FlowRecord | null>(null);
  const [name, setName] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [testPhone, setTestPhone] = useState("");

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedId),
    [nodes, selectedId]
  );

  useEffect(() => {
    if (!id) return;
    api<FlowRecord>(`/api/flows/${id}`).then((f) => {
      setFlow(f);
      setName(f.name);
      setEnabled(f.enabled);
      setNodes(toReactFlowNodes(f.graphJson.nodes));
      setEdges(toReactFlowEdges(f.graphJson.edges));
    });
  }, [id, setNodes, setEdges]);

  const onConnect = useCallback(
    (c: Connection) => setEdges((eds) => addEdge(c, eds)),
    [setEdges]
  );

  function addNode(type: string) {
    const nid = `n_${Date.now()}`;
    const data = defaultNodeData(type);
    setNodes((nds) => [
      ...nds,
      {
        id: nid,
        type: "flowNode",
        position: { x: 100 + nds.length * 40, y: 100 + nds.length * 30 },
        data: {
          nodeType: type,
          summary: summaryFor(type, data),
          config: data
        }
      }
    ]);
  }

  function updateSelectedConfig(patch: Record<string, unknown>) {
    if (!selectedNode) return;
    const config = { ...(selectedNode.data.config as Record<string, unknown>), ...patch };
    const type = String(selectedNode.data.nodeType);
    setNodes((nds) =>
      nds.map((n) =>
        n.id === selectedNode.id
          ? {
              ...n,
              data: {
                ...n.data,
                config,
                summary: summaryFor(type, config)
              }
            }
          : n
      )
    );
  }

  async function save() {
    if (!id) return;
    setStatus("Salvando…");
    const graphJson = {
      schemaVersion: 1 as const,
      nodes: nodes.map((n) => ({
        id: n.id,
        type: String(n.data.nodeType),
        position: n.position,
        data: n.data.config as Record<string, unknown>
      })),
      edges: edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target
      }))
    };
    await api(`/api/flows/${id}`, {
      method: "PUT",
      body: JSON.stringify({ name, enabled, graphJson })
    });
    setStatus("Salvo.");
  }

  async function testFlow() {
    if (!id || !testPhone) return;
    setStatus("Disparando teste…");
    await api(`/api/flows/${id}/test`, {
      method: "POST",
      body: JSON.stringify({ phone: testPhone })
    });
    setStatus("Teste enfileirado/executado.");
  }

  const cfg = (selectedNode?.data?.config ?? {}) as Record<string, unknown>;

  return (
    <div className="h-[calc(100vh-3rem)] flex flex-col">
      <div className="flex items-center justify-between gap-4 mb-4">
        <div>
          <Link to="/flows" className="text-sm text-emerald-400 hover:underline">
            ← Fluxos
          </Link>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="block mt-1 text-xl font-semibold bg-transparent border-b border-transparent focus:border-zinc-600 outline-none"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-zinc-400">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Ativo
          </label>
          <input
            placeholder="Tel. teste"
            value={testPhone}
            onChange={(e) => setTestPhone(e.target.value)}
            className="w-36 rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm"
          />
          <button onClick={testFlow} className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm">
            Testar
          </button>
          <button
            onClick={save}
            className="rounded-lg bg-emerald-400 px-4 py-1.5 text-sm font-semibold text-zinc-950"
          >
            Salvar
          </button>
        </div>
      </div>
      {status && <p className="text-xs text-zinc-500 mb-2">{status}</p>}

      <div className="flex-1 flex gap-3 min-h-0">
        <div className="w-48 shrink-0 rounded-xl border border-zinc-800 bg-zinc-950/80 p-3 overflow-y-auto">
          <div className="text-xs font-semibold text-zinc-500 mb-2">Blocos</div>
          {PALETTE.map((p) => (
            <button
              key={p.type}
              onClick={() => addNode(p.type)}
              className="w-full text-left rounded-lg border border-zinc-800 px-2 py-2 text-sm mb-1 hover:bg-zinc-900"
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="flex-1 rounded-xl border border-zinc-800 overflow-hidden">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, n) => setSelectedId(n.id)}
            nodeTypes={flowNodeTypes}
            fitView
          >
            <Background />
            <Controls />
            <MiniMap />
          </ReactFlow>
        </div>

        <div className="w-72 shrink-0 rounded-xl border border-zinc-800 bg-zinc-950/80 p-4 overflow-y-auto">
          <div className="text-sm font-semibold">Propriedades</div>
          {!selectedNode && (
            <p className="text-xs text-zinc-500 mt-2">Clique em um bloco.</p>
          )}
          {selectedNode && (
            <div className="mt-3 space-y-3 text-sm">
              <div className="text-xs text-zinc-500">
                {NODE_LABELS[String(selectedNode.data.nodeType)] ?? selectedNode.data.nodeType}
              </div>

              {selectedNode.data.nodeType === "send_text" && (
                <textarea
                  rows={6}
                  value={String(cfg.text ?? "")}
                  onChange={(e) => updateSelectedConfig({ text: e.target.value })}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs font-mono"
                />
              )}

              {(selectedNode.data.nodeType === "send_image" ||
                selectedNode.data.nodeType === "send_video" ||
                selectedNode.data.nodeType === "send_audio") && (
                <>
                  <label className="text-xs text-zinc-500">URL</label>
                  <input
                    value={String(cfg.url ?? "")}
                    onChange={(e) => updateSelectedConfig({ url: e.target.value })}
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs"
                  />
                  {selectedNode.data.nodeType !== "send_audio" && (
                    <>
                      <label className="text-xs text-zinc-500">Legenda</label>
                      <input
                        value={String(cfg.caption ?? "")}
                        onChange={(e) => updateSelectedConfig({ caption: e.target.value })}
                        className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs"
                      />
                    </>
                  )}
                </>
              )}

              {selectedNode.data.nodeType === "delay" && (
                <>
                  <label className="text-xs text-zinc-500">Valor</label>
                  <input
                    type="number"
                    min={0}
                    value={Number(cfg.value ?? 1)}
                    onChange={(e) => updateSelectedConfig({ value: Number(e.target.value) })}
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1"
                  />
                  <label className="text-xs text-zinc-500">Unidade</label>
                  <select
                    value={String(cfg.unit ?? "days")}
                    onChange={(e) => updateSelectedConfig({ unit: e.target.value })}
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1"
                  >
                    <option value="minutes">Minutos</option>
                    <option value="hours">Horas</option>
                    <option value="days">Dias</option>
                  </select>
                </>
              )}

              {selectedNode.data.nodeType === "schedule_at" && (
                <input
                  type="datetime-local"
                  value={String(cfg.datetime ?? "").slice(0, 16)}
                  onChange={(e) => updateSelectedConfig({ datetime: e.target.value })}
                  className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1"
                />
              )}

              {selectedNode.data.nodeType === "trigger_inbound" && (
                <>
                  <label className="text-xs text-zinc-500">Palavra-chave (opcional)</label>
                  <input
                    value={String(cfg.keyword ?? "")}
                    onChange={(e) => updateSelectedConfig({ keyword: e.target.value })}
                    className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-2 py-1"
                  />
                </>
              )}

              {selectedNode.data.nodeType === "trigger_hotmart" && (
                <p className="text-xs text-zinc-500">
                  Webhook: /api/webhooks/hotmart/{flow?.id}
                  <br />
                  Variáveis: {"{{name}}"}, {"{{phone}}"}, {"{{login}}"}, etc.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
