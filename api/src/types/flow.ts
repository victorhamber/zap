export type NodeType =
  | "trigger_hotmart"
  | "trigger_inbound"
  | "trigger_manual"
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
  loginPath?: string;
  passwordPath?: string;
  accessLinkPath?: string;
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

export type TriggerInboundData = {
  keyword?: string;
};

export type FlowJobPayload = {
  flowRunId: string;
  nodeId: string;
};
