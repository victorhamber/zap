import { Redis } from "ioredis";
import { getRedisConnection } from "../queue.js";
import type { FlowGraph, TriggerTagData } from "../types/flow.js";

let redis: Redis | null = null;
const memorySlots = new Map<string, number>();

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

/** Intervalo aleatório entre min e max (segundos), com leve variação extra. */
export function humanGapMs(minSec: number, maxSec: number): number {
  const min = Math.max(1, minSec) * 1000;
  const max = Math.max(minSec, maxSec) * 1000;
  const base = min + Math.floor(Math.random() * (max - min + 1));
  const jitter = Math.floor(Math.random() * 1200) - 400;
  return Math.max(800, base + jitter);
}

export function getTagTriggerStaggerConfig(graph: FlowGraph): {
  enabled: boolean;
  minSec: number;
  maxSec: number;
} {
  const trigger = graph.nodes.find((n) => n.type === "trigger_tag");
  if (!trigger) return { enabled: false, minSec: 10, maxSec: 30 };

  const data = trigger.data as unknown as TriggerTagData;
  const enabled = data.staggerEnabled !== false;
  const minSec = Math.max(1, Math.min(300, Number(data.staggerMinSec) || 10));
  const maxSec = Math.max(minSec, Math.min(600, Number(data.staggerMaxSec) || 30));
  return { enabled, minSec, maxSec };
}

/**
 * Reserva o próximo slot de início para este fluxo (atômico no Redis).
 * O 1º contato inicia na hora; os seguintes esperam um intervalo humanizado.
 */
export async function reserveStaggeredStartDelay(
  flowId: string,
  minSec: number,
  maxSec: number
): Promise<number> {
  const gap = humanGapMs(minSec, maxSec);
  const now = Date.now();
  const key = `zap:flow-stagger:${flowId}`;

  const client = getRedisClient();
  if (client) {
    try {
      const delay = (await client.eval(
        `
        local key = KEYS[1]
        local now = tonumber(ARGV[1])
        local gap = tonumber(ARGV[2])
        local nextAt = tonumber(redis.call('GET', key) or '0')
        if nextAt < now then nextAt = now end
        local delay = nextAt - now
        local scheduled = nextAt + gap
        redis.call('SET', key, scheduled)
        redis.call('EXPIRE', key, 172800)
        return delay
        `,
        1,
        key,
        String(now),
        String(gap)
      )) as number;
      return Math.max(0, Math.floor(delay));
    } catch {
      /* fallback memória */
    }
  }

  const prev = memorySlots.get(flowId) ?? now;
  const nextAt = Math.max(now, prev);
  const delay = nextAt - now;
  memorySlots.set(flowId, nextAt + gap);
  return Math.max(0, delay);
}
