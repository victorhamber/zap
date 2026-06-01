/** Variáveis Mustache disponíveis nos blocos de mensagem (conforme executor / Hotmart). */
export type FlowTemplateVariable = {
  key: string;
  label: string;
  example?: string;
};

export const FLOW_TEMPLATE_VARIABLES: FlowTemplateVariable[] = [
  { key: "name", label: "Primeiro nome do comprador", example: "Fabio" },
  { key: "fullName", label: "Nome completo", example: "Fabio da Silva Moraes" },
  { key: "phone", label: "Telefone WhatsApp (só dígitos)", example: "5562999694033" },
  { key: "email", label: "E-mail do comprador" },
  { key: "productName", label: "Nome do produto" },
  { key: "purchaseId", label: "ID da transação Hotmart" },
  { key: "offerCode", label: "Código da oferta" },
  { key: "offerName", label: "Nome da oferta" },
  { key: "login", label: "Login da área de membros (se vier no webhook)" },
  { key: "password", label: "Senha de acesso (se vier no webhook)" },
  { key: "accessLink", label: "Link de acesso ao conteúdo" },
  { key: "pixCode", label: "Código copia e cola do PIX" },
  { key: "pixQrCode", label: "URL do QR Code PIX" },
  { key: "paymentType", label: "Tipo de pagamento (ex.: PIX, BILLET)" },
  { key: "purchaseStatus", label: "Status da compra na Hotmart" },
  { key: "hotmartEvent", label: "Evento do webhook Hotmart" },
  { key: "countryIso", label: "País (ISO, ex.: BR)" }
];

export function mustacheSnippet(key: string): string {
  return `{{${key}}}`;
}
