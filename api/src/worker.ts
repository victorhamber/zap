import { Worker } from "bullmq";
import { getRedisConnection } from "./queue.js";
import { continueFlowRun, startFlowRun } from "./engine/executor.js";
import type { FlowJobPayload, FlowStartRunJobPayload } from "./types/flow.js";
import { prisma } from "./prisma.js";
import { startFlowScheduler } from "./services/flowScheduler.js";

const worker = new Worker<FlowJobPayload>(
  "zap-flow-jobs",
  async (job) => {
    const { flowRunId, nodeId } = job.data;
    await continueFlowRun(flowRunId, nodeId);
    if (prisma) {
      await prisma.scheduledJob.updateMany({
        where: { flowRunId, nodeId, status: { in: ["pending", "processing"] } },
        data: { status: "done" }
      });
    }
  },
  { connection: getRedisConnection(), concurrency: 5 }
);

const startWorker = new Worker<FlowStartRunJobPayload>(
  "zap-flow-starts",
  async (job) => {
    await startFlowRun(job.data);
  },
  { connection: getRedisConnection(), concurrency: 2 }
);

worker.on("failed", (job, err) => {
  console.error("Job falhou", job?.id, err);
});

startWorker.on("failed", (job, err) => {
  console.error("Start-run falhou", job?.id, err);
});

startFlowScheduler();
console.log("Zap worker iniciado (fila zap-flow-jobs)");
