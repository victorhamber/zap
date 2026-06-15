import { Worker } from "bullmq";
import { getRedisConnection, getAiQueueCounts } from "./queue.js";
import { continueFlowRun } from "./engine/executor.js";
import type { FlowJobPayload } from "./types/flow.js";
import type { AiLearnJobPayload, AiReplyJobPayload } from "./types/ai.js";
import { prisma } from "./prisma.js";
import { flags } from "./env.js";
import { startFlowScheduler } from "./services/flowScheduler.js";
import { startFlowStartWorker } from "./services/flowStartWorker.js";
import { processLearnJob } from "./services/ai/learning.js";
import { processReplyJob } from "./services/ai/replyService.js";

async function main() {
  console.log("=== zap-worker (processador de filas) ===");
  console.log(`[worker] NODE_ENV=${process.env.NODE_ENV ?? "development"}`);
  console.log(`[worker] REDIS_URL=${flags.hasRedis ? "ok" : "AUSENTE"}`);
  console.log(`[worker] DATABASE_URL=${flags.hasDatabase ? "ok" : "AUSENTE"}`);

  if (!flags.hasRedis) {
    console.error("[worker] REDIS_URL obrigatório — filas IA e fluxos não processam.");
    process.exit(1);
  }

  if (prisma) {
    await prisma.$connect();
    console.log("[worker] Postgres conectado");
  } else {
    console.warn("[worker] AVISO: sem DATABASE_URL — jobs de IA podem falhar");
  }

  try {
    const q = await getAiQueueCounts();
    console.log(`[worker] Fila zap-ai-jobs: ${q.pending} pendente(s), ${q.active} ativo(s)`);
  } catch (err) {
    console.error("[worker] Falha ao ler fila zap-ai-jobs:", err);
  }

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
    console.error("[worker] flow job falhou", job?.id, err);
  });

  let aiJobsDone = 0;
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
    console.error("[worker] AI job falhou", job?.name, job?.id, err);
  });

  aiWorker.on("completed", (job) => {
    aiJobsDone++;
    if (aiJobsDone <= 3 || aiJobsDone % 50 === 0) {
      console.log(`[worker] AI job concluído (${job.name}) — total ${aiJobsDone}`);
    }
  });

  startFlowStartWorker();
  startFlowScheduler();
  console.log("[worker] Zap worker ativo: zap-flow-jobs + zap-flow-starts + zap-ai-jobs");
}

main().catch((err) => {
  console.error("[worker] Falha fatal na inicialização:", err);
  process.exit(1);
});
