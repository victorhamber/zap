import type { FlowGraph, FlowNode, NodeType } from "../types/flow.js";

export function parseGraph(graphJson: unknown): FlowGraph {
  const g = graphJson as FlowGraph;
  if (!g?.nodes || !g?.edges) {
    throw new Error("graphJson inválido");
  }
  return g;
}

export function findTriggerNode(graph: FlowGraph, triggerType: NodeType): FlowNode | undefined {
  return graph.nodes.find((n) => n.type === triggerType);
}

const FLOW_TRIGGER_TYPES: NodeType[] = [
  "trigger_hotmart",
  "trigger_hotmart_pending",
  "trigger_custom_webhook",
  "trigger_broadcast",
  "trigger_tag",
  "trigger_inbound",
  "trigger_manual"
];

/** Primeiro gatilho do fluxo (para início manual pelo inbox). */
export function findFlowTriggerNode(graph: FlowGraph): FlowNode | undefined {
  for (const type of FLOW_TRIGGER_TYPES) {
    const node = graph.nodes.find((n) => n.type === type);
    if (node) return node;
  }
  return undefined;
}

export function getFirstActionAfterTrigger(graph: FlowGraph): string | null {
  const trigger = findFlowTriggerNode(graph);
  if (!trigger) return null;
  return getNextNodeId(graph, trigger.id);
}

export function getNextNodeId(graph: FlowGraph, currentNodeId: string): string | null {
  const outgoing = graph.edges.filter((e) => e.source === currentNodeId);
  if (outgoing.length === 0) return null;
  const linear = outgoing.find((e) => !e.sourceHandle);
  if (linear) return linear.target;
  if (outgoing.length === 1) return outgoing[0].target;
  return null;
}

export function getNextNodeIdByHandle(
  graph: FlowGraph,
  currentNodeId: string,
  handleId: string
): string | null {
  const edge = graph.edges.find(
    (e) => e.source === currentNodeId && (e.sourceHandle ?? "default") === handleId
  );
  return edge?.target ?? null;
}

export function getNode(graph: FlowGraph, nodeId: string): FlowNode | undefined {
  return graph.nodes.find((n) => n.id === nodeId);
}

export function defaultHotmartGraph(): FlowGraph {
  return {
    schemaVersion: 1,
    nodes: [
      {
        id: "t1",
        type: "trigger_hotmart",
        position: { x: 0, y: 0 },
        data: {
          mapping: {
            phonePath: "$.data.buyer.checkout_phone",
            namePath: "$.data.buyer.name",
            emailPath: "$.data.buyer.email",
            productNamePath: "$.data.product.name",
            purchaseIdPath: "$.data.purchase.transaction",
            loginPath: "$.data.access.login",
            passwordPath: "$.data.access.password",
            accessLinkPath: "$.data.access.link"
          }
        }
      },
      {
        id: "s1",
        type: "send_text",
        position: { x: 250, y: 0 },
        data: {
          text: "Olá {{name}}! Bem-vindo(a).\n\nLogin: {{login}}\nSenha: {{password}}\nLink: {{accessLink}}"
        }
      },
      {
        id: "d1",
        type: "delay",
        position: { x: 500, y: 0 },
        data: { value: 2, unit: "days" }
      },
      {
        id: "s2",
        type: "send_text",
        position: { x: 750, y: 0 },
        data: {
          text: "Oi {{name}}, conseguiu acessar o conteúdo? Se teve dificuldade, me avise."
        }
      }
    ],
    edges: [
      { id: "e1", source: "t1", target: "s1" },
      { id: "e2", source: "s1", target: "d1" },
      { id: "e3", source: "d1", target: "s2" }
    ]
  };
}
