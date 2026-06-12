import { Worker } from "bullmq";
import { getRedisConnection } from "../queue.js";
import { startFlowRun } from "../engine/executor.js";
import type { FlowStartRunJobPayload } from "../types/flow.js";

let worker: Worker<FlowStartRunJobPayload> | null = null;

/** Processa a fila zap-flow-starts (inícios de fluxo com cadência). */
export function startFlowStartWorker(): void {
  if (worker) return;

  worker = new Worker<FlowStartRunJobPayload>(
    "zap-flow-starts",
    async (job) => {
      const { flowId, contactPhone } = job.data;
      console.log(
        `[flow-start] Iniciando fluxo ${flowId} → ${contactPhone} (job ${job.id}, atraso ${job.delay ?? 0}ms)`
      );
      const result = await startFlowRun(job.data);
      if (result && "skipped" in result && result.skipped) {
        console.warn(`[flow-start] Ignorado: ${result.reason ?? "desconhecido"}`);
      } else if (result && "runId" in result) {
        console.log(`[flow-start] Execução ${result.runId} iniciada`);
      }
    },
    { connection: getRedisConnection(), concurrency: 2 }
  );

  worker.on("failed", (job, err) => {
    console.error(`[flow-start] Job falhou ${job?.id}:`, err);
  });

  console.log("[flow-start] Worker ativo (fila zap-flow-starts)");
}
