import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ReactFlow,
  Background,
  Panel,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type ReactFlowInstance
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { api } from "../api/client";
import { flowNodeTypes } from "../components/flow/FlowNode";
import { FlowNodeProperties } from "../components/flow/FlowNodeProperties";
import { NodeContextMenu } from "../components/flow/NodeContextMenu";
import { FlowZoomToolbar } from "../components/flow/FlowZoomToolbar";
import { PALETTE, defaultNodeData, NODE_LABELS, paletteDragType } from "../components/flow/nodeMeta";

const FIT_VIEW_OPTS = { padding: 0.45, maxZoom: 0.72, duration: 280 };

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
    edges: Array<{ id: string; source: string; target: string; sourceHandle?: string }>;
  };
};

type ContextMenuState =
  | { kind: "node"; x: number; y: number; nodeId: string }
  | { kind: "edge"; x: number; y: number; edgeId: string };

function summaryFor(type: string, data: Record<string, unknown>): string {
  if (type === "send_text") return String(data.text ?? "").slice(0, 40);
  if (type === "delay") return `${data.value} ${data.unit}`;
  if (type === "schedule_at") return String(data.datetime ?? "").slice(0, 16);
  if (type.startsWith("send_")) return String(data.url ?? "").slice(0, 30);
  if (type === "trigger_inbound" && data.keyword) return `Palavra: ${data.keyword}`;
  if (type === "condition_offer_code") {
    const branches = (data.branches as Array<{ label?: string }> | undefined) ?? [];
    return branches.length ? `${branches.length} oferta(s) + outros` : "Sem regras";
  }
  if (type === "tag_action") {
    const mode = data.mode === "remove" ? "Remover" : "Adicionar";
    const names = (data.tagNames as string[] | undefined) ?? [];
    return names.length ? `${mode}: ${names.join(", ")}` : mode;
  }
  if (type === "start_flow") {
    const name = String(data.targetFlowName ?? "").trim();
    return name || "Selecione um fluxo";
  }
  return type;
}

