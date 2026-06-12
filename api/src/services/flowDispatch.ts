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
  const jobId = sanitizeQueueJobId(
    `start_${params.flowId}_${params.contactPhone}_${Date.now()}`
  );
  await enqueueFlowRunStart(params, delayMs, jobId);
  return { queued: true, delayMs };
}
