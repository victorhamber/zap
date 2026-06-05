import { prisma } from "../prisma.js";
import { continueFlowRun } from "../engine/executor.js";

const POLL_INTERVAL_MS = 60_000;
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

/**
 * Recupera execuções presas em delay/agendamento quando o worker BullMQ não processou
 * (worker offline, Redis indisponível ou job nunca enfileirado).
 */
export async function processDueScheduledJobs(): Promise<number> {
  if (!prisma || running) return 0;
  running = true;

  let processed = 0;
  try {
    const due = await prisma.scheduledJob.findMany({
      where: {
        status: "pending",
        runAt: { lte: new Date() }
      },
      orderBy: { runAt: "asc" },
      take: 50,
      include: { flowRun: { select: { status: true } } }
    });

    for (const job of due) {
      if (job.flowRun.status !== "waiting") {
        await prisma.scheduledJob.update({
          where: { id: job.id },
          data: { status: "done" }
        });
        continue;
      }

      const claimed = await prisma.scheduledJob.updateMany({
        where: { id: job.id, status: "pending" },
        data: { status: "processing" }
      });
      if (claimed.count === 0) continue;

      try {
        await continueFlowRun(job.flowRunId, job.nodeId);
        await prisma.scheduledJob.update({
          where: { id: job.id },
          data: { status: "done" }
        });
        processed++;
        console.log(
          `[flowScheduler] Retomou execução ${job.flowRunId} no nó ${job.nodeId} (agendado para ${job.runAt.toISOString()})`
        );
      } catch (err) {
        await prisma.scheduledJob.update({
          where: { id: job.id },
          data: { status: "pending" }
        });
        console.error(`[flowScheduler] Falha ao retomar ${job.flowRunId}:`, err);
      }
    }
  } finally {
    running = false;
  }

  return processed;
}

export function startFlowScheduler(): void {
  if (!prisma || timer) return;

  void processDueScheduledJobs().then((n) => {
    if (n > 0) console.log(`[flowScheduler] ${n} job(s) vencido(s) processado(s) na inicialização`);
  });

  timer = setInterval(() => {
    void processDueScheduledJobs();
  }, POLL_INTERVAL_MS);

  console.log(`[flowScheduler] Polling a cada ${POLL_INTERVAL_MS / 1000}s para delays vencidos`);
}

export function stopFlowScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
