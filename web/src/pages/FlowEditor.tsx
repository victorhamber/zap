import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ReactFlow,
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
import { PALETTE_GROUPS, defaultNodeData, NODE_LABELS, paletteDragType } from "../components/flow/nodeMeta";

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
  if (type === "trigger_groups") {
    const ids = (data.groupIds as string[] | undefined) ?? [];
    const days = (data.weekdays as number[] | undefined) ?? [];
    const time = String(data.time ?? "09:00");
    const sched = data.scheduleEnabled !== false && days.length > 0;
    if (!ids.length) return "Selecione grupos";
    return sched
      ? `${ids.length} grupo(s) · ${days.length} dia(s) · ${time}`
      : `${ids.length} grupo(s) · só manual`;
  }
  if (type === "condition_weekday") return "Seg → Dom (7 saídas)";
  if (type === "send_groups") {
    const ids = (data.groupIds as string[] | undefined) ?? [];
    const media = String(data.mediaType ?? "text");
    return ids.length ? `${ids.length} grupo(s) · ${media}` : "Selecione grupos";
  }
  if (type === "send_email") {
    const subject = String(data.subject ?? "").trim();
    return subject ? subject.slice(0, 40) : "Configure o e-mail";
  }
  if (type === "delay") return `${data.value} ${data.unit}`;
  if (type === "schedule_at") return String(data.datetime ?? "").slice(0, 16);
  if (type.startsWith("send_")) return String(data.url ?? "").slice(0, 30);
  if (type === "trigger_inbound" && data.keyword) return `Palavra: ${data.keyword}`;
  if (type === "trigger_inbound" || type === "trigger_tag") {
    const tags = (data.tags as string[] | undefined) ?? [];
    if (tags.length) return tags.join(", ");
  }
  if (type === "trigger_broadcast") return "Todos os contatos";
  if (type === "condition_offer_code") {
    const branches = (data.branches as Array<{ label?: string }> | undefined) ?? [];
    return branches.length ? `${branches.length} oferta(s) + outros` : "Sem regras";
  }
  if (type === "condition_contact_tag") {
    const names = (data.tagNames as string[] | undefined) ?? [];
    return names.length ? `Tag: ${names.join(", ")}` : "Configure tags";
  }
  if (type === "condition_contact_replied") {
    const since = data.sinceFlowStart !== false ? "desde início" : "qualquer época";
    const days = Number(data.withinDays ?? 0);
    return days > 0 ? `Resposta ${since} · ${days}d` : `Resposta ${since}`;
  }
  if (type === "split_round_robin") {
    const n = Math.min(4, Math.max(2, Number(data.branchCount) || 2));
    return `Round robin · ${n} ramos`;
  }
  if (type === "trigger_hotmart_pending") return "PIX / boleto gerado";
  if (type === "trigger_custom_webhook") {
    const mapping = (data.mapping as { phonePath?: string; namePath?: string } | undefined) ?? {};
    if (mapping.phonePath && mapping.namePath) return "Mapeado · name/phone";
    return "Aguardando mapeamento";
  }
  if (type === "trigger_wa_link") {
    const msg = String(data.message ?? "").trim();
    const tags = (data.tags as string[] | undefined) ?? [];
    if (!msg) return "Configure a mensagem";
    const preview = msg.length > 36 ? `${msg.slice(0, 36)}…` : msg;
    return tags.length ? `${preview} · ${tags.length} tag(s)` : preview;
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

function cloneNodeConfig(nodeType: string, config: Record<string, unknown>): Record<string, unknown> {
  const cloned = structuredClone(config);
  if (nodeType === "condition_offer_code" && Array.isArray(cloned.branches)) {
    cloned.branches = (cloned.branches as Array<Record<string, unknown>>).map((branch) => ({
      ...branch,
      id: `branch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    }));
  }
  return cloned;
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
  const [paletteSearch, setPaletteSearch] = useState("");
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const rfRef = useRef<ReactFlowInstance | null>(null);
  const enabledAtLoadRef = useRef(false);

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

  const duplicateNode = useCallback(
    (nodeId: string) => {
      const source = nodes.find((n) => n.id === nodeId);
      if (!source) return;
      const nodeType = String(source.data.nodeType);
      const config = cloneNodeConfig(nodeType, (source.data.config ?? {}) as Record<string, unknown>);
      const newId = `n_${Date.now()}`;
      setNodes((nds) => [
        ...nds,
        {
          id: newId,
          type: "flowNode",
          position: {
            x: source.position.x + 48,
            y: source.position.y + 48
          },
          data: {
            nodeType,
            summary: summaryFor(nodeType, config),
            config
          }
        }
      ]);
      setSelectedId(newId);
      selectEdge(null);
      setStatus("Bloco duplicado.");
    },
    [nodes, setNodes, selectEdge]
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
      enabledAtLoadRef.current = f.enabled;
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

  function hasBroadcastTrigger(): boolean {
    return nodes.some((n) => n.data.nodeType === "trigger_broadcast");
  }

  function hasGroupsTrigger(): boolean {
    return nodes.some((n) => n.data.nodeType === "trigger_groups");
  }

  async function dispatchBroadcast(): Promise<string | null> {
    if (!id) return null;
    const r = await api<{
      ok: boolean;
      scheduled?: number;
      skipped?: number;
      total?: number;
      error?: string;
    }>(`/api/flows/${id}/dispatch-broadcast`, {
      method: "POST",
      body: JSON.stringify({})
    });
    if (!r.ok) return r.error ?? "Falha ao disparar";
    return `${r.scheduled ?? 0} de ${r.total ?? 0} contato(s) na fila · ${r.skipped ?? 0} ignorado(s)`;
  }

  async function dispatchGroups(): Promise<string | null> {
    if (!id) return null;
    const r = await api<{
      ok: boolean;
      scheduled?: number;
      skipped?: number;
      total?: number;
      error?: string;
    }>(`/api/flows/${id}/dispatch-groups`, {
      method: "POST",
      body: JSON.stringify({})
    });
    if (!r.ok) return r.error ?? "Falha ao disparar grupos";
    return `${r.scheduled ?? 0} de ${r.total ?? 0} grupo(s) na fila · ${r.skipped ?? 0} ignorado(s)`;
  }

  async function save() {
    if (!id) return;
    const wasEnabled = enabledAtLoadRef.current;
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
    enabledAtLoadRef.current = enabled;
    setFlow((prev) => (prev ? { ...prev, name, enabled, graphJson } : prev));

    if (enabled && !wasEnabled && hasBroadcastTrigger()) {
      if (
        window.confirm(
          "Publicado! Deseja disparar este broadcast agora para TODOS os contatos?\n\nUse blocos de condição no fluxo (ex.: Contato tem tag?) para filtrar quem recebe mensagens."
        )
      ) {
        setStatus("Agendando broadcast…");
        const dispatchStatus = await dispatchBroadcast();
        setStatus(dispatchStatus ? `Salvo · ${dispatchStatus}` : "Salvo.");
        return;
      }
    }

    if (enabled && !wasEnabled && hasGroupsTrigger()) {
      if (
        window.confirm(
          "Publicado! Deseja disparar este fluxo agora para os grupos do gatilho?\n\n(A agenda por dia da semana continua valendo nos próximos horários.)"
        )
      ) {
        setStatus("Agendando grupos…");
        const dispatchStatus = await dispatchGroups();
        setStatus(dispatchStatus ? `Salvo · ${dispatchStatus}` : "Salvo.");
        return;
      }
    }

    setStatus("Salvo.");
  }

  async function runBroadcast() {
    if (!id || !enabled) {
      setStatus("Publique o fluxo antes de disparar o broadcast.");
      return;
    }
    if (
      !window.confirm(
        "Disparar para TODOS os contatos cadastrados? Os envios serão espaçados automaticamente. Filtros do fluxo (tags, ofertas, etc.) serão aplicados para cada contato."
      )
    ) {
      return;
    }
    setStatus("Agendando broadcast…");
    const result = await dispatchBroadcast();
    setStatus(result ?? "Broadcast agendado.");
  }

  async function runGroups() {
    if (!id || !enabled) {
      setStatus("Publique o fluxo antes de disparar para os grupos.");
      return;
    }
    if (
      !window.confirm(
        "Disparar agora para os grupos selecionados no gatilho? Os envios serão espaçados automaticamente."
      )
    ) {
      return;
    }
    setStatus("Agendando grupos…");
    const result = await dispatchGroups();
    setStatus(result ?? "Grupos agendados.");
  }

  async function testFlow() {
    if (!id || !testPhone) return;
    setStatus("Disparando teste…");
    const result = await api<{
      runId?: string;
      queued?: boolean;
      delayMs?: number;
      skipped?: boolean;
      reason?: string;
    }>(`/api/flows/${id}/test`, {
      method: "POST",
      body: JSON.stringify({ phone: testPhone })
    });
    if (result.skipped) {
      setStatus(
        result.reason === "disabled"
          ? "Fluxo desativado — clique em Publicar antes de testar."
          : `Teste ignorado: ${result.reason ?? "motivo desconhecido"}`
      );
      return;
    }
    if (result.queued && result.delayMs) {
      setStatus(`Teste na fila — disparo em ~${Math.ceil(result.delayMs / 1000)}s.`);
      return;
    }
    setStatus(result.runId ? `Teste executado (run ${result.runId.slice(0, 8)}…).` : "Teste executado.");
  }

  const cfg = (selectedNode?.data?.config ?? {}) as Record<string, unknown>;
  const panelOpen = Boolean(selectedNode);

  const filteredPalette = useMemo(() => {
    const q = paletteSearch.trim().toLowerCase();
    if (!q) return PALETTE_GROUPS;
    return PALETTE_GROUPS.map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          item.label.toLowerCase().includes(q) || item.type.toLowerCase().includes(q)
      )
    })).filter((group) => group.items.length > 0);
  }, [paletteSearch]);

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
        <button
          type="button"
          onClick={() => setEnabled((v) => !v)}
          className={`shrink-0 rounded-lg px-3 py-1.5 text-sm font-medium transition ${
            enabled
              ? "bg-emerald-500/10 text-emerald-300 border border-emerald-500/20"
              : "rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900"
          }`}
          title={enabled ? "Fluxo publicado e ativo" : "Publicar fluxo"}
        >
          {enabled ? "● Publicado" : "Publicar"}
        </button>
        {hasBroadcastTrigger() && (
          <button
            type="button"
            onClick={() => void runBroadcast()}
            disabled={!enabled}
            className="shrink-0 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-sm text-amber-200 hover:bg-amber-500/20 disabled:opacity-40"
            title={enabled ? "Disparar para todos os contatos" : "Publique o fluxo primeiro"}
          >
            Broadcast
          </button>
        )}
        {hasGroupsTrigger() && (
          <button
            type="button"
            onClick={() => void runGroups()}
            disabled={!enabled}
            className="shrink-0 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-1.5 text-sm text-sky-200 hover:bg-sky-500/20 disabled:opacity-40"
            title={enabled ? "Disparar agora para os grupos do gatilho" : "Publique o fluxo primeiro"}
          >
            Disparar grupos
          </button>
        )}
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
          <aside className="absolute left-3 top-3 bottom-3 z-20 w-[min(360px,42vw)] flex flex-col rounded-xl border border-zinc-800/90 bg-zinc-950/95 shadow-2xl backdrop-blur pointer-events-auto">
            <div className="border-b border-zinc-800 px-3 py-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-zinc-400">Blocos</span>
                <button
                  type="button"
                  onClick={() => setPaletteOpen(false)}
                  className="text-zinc-500 hover:text-zinc-300 text-xs"
                >
                  Ocultar
                </button>
              </div>
              <input
                value={paletteSearch}
                onChange={(e) => setPaletteSearch(e.target.value)}
                placeholder="Buscar blocos…"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs"
              />
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-3">
              {filteredPalette.length === 0 && (
                <p className="px-2 text-xs text-zinc-500">Nenhum bloco encontrado.</p>
              )}
              {filteredPalette.map((group) => (
                <div key={group.id}>
                  <div className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
                    {group.label}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {group.items.map((p) => (
                      <div
                        key={p.type}
                        draggable
                        onDragStart={(e) => onPaletteDragStart(e, p.type)}
                        className="cursor-grab active:cursor-grabbing rounded-lg border border-zinc-800 px-2 py-2 text-xs text-zinc-200 hover:bg-zinc-900 hover:border-emerald-500/30 select-none"
                        role="button"
                        tabIndex={0}
                      >
                        {p.label}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="px-2 pb-2 text-[10px] text-zinc-600 leading-relaxed">
              Arraste para o canvas · clique direito no bloco para duplicar · Delete na conexão
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
            onDuplicate={() => duplicateNode(contextMenu.nodeId)}
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
