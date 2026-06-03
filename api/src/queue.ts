import { Queue } from "bullmq";
import { env } from "./env.js";
import type { FlowJobPayload } from "./types/flow.js";

const connection = {
  url: env.REDIS_URL,
  maxRetriesPerRequest: null as null
};

let flowQueue: Queue<FlowJobPayload> | null = null;

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
