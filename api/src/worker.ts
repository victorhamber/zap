import { Worker } from "bullmq";
import { getRedisConnection, getAiQueueCounts } from "./queue.js";
import { continueFlowRun } from "./engine/executor.js";
import type { FlowJobPayload } from "./types/flow.js";
import type { AiLearnJobPayload, AiReplyJobPayload } from "./types/ai.js";
import { prisma } from "./prisma.js";
import { flags, env } from "./env.js";
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
    {
      connection: getRedisConnection(),
      concurrency: env.AI_WORKER_CONCURRENCY,
      limiter: {
        max: env.AI_OPENAI_RPM_LIMIT,
        duration: 60_000
      }
    }
  );

  aiWorker.on("failed", (job, err) => {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("429") || msg.includes("Rate limit")) {
      console.warn("[worker] AI rate limit — job será reprocessado:", job?.name, job?.id);
      return;
    }
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
  const { startGroupsFlowScheduler } = await import("./services/groupsFlowSchedule.js");
  startGroupsFlowScheduler();
  console.log(
    `[worker] IA: concurrency=${env.AI_WORKER_CONCURRENCY}, max ${env.AI_OPENAI_RPM_LIMIT} req/min, stagger backfill=${env.AI_LEARN_STAGGER_MS}ms`
  );
  console.log("[worker] Zap worker ativo: zap-flow-jobs + zap-flow-starts + zap-ai-jobs + groups-schedule");

  // Redeploy manda SIGTERM. Sem fechar os workers, um job de fluxo morre no
  // meio do envio e a execução fica travada em "running" para sempre.
  let encerrando = false;
  for (const sinal of ["SIGTERM", "SIGINT"] as const) {
    process.on(sinal, () => {
      if (encerrando) return;
      encerrando = true;
      console.log(`[worker] ${sinal} recebido — terminando jobs em andamento`);
      const prazo = setTimeout(() => {
        console.warn("[worker] encerramento forçado após 25s");
        process.exit(1);
      }, 25_000);
      prazo.unref();
      Promise.all([flowWorker.close(), aiWorker.close()])
        .then(() => prisma?.$disconnect())
        .catch((err) => console.error("[worker] erro ao encerrar:", err))
        .finally(() => process.exit(0));
    });
  }
}

process.on("unhandledRejection", (reason) => {
  console.error("[worker] promise rejeitada sem tratamento:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[worker] exceção não capturada:", err);
});

main().catch((err) => {
  console.error("[worker] Falha fatal na inicialização:", err);
  process.exit(1);
});
