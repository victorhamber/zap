export const NODE_LABELS: Record<string, string> = {
  trigger_hotmart: "Hotmart",
  trigger_inbound: "Msg recebida",
  trigger_manual: "Manual",
  delay: "Aguardar",
  schedule_at: "Data/hora",
  send_text: "Texto",
  send_image: "Imagem",
  send_video: "Vídeo",
  send_audio: "Áudio"
};

export const PALETTE = [
  { type: "trigger_hotmart", label: "Gatilho Hotmart" },
  { type: "trigger_inbound", label: "Mensagem recebida" },
  { type: "trigger_manual", label: "Teste manual" },
  { type: "delay", label: "Aguardar tempo" },
  { type: "schedule_at", label: "Agendar data" },
  { type: "send_text", label: "Enviar texto" },
  { type: "send_image", label: "Enviar imagem" },
  { type: "send_video", label: "Enviar vídeo" },
  { type: "send_audio", label: "Enviar áudio" }
];

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
          phonePath: "$.data.buyer.phone",
          namePath: "$.data.buyer.name",
          purchaseIdPath: "$.data.purchase.id"
        }
      };
    case "trigger_inbound":
      return { keyword: "", tags: [] as string[] };
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
