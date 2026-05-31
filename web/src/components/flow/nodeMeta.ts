export const NODE_LABELS: Record<string, string> = {
  trigger_hotmart: "Hotmart",
  trigger_tag: "Gatilho tag",
  trigger_inbound: "Msg recebida",
  trigger_manual: "Manual",
  condition_offer_code: "Código da oferta",
  tag_action: "Tag",
  start_flow: "Iniciar fluxo",
  delay: "Aguardar",
  schedule_at: "Data/hora",
  send_text: "Texto",
  send_image: "Imagem",
  send_video: "Vídeo",
  send_audio: "Áudio"
};

export type PaletteItem = { type: string; label: string };

export type PaletteGroup = {
  id: string;
  label: string;
  items: PaletteItem[];
};

export const PALETTE_GROUPS: PaletteGroup[] = [
  {
    id: "triggers",
    label: "Gatilhos",
    items: [
      { type: "trigger_hotmart", label: "Hotmart (compra)" },
      { type: "trigger_tag", label: "Tag do contato" },
      { type: "trigger_inbound", label: "Mensagem recebida" },
      { type: "trigger_manual", label: "Teste manual" }
    ]
  },
  {
    id: "messages",
    label: "Mensagens",
    items: [
      { type: "send_text", label: "Enviar texto" },
      { type: "send_image", label: "Enviar imagem" },
      { type: "send_video", label: "Enviar vídeo" },
      { type: "send_audio", label: "Enviar áudio" }
    ]
  },
  {
    id: "logic",
    label: "Lógica e fluxo",
    items: [
      { type: "condition_offer_code", label: "Código da oferta" },
      { type: "start_flow", label: "Iniciar outro fluxo" },
      { type: "delay", label: "Aguardar tempo" },
      { type: "schedule_at", label: "Agendar data" }
    ]
  },
  {
    id: "contacts",
    label: "Contato",
    items: [{ type: "tag_action", label: "Adicionar / remover tag" }]
  }
];

/** Lista plana (compatibilidade). */
export const PALETTE = PALETTE_GROUPS.flatMap((g) => g.items);

const DRAG_NODE_TYPE = "application/zap-flow-node";

export function paletteDragType(): string {
  return DRAG_NODE_TYPE;
}

export function hotmartWebhookUrl(flowId: string): string {
  const origin = window.location.origin.replace(/\/$/, "");
  return `${origin}/api/webhooks/hotmart/${flowId}`;
}

export function defaultNodeData(type: string): Record<string, unknown> {
  switch (type) {
    case "trigger_hotmart":
      return {
        mapping: {
          phonePath: "$.data.buyer.checkout_phone",
          namePath: "$.data.buyer.name",
          emailPath: "$.data.buyer.email",
          productNamePath: "$.data.product.name",
          purchaseIdPath: "$.data.purchase.transaction"
        }
      };
    case "trigger_tag":
      return { tags: [] as string[] };
    case "trigger_inbound":
      return { keyword: "", tags: [] as string[] };
    case "condition_offer_code":
      return {
        branches: [
          {
            id: `branch_${Date.now()}`,
            label: "Oferta 1",
            codes: [] as string[]
          }
        ]
      };
    case "tag_action":
      return { mode: "add", tagNames: [] as string[] };
    case "start_flow":
      return { targetFlowId: "", targetFlowName: "" };
    case "delay":
      return { value: 2, unit: "days" };
    case "schedule_at":
      return { datetime: new Date(Date.now() + 86400000).toISOString().slice(0, 16) };
    case "send_text":
      return { text: "Olá {{name}}!" };
    case "send_image":
    case "send_video":
    case "send_audio":
      return { url: "https://", caption: "" };
    default:
      return {};
  }
}
