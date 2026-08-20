export const NODE_LABELS: Record<string, string> = {
  trigger_hotmart: "Hotmart",
  trigger_hotmart_pending: "Aguardando pagamento",
  trigger_custom_webhook: "Webhook personalizado",
  trigger_wa_link: "Link WhatsApp",
  trigger_tag: "Gatilho tag",
  trigger_broadcast: "Broadcast",
  trigger_inbound: "Msg recebida",
  trigger_manual: "Manual",
  trigger_groups: "Grupos",
  condition_offer_code: "Código da oferta",
  condition_contact_tag: "Contato tem tag?",
  condition_contact_replied: "Contato respondeu?",
  condition_weekday: "Dia da semana",
  wait_weekday: "Aguardar dia",
  split_round_robin: "Dividir rotativo",
  tag_action: "Tag",
  start_flow: "Iniciar fluxo",
  delay: "Aguardar",
  schedule_at: "Data/hora",
  send_text: "Texto",
  send_image: "Imagem",
  send_video: "Vídeo",
  send_audio: "Áudio",
  send_groups: "Grupos (envio)",
  send_email: "E-mail"
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
      { type: "trigger_hotmart", label: "Hotmart (compra aprovada)" },
      { type: "trigger_hotmart_pending", label: "Hotmart (aguardando pagamento)" },
      { type: "trigger_custom_webhook", label: "Webhook personalizado" },
      { type: "trigger_wa_link", label: "Link WhatsApp (mensagem pronta)" },
      { type: "trigger_tag", label: "Tag do contato" },
      { type: "trigger_broadcast", label: "Broadcast (todos)" },
      { type: "trigger_groups", label: "Grupos (selecionar destinos)" },
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
      { type: "send_audio", label: "Enviar áudio" },
      { type: "send_groups", label: "Enviar para grupos (avulso)" },
      { type: "send_email", label: "Enviar e-mail" }
    ]
  },
  {
    id: "logic",
    label: "Lógica e fluxo",
    items: [
      { type: "condition_offer_code", label: "Código da oferta" },
      { type: "condition_contact_tag", label: "Contato tem tag?" },
      { type: "condition_contact_replied", label: "Contato respondeu?" },
      { type: "wait_weekday", label: "Aguardar dia (Seg…Dom)" },
      { type: "split_round_robin", label: "Dividir rotativo (A/B/C)" },
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

export function customWebhookUrl(flowId: string): string {
  const origin = window.location.origin.replace(/\/$/, "");
  return `${origin}/api/webhooks/custom/${flowId}`;
}

/** Link wa.me com mensagem pré-preenchida para o número conectado. */
export function buildWaMeLink(ownerDigits: string, message: string): string {
  const digits = ownerDigits.replace(/\D/g, "");
  if (!digits) return "";
  const text = message.trim();
  const q = text ? `?text=${encodeURIComponent(text)}` : "";
  return `https://wa.me/${digits}${q}`;
}

export function defaultNodeData(type: string): Record<string, unknown> {
  switch (type) {
    case "trigger_hotmart":
    case "trigger_hotmart_pending":
      return {
        mapping: {
          phonePath: "$.data.buyer.checkout_phone",
          namePath: "$.data.buyer.name",
          emailPath: "$.data.buyer.email",
          productNamePath: "$.data.product.name",
          purchaseIdPath: "$.data.purchase.transaction"
        }
      };
    case "trigger_custom_webhook":
      // Genérico: qualquer origem POST JSON. Segredo opcional.
      return {
        secret: "",
        mapping: {
          phonePath: "",
          namePath: "",
          emailPath: "",
          externalIdPath: ""
        }
      };
    case "trigger_wa_link":
      return {
        message: "Olá! Vim pelo Instagram e quero saber mais.",
        tags: [] as string[]
      };
    case "condition_contact_tag":
      return { matchMode: "any", tagNames: [] as string[] };
    case "condition_contact_replied":
      return { sinceFlowStart: true, withinDays: 0 };
    case "split_round_robin":
      return { branchCount: 2, labels: ["Mensagem 1", "Mensagem 2"] };
    case "trigger_tag":
      return { tags: [] as string[] };
    case "trigger_broadcast":
      return {};
    case "trigger_groups":
      return {
        groupIds: [] as string[],
        groupLabels: {}
      };
    case "condition_weekday":
      return { timezone: "America/Sao_Paulo" };
    case "wait_weekday":
      return { weekday: 1, time: "09:00" };
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
    case "send_groups":
      return {
        mediaType: "text",
        text: "Olá, grupo!",
        url: "https://",
        caption: "",
        groupIds: [] as string[],
        groupLabels: {},
        staggerMinSec: 20,
        staggerMaxSec: 45
      };
    case "send_email":
      return {
        to: "{{email}}",
        subject: "Olá {{name}}!",
        html: "<p>Olá <strong>{{name}}</strong>,</p><p>Sua mensagem aqui.</p>",
        replyTo: ""
      };
    default:
      return {};
  }
}
