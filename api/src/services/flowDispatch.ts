import { startFlowRun } from "../engine/executor.js";
import { defaultWhatsAppSession } from "../env.js";
import { enqueueFlowRunStart, sanitizeQueueJobId } from "../queue.js";
import type { FlowStartRunJobPayload } from "../types/flow.js";
import { getGlobalDispatchStaggerConfig, reserveStaggeredStartDelay } from "./flowStagger.js";

export type QueueFlowRunResult =
  | Awaited<ReturnType<typeof startFlowRun>>
  | { queued: true; delayMs: number };

/**
 * Enfileira o início de um fluxo com cadência global humanizada (anti-spam).
 * Usado por Hotmart, tag, inbox, inbound e subfluxos.
 */
export async function queueFlowRunStart(
  params: FlowStartRunJobPayload
): Promise<QueueFlowRunResult> {
  const stagger = getGlobalDispatchStaggerConfig();
  if (!stagger.enabled) {
    return startFlowRun(params);
  }

  const session = defaultWhatsAppSession();
  const delayMs = await reserveStaggeredStartDelay(session, stagger.minSec, stagger.maxSec);

  if (delayMs <= 0) {
    console.log(
      `[flow-dispatch] Início imediato flow=${params.flowId} phone=${params.contactPhone} trigger=${params.triggerType}`
    );
    return startFlowRun(params);
  }

  const jobId = sanitizeQueueJobId(
    `start_${params.flowId}_${params.contactPhone}_${Date.now()}`
  );
  await enqueueFlowRunStart(params, delayMs, jobId);
  console.log(
    `[flow-dispatch] Enfileirado flow=${params.flowId} phone=${params.contactPhone} delay=${delayMs}ms job=${jobId}`
  );
  return { queued: true, delayMs };
}
