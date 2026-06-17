import { Redis } from "ioredis";
import { getRedisConnection } from "../queue.js";

let redis: Redis | null = null;
const memoryCounters = new Map<string, number>();

function getRedisClient(): Redis | null {
  try {
    const url = getRedisConnection().url;
    if (!url) return null;
    if (!redis) redis = new Redis(url, { maxRetriesPerRequest: null });
    return redis;
  } catch {
    return null;
  }
}

/**
 * Próximo índice de ramo (0..branchCount-1) em round robin global por fluxo + nó.
 * Contato 1 → ramo 0, contato 2 → ramo 1, etc.
 */
export async function reserveRoundRobinBranch(
  flowId: string,
  nodeId: string,
  branchCount: number
): Promise<number> {
  const n = Math.min(4, Math.max(2, Math.floor(branchCount)));
  const key = `zap:round-robin:${flowId}:${nodeId}`;

  const client = getRedisClient();
  if (client) {
    try {
      const counter = await client.incr(key);
      await client.expire(key, 7_776_000);
      return (counter - 1) % n;
    } catch {
      /* fallback memória */
    }
  }

  const prev = memoryCounters.get(key) ?? 0;
  const index = prev % n;
  memoryCounters.set(key, prev + 1);
  return index;
}
