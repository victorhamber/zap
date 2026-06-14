import { Worker } from "bullmq";
import { getRedisConnection } from "./queue.js";
import { continueFlowRun } from "./engine/executor.js";
import type { FlowJobPayload } from "./types/flow.js";
import type { AiLearnJobPayload, AiReplyJobPayload } from "./types/ai.js";
import { prisma } from "./prisma.js";
import { startFlowScheduler } from "./services/flowScheduler.js";
import { startFlowStartWorker } from "./services/flowStartWorker.js";
import { processLearnJob } from "./services/ai/learning.js";
import { processReplyJob } from "./services/ai/replyService.js";

const flowWorker = new Worker<FlowJobPayload>(
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

flowWorker.on("failed", (job, err) => {
  console.error("Job falhou", job?.id, err);
});

const aiWorker = new Worker<AiLearnJobPayload | AiReplyJobPayload>(
  "zap-ai-jobs",
  async (job) => {
    if (job.name === "learn") {
      await processLearnJob(job.data as AiLearnJobPayload);
    } else if (job.name === "reply") {
      await processReplyJob(job.data as AiReplyJobPayload);
    }
  },
  { connection: getRedisConnection(), concurrency: 3 }
);

aiWorker.on("failed", (job, err) => {
  console.error("AI job falhou", job?.id, err);
});

startFlowStartWorker();
startFlowScheduler();
console.log("Zap worker iniciado (zap-flow-jobs + zap-flow-starts + zap-ai-jobs)");
