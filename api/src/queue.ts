import { Queue, type Job } from "bullmq";
import { env } from "./env.js";
import type { FlowJobPayload, FlowStartRunJobPayload } from "./types/flow.js";
import type { AiLearnJobPayload, AiReplyJobPayload } from "./types/ai.js";

const connection = {
  url: env.REDIS_URL,
  maxRetriesPerRequest: null as null
};

let flowQueue: Queue<FlowJobPayload> | null = null;
let flowStartQueue: Queue<FlowStartRunJobPayload> | null = null;
let aiQueue: Queue<AiLearnJobPayload | AiReplyJobPayload> | null = null;

export function getRedisConnection() {
  return connection;
}

export function getFlowQueue(): Queue<FlowJobPayload> {
  if (!flowQueue) {
    flowQueue = new Queue<FlowJobPayload>("zap-flow-jobs", {
      connection,
      defaultJobOptions: {
        removeOnComplete: 1000,
        removeOnFail: 5000,
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 }
      }
    });
  }
  return flowQueue;
}

/** BullMQ não aceita ":" em jobId customizado (delimitador interno no Redis). */
export function sanitizeQueueJobId(id: string): string {
  return id.replace(/:/g, "_");
}

export async function enqueueFlowJob(payload: FlowJobPayload, delayMs: number, jobId?: string) {
  const queue = getFlowQueue();
  return queue.add("continue", payload, {
    delay: Math.max(0, delayMs),
    ...(jobId ? { jobId: sanitizeQueueJobId(jobId) } : {})
  });
}

function getFlowStartQueue(): Queue<FlowStartRunJobPayload> {
  if (!flowStartQueue) {
    flowStartQueue = new Queue<FlowStartRunJobPayload>("zap-flow-starts", {
      connection,
      defaultJobOptions: {
        removeOnComplete: 2000,
        removeOnFail: 5000,
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 }
      }
    });
  }
  return flowStartQueue;
}

/** Agenda início de execução (ex.: cadência entre contatos com a mesma tag). */
export async function enqueueFlowRunStart(
  payload: FlowStartRunJobPayload,
  delayMs: number,
  jobId?: string
) {
  const queue = getFlowStartQueue();
  return queue.add("start", payload, {
    delay: Math.max(0, delayMs),
    ...(jobId ? { jobId: sanitizeQueueJobId(jobId) } : {})
  });
}

function getAiQueue(): Queue<AiLearnJobPayload | AiReplyJobPayload> {
  if (!aiQueue) {
    aiQueue = new Queue<AiLearnJobPayload | AiReplyJobPayload>("zap-ai-jobs", {
      connection,
      defaultJobOptions: {
        removeOnComplete: 2000,
        removeOnFail: 5000,
        attempts: 2,
        backoff: { type: "exponential", delay: 5000 }
      }
    });
  }
  return aiQueue;
}

export function aiReplyJobId(session: string, chatId: string): string {
  return sanitizeQueueJobId(`ai_reply_${session}_${chatId}`);
}

export async function enqueueAiLearnJob(payload: AiLearnJobPayload, delayMs = 0) {
  const queue = getAiQueue();
  const jobId = sanitizeQueueJobId(
    `ai_learn_${payload.session}_${payload.inboxMessageId}`
  );
  return queue.add("learn", payload, {
    jobId,
    delay: Math.max(0, delayMs),
    attempts: 8,
    backoff: { type: "exponential", delay: 30_000 }
  });
}

export async function enqueueAiReplyJob(
  payload: AiReplyJobPayload,
  delayMs: number,
  jobId: string
) {
  const queue = getAiQueue();
  const id = sanitizeQueueJobId(jobId);
  const replyJobOpts = {
    delay: Math.max(0, delayMs),
    attempts: 3,
    backoff: { type: "exponential" as const, delay: 5000 },
    // Sem isso o jobId fixo por chat fica no Redis (default removeOnComplete:2000)
    // e a 2ª mensagem do mesmo chat não consegue agendar reply.
    removeOnComplete: true as const,
    removeOnFail: 100
  };

  const existing = await queue.getJob(id);
  if (existing) {
    const state = await existing.getState();
    if (state === "delayed" || state === "waiting") {
      // Queue tipada como union: updateData exige interseção; este jobId é sempre reply.
      await (existing as Job<AiReplyJobPayload>).updateData(payload);
      await existing.changeDelay(Math.max(0, delayMs));
      return existing;
    }
    if (state === "active") {
      // Job em processamento: o drain no fim do reply reagenda msgs novas.
      return null;
    }
    try {
      await existing.remove();
    } catch (err) {
      console.warn("[ai/queue] não removeu job reply antigo", id, state, err);
    }
  }

  try {
    return await queue.add("reply", payload, { ...replyJobOpts, jobId: id });
  } catch (err) {
    // JobId ainda preso: agenda com id único para não ghostar o cliente.
    const fallbackId = sanitizeQueueJobId(`${id}_${payload.inboundMessageId}`);
    console.warn("[ai/queue] jobId reply ocupado, fallback", id, "->", fallbackId, err);
    return queue.add("reply", payload, { ...replyJobOpts, jobId: fallbackId });
  }
}

export async function cancelAiReplyJob(session: string, chatId: string): Promise<void> {
  const queue = getAiQueue();
  const jobId = aiReplyJobId(session, chatId);
  const job = await queue.getJob(jobId);
  if (!job) return;
  const state = await job.getState();
  if (state === "active") return;
  try {
    await job.remove();
  } catch {
    /* ignore */
  }
}

export async function getAiQueueCounts(): Promise<{ pending: number; active: number }> {
  const queue = getAiQueue();
  const [waiting, delayed, active] = await Promise.all([
    queue.getWaitingCount(),
    queue.getDelayedCount(),
    queue.getActiveCount()
  ]);
  return { pending: waiting + delayed, active };
}
