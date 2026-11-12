export type NodeType =
  | "trigger_hotmart"
  | "trigger_hotmart_pending"
  | "trigger_custom_webhook"
  | "trigger_wa_link"
  | "trigger_tag"
  | "trigger_broadcast"
  | "trigger_inbound"
  | "trigger_manual"
  | "trigger_groups"
  | "condition_offer_code"
  | "condition_contact_tag"
  | "condition_contact_replied"
  | "condition_weekday"
  | "wait_weekday"
  | "split_round_robin"
  | "tag_action"
  | "start_flow"
  | "delay"
  | "schedule_at"
  | "send_text"
  | "send_image"
  | "send_video"
  | "send_message"
  | "send_audio"
  | "send_groups"
  | "send_email";

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

/** Mapeamento genérico: JSONPath do payload → campos do Zap. */
export type CustomWebhookMapping = {
  phonePath: string;
  namePath: string;
  emailPath?: string;
  /** Opcional — dedup de execuções (ex.: id do pedido). */
  externalIdPath?: string;
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

/** Contato enviou mensagem inbound (respondeu) no inbox. */
export type ConditionContactRepliedData = {
  /** Se true (padrão), só conta respostas após o início desta execução do fluxo */
  sinceFlowStart?: boolean;
  /** Janela extra em dias (0 = sem limite além de sinceFlowStart) */
  withinDays?: number;
};

/**
 * Gatilho de grupos: só define os destinos.
 * As mensagens seguintes (send_*) vão para esses grupos.
 * Dias/horários ficam em nós de fluxo (wait_weekday / condition_weekday).
 */
export type TriggerGroupsData = {
  groupIds: string[];
  groupLabels?: Record<string, string>;
};

/** Roteia por dia da semana (handles: "0"…"6" = dom…sáb). */
export type ConditionWeekdayData = {
  /** Timezone IANA — padrão America/Sao_Paulo. */
  timezone?: string;
};

/**
 * Aguarda até o próximo dia da semana + horário (Brasília), depois segue o fluxo.
 * Ex.: Segunda 08:00 → mensagens da manhã → delay → tarde…
 */
export type WaitWeekdayData = {
  /** Date.getDay(): 0=domingo … 6=sábado */
  weekday: number;
  /** HH:mm em America/Sao_Paulo */
  time?: string;
};

/** Divide o fluxo em N ramos iguais — cada execução segue o próximo ramo (round robin). */
export type SplitRoundRobinData = {
  branchCount: 2 | 3 | 4;
  /** Nome de cada saída (apenas visual / log) */
  labels?: string[];
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

export type SendMessagePart = {
  kind: "text" | "image" | "video";
  text?: string;
  url?: string;
  filename?: string;
};

export type SendMessageNodeData = {
  parts: SendMessagePart[];
};

export type SendMediaNodeData = {
  url: string;
  caption?: string;
};

/** Envia a mesma mensagem para N grupos, com intervalo humanizado entre cada um. */
export type SendGroupsNodeData = {
  mediaType: "text" | "image" | "video" | "audio";
  text?: string;
  url?: string;
  caption?: string;
  groupIds: string[];
  /** Nome exibido no editor (JID → subject). */
  groupLabels?: Record<string, string>;
  /** Intervalo mínimo entre grupos (segundos). Default 20. */
  staggerMinSec?: number;
  /** Intervalo máximo entre grupos (segundos). Default 45. */
  staggerMaxSec?: number;
};

export type SendEmailNodeData = {
  /** Destinatário Mustache — default `{{email}}`. */
  to: string;
  subject: string;
  /** HTML do corpo (blocos do editor). */
  html: string;
  /** Linha invisível que a caixa mostra depois do assunto. */
  preheader?: string;
  replyTo?: string;
};

export type TriggerHotmartData = {
  mapping: HotmartMapping;
};

export type TriggerHotmartPendingData = {
  mapping: HotmartMapping;
};

export type TriggerCustomWebhookData = {
  mapping: CustomWebhookMapping;
  /** Se definido, exige header x-webhook-secret ou ?secret= */
  secret?: string;
};

export type TriggerInboundData = {
  keyword?: string;
  /** Nomes das tags do contato (qualquer uma dispara o fluxo) */
  tags?: string[];
};

/**
 * Link wa.me com mensagem pronta (redes sociais / campanhas).
 * Quando o contato envia essa mensagem, aplica as tags e dispara o fluxo.
 */
export type TriggerWaLinkData = {
  /** Texto pré-preenchido no WhatsApp (obrigatório para gerar o link). */
  message: string;
  /** Tags aplicadas ao contato ao chegar por este link (ex.: Instagram, Stories). */
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
