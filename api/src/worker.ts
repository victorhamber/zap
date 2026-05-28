import { Worker } from "bullmq";
import { getRedisConnection } from "./queue.js";
import { continueFlowRun } from "./engine/executor.js";
import type { FlowJobPayload } from "./types/flow.js";
import { prisma } from "./prisma.js";

const worker = new Worker<FlowJobPayload>(
  "zap-flow-jobs",
  async (job) => {
    const { flowRunId, nodeId } = job.data;
    await continueFlowRun(flowRunId, nodeId);
    if (prisma) {
      await prisma.scheduledJob.updateMany({
        where: { flowRunId, nodeId, status: "pending" },
        data: { status: "done" }
      });
    }
  },
  { connection: getRedisConnection(), concurrency: 5 }
);

worker.on("failed", (job, err) => {
  console.error("Job falhou", job?.id, err);
});

console.log("Zap worker iniciado (fila zap-flow-jobs)");