function toReactFlowNodes(graphNodes: FlowRecord["graphJson"]["nodes"]): Node[] {
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
    target: e.target,
    sourceHandle: e.sourceHandle ?? null
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
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const rfRef = useRef<ReactFlowInstance | null>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedId) ?? null,
    [nodes, selectedId]
  );

  const selectEdge = useCallback(
    (edgeId: string | null) => {
      setSelectedEdgeId(edgeId);
      setEdges((eds) => eds.map((e) => ({ ...e, selected: edgeId ? e.id === edgeId : false })));
    },
    [setEdges]
  );

  const deleteNode = useCallback(
    (nodeId: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      setSelectedId((cur) => (cur === nodeId ? null : cur));
      setStatus("Bloco removido.");
    },
    [setNodes, setEdges]
  );

  const deleteEdge = useCallback(
    (edgeId: string) => {
      setEdges((eds) => eds.filter((e) => e.id !== edgeId));
      setSelectedEdgeId(null);
      setStatus("Conexão removida.");
    },
    [setEdges]
  );

  const onFlowInit = useCallback((instance: ReactFlowInstance) => {
    rfRef.current = instance;
  }, []);

  useEffect(() => {
    if (!id) return;
    api<FlowRecord>(`/api/flows/${id}`).then((f) => {
      setFlow(f);
      setName(f.name);
      setEnabled(f.enabled);
      setNodes(toReactFlowNodes(f.graphJson.nodes));
      setEdges(toReactFlowEdges(f.graphJson.edges));
      window.setTimeout(() => {
        rfRef.current?.fitView(FIT_VIEW_OPTS);
      }, 120);
    });
  }, [id, setNodes, setEdges]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Delete" || e.key === "Backspace") {
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        if (selectedEdgeId) {
          e.preventDefault();
          deleteEdge(selectedEdgeId);
          return;
        }
        if (selectedId) {
          e.preventDefault();
          deleteNode(selectedId);
        }
      }
      if (e.key === "Escape") {
        setContextMenu(null);
        setSelectedId(null);
        selectEdge(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, selectedEdgeId, deleteNode, deleteEdge, selectEdge]);

  const onConnect = useCallback(
    (c: Connection) => setEdges((eds) => addEdge(c, eds)),
    [setEdges]
  );

  const addNodeAt = useCallback(
    (type: string, position: { x: number; y: number }) => {
      const nid = `n_${Date.now()}`;
      const data = defaultNodeData(type);
      setNodes((nds) => [
        ...nds,
        {
          id: nid,
          type: "flowNode",
          position,
          data: {
            nodeType: type,
            summary: summaryFor(type, data),
            config: data
          }
        }
      ]);
      setSelectedId(nid);
    },
    [setNodes]
  );

  const onPaletteDragStart = useCallback((e: React.DragEvent, type: string) => {
    e.dataTransfer.setData(paletteDragType(), type);
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const onCanvasDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onCanvasDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer.getData(paletteDragType());
      if (!type || !rfRef.current) return;
      const position = rfRef.current.screenToFlowPosition({
        x: e.clientX,
        y: e.clientY
      });
      addNodeAt(type, position);
    },
    [addNodeAt]
  );

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
        target: e.target,
        ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {})
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
  const panelOpen = Boolean(selectedNode);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-zinc-950 text-white">
      <header className="shrink-0 flex items-center gap-3 border-b border-zinc-800/80 bg-zinc-950/95 px-3 py-2 backdrop-blur">
        <Link
          to="/flows"
          className="shrink-0 rounded-lg px-2 py-1.5 text-sm text-zinc-400 hover:bg-zinc-900 hover:text-white"
        >
          ← Voltar
        </Link>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="min-w-0 flex-1 bg-transparent text-base font-semibold outline-none border-b border-transparent focus:border-zinc-700"
        />
        <label className="flex shrink-0 items-center gap-2 text-sm text-zinc-400">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className="rounded"
          />
          Ativo
        </label>
        <input
          placeholder="Tel. teste"
          value={testPhone}
          onChange={(e) => setTestPhone(e.target.value)}
          className="w-32 shrink-0 rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm"
        />
        <button
          type="button"
          onClick={testFlow}
          className="shrink-0 rounded-lg border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-900"
        >
          Testar
        </button>
        <button
          type="button"
          onClick={save}
          className="shrink-0 rounded-lg bg-emerald-500 px-4 py-1.5 text-sm font-semibold text-zinc-950 hover:bg-emerald-400"
        >
          Salvar
        </button>
      </header>

      {status && (
        <div className="shrink-0 px-4 py-1 text-xs text-zinc-500 border-b border-zinc-900">{status}</div>
      )}

      <div className="relative flex-1 min-h-0">
        {paletteOpen && (
          <aside className="absolute left-3 top-3 bottom-3 z-20 w-52 flex flex-col rounded-xl border border-zinc-800/90 bg-zinc-950/95 shadow-2xl backdrop-blur pointer-events-auto">
            <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
              <span className="text-xs font-semibold text-zinc-400">Blocos</span>
              <button
                type="button"
                onClick={() => setPaletteOpen(false)}
                className="text-zinc-500 hover:text-zinc-300 text-xs"
              >
                Ocultar
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {PALETTE.map((p) => (
                <div
                  key={p.type}
                  draggable
                  onDragStart={(e) => onPaletteDragStart(e, p.type)}
                  className="w-full cursor-grab active:cursor-grabbing rounded-lg border border-zinc-800 px-2.5 py-2 text-sm text-zinc-200 hover:bg-zinc-900 hover:border-zinc-700 select-none"
                  role="button"
                  tabIndex={0}
                >
                  {p.label}
                </div>
              ))}
            </div>
            <p className="px-2 pb-2 text-[10px] text-zinc-600">
              Arraste blocos para o fluxo. Clique na linha entre blocos e pressione Delete para
              remover a conexão.
            </p>
          </aside>
        )}

        {!paletteOpen && (
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="absolute left-3 top-3 z-20 rounded-xl border border-zinc-800 bg-zinc-950/95 px-3 py-2 text-sm text-zinc-400 hover:text-white shadow-lg pointer-events-auto"
          >
            + Blocos
          </button>
        )}

        <div className="absolute inset-0 z-0">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={(_, n) => {
              setContextMenu(null);
              setSelectedId(n.id);
              selectEdge(null);
            }}
            onNodeContextMenu={(e, n) => {
              e.preventDefault();
              setContextMenu({ kind: "node", x: e.clientX, y: e.clientY, nodeId: n.id });
              setSelectedId(n.id);
              selectEdge(null);
            }}
            onEdgeClick={(_, edge) => {
              setContextMenu(null);
              setSelectedId(null);
              selectEdge(edge.id);
            }}
            onEdgeContextMenu={(e, edge) => {
              e.preventDefault();
              selectEdge(edge.id);
              setContextMenu({ kind: "edge", x: e.clientX, y: e.clientY, edgeId: edge.id });
            }}
            onPaneClick={() => {
              setContextMenu(null);
              setSelectedId(null);
              selectEdge(null);
            }}
            onDragOver={onCanvasDragOver}
            onDrop={onCanvasDrop}
            nodeTypes={flowNodeTypes}
            onInit={onFlowInit}
            minZoom={0.15}
            maxZoom={1.75}
            defaultViewport={{ x: 0, y: 0, zoom: 0.65 }}
            deleteKeyCode={null}
            defaultEdgeOptions={{
              interactionWidth: 24,
              style: { stroke: "#52525b", strokeWidth: 1.5 }
            }}
            className="flow-editor-canvas"
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#3f3f46" gap={20} />
            <FlowZoomToolbar panelOpen={panelOpen} />
            <Panel position="top-right" className="!m-3 pointer-events-none">
              {selectedEdgeId && (
                <span className="rounded-lg bg-zinc-900/90 border border-emerald-700/50 px-2 py-1 text-xs text-emerald-400">
                  Conexão selecionada · Delete para remover
                </span>
              )}
              {!selectedEdgeId && selectedNode && (
                <span className="rounded-lg bg-zinc-900/90 border border-zinc-700 px-2 py-1 text-xs text-zinc-400">
                  {NODE_LABELS[String(selectedNode.data.nodeType)] ?? selectedNode.data.nodeType}
                </span>
              )}
            </Panel>
          </ReactFlow>
        </div>

        {contextMenu?.kind === "node" && (
          <NodeContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onEdit={() => setSelectedId(contextMenu.nodeId)}
            onDelete={() => deleteNode(contextMenu.nodeId)}
            onClose={() => setContextMenu(null)}
          />
        )}

        {contextMenu?.kind === "edge" && (
          <NodeContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            deleteLabel="Remover conexão"
            onDelete={() => deleteEdge(contextMenu.edgeId)}
            onClose={() => setContextMenu(null)}
          />
        )}

        {selectedNode && (
          <aside className="absolute right-0 top-0 bottom-0 z-30 w-full max-w-md border-l border-zinc-800 bg-zinc-950/98 shadow-[-8px_0_32px_rgba(0,0,0,0.45)] backdrop-blur pointer-events-auto">
            <FlowNodeProperties
              selectedNode={selectedNode}
              flowId={flow?.id}
              config={cfg}
              onUpdate={updateSelectedConfig}
              onClose={() => setSelectedId(null)}
            />
          </aside>
        )}
      </div>
    </div>
  );
}
