import { Queue } from "bullmq";
import { startFlowRun } from "../engine/executor.js";
import { getRedisConnection } from "../queue.js";
import type { FlowStartRunJobPayload } from "../types/flow.js";

/** Jobs aguardando além desse tempo são retomados pelo scheduler (worker offline). */
const OVERDUE_MS = 120_000;

/**
 * Retoma inícios de fluxo presos na fila BullMQ quando nenhum worker consumiu a tempo.
 * Compra Hotmart, tag e teste passam por zap-flow-starts — sem worker, ficam parados aqui.
 */
export async function recoverOverdueFlowStarts(): Promise<number> {
  const queue = new Queue<FlowStartRunJobPayload>("zap-flow-starts", {
    connection: getRedisConnection()
  });

  let processed = 0;
  const now = Date.now();

  try {
    const jobs = [
      ...(await queue.getDelayed(0, 200)),
      ...(await queue.getWaiting(0, 200))
    ];

    for (const job of jobs) {
      const delay = job.opts.delay ?? 0;
      const runAt = (job.timestamp ?? 0) + delay;
      if (runAt > now - OVERDUE_MS) continue;

      const state = await job.getState();
      if (state !== "delayed" && state !== "waiting") continue;

      const { flowId, contactPhone, externalId } = job.data;
      console.log(
        `[flow-start-recovery] Retomando job ${job.id} flow=${flowId} phone=${contactPhone} external=${externalId ?? "-"}`
      );

      try {
        await job.remove();
        const result = await startFlowRun(job.data);
        if (result && "skipped" in result && result.skipped) {
          console.warn(`[flow-start-recovery] Ignorado: ${result.reason ?? "desconhecido"}`);
        } else if (result && "runId" in result) {
          console.log(`[flow-start-recovery] Execução ${result.runId} iniciada`);
        }
        processed++;
      } catch (err) {
        console.error(`[flow-start-recovery] Falha job ${job.id}:`, err);
      }
    }
  } finally {
    await queue.close();
  }

  return processed;
}
