import { Queue } from "bullmq";
import { env } from "./env.js";
import type { FlowJobPayload, FlowStartRunJobPayload } from "./types/flow.js";

const connection = {
  url: env.REDIS_URL,
  maxRetriesPerRequest: null as null
};

let flowQueue: Queue<FlowJobPayload> | null = null;
let flowStartQueue: Queue<FlowStartRunJobPayload> | null = null;

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
