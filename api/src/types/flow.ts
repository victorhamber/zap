export type NodeType =
  | "trigger_hotmart"
  | "trigger_hotmart_pending"
  | "trigger_tag"
  | "trigger_broadcast"
  | "trigger_inbound"
  | "trigger_manual"
  | "condition_offer_code"
  | "condition_contact_tag"
  | "tag_action"
  | "start_flow"
  | "delay"
  | "schedule_at"
  | "send_text"
  | "send_image"
  | "send_video"
  | "send_audio";

export type FlowEdge = {
  id: string;
  source: string;
  target: string;
  /** Saída do nó (ex.: id da branch ou "default" para outros códigos). */
  sourceHandle?: string;
};

export type FlowNode = {
  id: string;
  type: NodeType;
  position: { x: number; y: number };
  data: Record<string, unknown>;
};

export type FlowGraph = {
  schemaVersion: 1;
  nodes: FlowNode[];
  edges: FlowEdge[];
};

export type HotmartMapping = {
  phonePath: string;
  namePath: string;
  emailPath?: string;
  productNamePath?: string;
  purchaseIdPath: string;
  offerCodePath?: string;
  loginPath?: string;
  passwordPath?: string;
  accessLinkPath?: string;
};

export type OfferCodeBranch = {
  id: string;
  label: string;
  codes: string[];
};

export type ConditionOfferCodeData = {
  branches: OfferCodeBranch[];
};

export type ConditionContactTagData = {
  /** Se o contato tem alguma dessas tags (padrão) ou todas */
  matchMode?: "any" | "all";
  tagNames: string[];
};

export type TagActionData = {
  mode: "add" | "remove";
  tagNames: string[];
};

export type StartFlowData = {
  targetFlowId: string;
  targetFlowName?: string;
};

export type DelayUnit = "minutes" | "hours" | "days";

export type DelayNodeData = {
  value: number;
  unit: DelayUnit;
};

export type ScheduleAtNodeData = {
  datetime: string;
};

export type SendTextNodeData = {
  text: string;
};

export type SendMediaNodeData = {
  url: string;
  caption?: string;
};

export type TriggerHotmartData = {
  mapping: HotmartMapping;
};

export type TriggerHotmartPendingData = {
  mapping: HotmartMapping;
};

export type TriggerInboundData = {
  keyword?: string;
  /** Nomes das tags do contato (qualquer uma dispara o fluxo) */
  tags?: string[];
};

export type TriggerTagData = {
  /** Dispara quando o contato recebe uma dessas tags */
  tags: string[];
};

/** Disparo em massa manual — sem filtro no gatilho; use condições no fluxo. */
export type TriggerBroadcastData = Record<string, never>;

export type FlowJobPayload = {
  flowRunId: string;
  nodeId: string;
};

export type FlowStartRunJobPayload = {
  flowId: string;
  triggerType: string;
  contactPhone: string;
  variables: Record<string, unknown>;
  externalId?: string;
  manualStart?: boolean;
};
