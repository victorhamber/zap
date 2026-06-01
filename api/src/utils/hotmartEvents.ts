import { getByPath, asString } from "./jsonPathLite.js";

export type HotmartTriggerKind = "trigger_hotmart" | "trigger_hotmart_pending";

const APPROVED_EVENTS = new Set([
  "PURCHASE_APPROVED",
  "PURCHASE_COMPLETE",
  "PURCHASE_FINISHED"
]);

const PENDING_EVENTS = new Set([
  "PURCHASE_BILLET_PRINTED",
  "PURCHASE_WAITING_PAYMENT",
  "PURCHASE_DELAYED",
  "PURCHASE_PRINTED_BILLET"
]);

const PENDING_STATUSES = new Set([
  "BILLET_PRINTED",
  "WAITING_PAYMENT",
  "PRINTED_BILLET",
  "STARTED",
  "DELAYED"
]);

export function hotmartEventName(payload: unknown): string {
  return (
    asString(getByPath(payload, "$.event")) ??
    asString(getByPath(payload, "$.data.event")) ??
    ""
  ).trim().toUpperCase();
}

export function hotmartPurchaseStatus(payload: unknown): string {
  return asString(getByPath(payload, "$.data.purchase.status"))?.trim().toUpperCase() ?? "";
}

export function isHotmartPendingPayment(payload: unknown): boolean {
  const event = hotmartEventName(payload);
  const status = hotmartPurchaseStatus(payload);

  if (PENDING_EVENTS.has(event)) return true;
  if (PENDING_STATUSES.has(status)) return true;

  const paymentType = (
    asString(getByPath(payload, "$.data.purchase.payment.type")) ?? ""
  ).toUpperCase();
  if (event.includes("BILLET") && (paymentType === "PIX" || paymentType === "BILLET")) {
    return true;
  }

  return false;
}

export function isHotmartApprovedPurchase(payload: unknown): boolean {
  const event = hotmartEventName(payload);
  const status = hotmartPurchaseStatus(payload);

  if (isHotmartPendingPayment(payload)) return false;
  if (APPROVED_EVENTS.has(event)) return true;
  if (status === "APPROVED" || status === "COMPLETE" || status === "COMPLETED") return true;

  return false;
}

export function matchHotmartTrigger(payload: unknown, triggerType: HotmartTriggerKind): boolean {
  if (triggerType === "trigger_hotmart_pending") {
    return isHotmartPendingPayment(payload);
  }
  return isHotmartApprovedPurchase(payload);
}
