import { prisma } from "../prisma.js";
import { dispatchGroupsFlow, getTriggerGroupsFromFlow } from "./groupsFlowTrigger.js";

const POLL_INTERVAL_MS = 30_000;
const TIMEZONE = "America/Sao_Paulo";

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

/** Relógio em America/Sao_Paulo → { weekday 0–6, hh: "HH:mm", dayKey: "YYYY-MM-DD" }. */
export function getSaoPauloClock(now = new Date()): {
  weekday: number;
  hm: string;
  dayKey: string;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6
  };
  const weekday = weekdayMap[get("weekday")] ?? now.getDay();
  const hour = get("hour").padStart(2, "0");
  // Intl às vezes devolve "24" para meia-noite
  const hourNorm = hour === "24" ? "00" : hour;
  const minute = get("minute").padStart(2, "0");
  const month = get("month").padStart(2, "0");
  const day = get("day").padStart(2, "0");
  const year = get("year");

  return {
    weekday,
    hm: `${hourNorm}:${minute}`,
    dayKey: `${year}-${month}-${day}`
  };
}

function normalizeTime(raw: string | undefined): string {
  const m = String(raw ?? "09:00").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return "09:00";
  const h = Math.min(23, Math.max(0, Number(m[1])));
  const min = Math.min(59, Math.max(0, Number(m[2])));
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/**
 * Varre fluxos com gatilho de grupos + agenda e dispara no dia/hora certos.
 * Dedup via externalId (mesmo minuto não dispara duas vezes).
 */
export async function processDueGroupsSchedules(): Promise<number> {
  if (!prisma || running) return 0;
  running = true;
  let fired = 0;

  try {
    const clock = getSaoPauloClock();
    const flows = await prisma.flow.findMany({
      where: { enabled: true },
      select: { id: true, name: true, graphJson: true }
    });

    for (const flow of flows) {
      const data = getTriggerGroupsFromFlow(flow.graphJson);
      if (!data) continue;
      if (data.scheduleEnabled === false) continue;

      const weekdays = data.weekdays ?? [];
      if (weekdays.length === 0) continue;
      if (!weekdays.includes(clock.weekday)) continue;

      const time = normalizeTime(data.time);
      if (time !== clock.hm) continue;

      if (!data.groupIds?.length) continue;

      const slotKey = `${clock.dayKey}_${time.replace(":", "")}`;
      try {
        const result = await dispatchGroupsFlow(flow.id, {
          slotKey,
          reason: "schedule"
        });
        if (result.scheduled > 0) {
          fired += result.scheduled;
          console.log(
            `[groups-schedule] Disparado "${flow.name}" (${flow.id}) slot=${slotKey} → ${result.scheduled} grupo(s)`
          );
        }
      } catch (err) {
        console.warn(
          `[groups-schedule] Erro flow=${flow.id}:`,
          err instanceof Error ? err.message : err
        );
      }
    }
  } finally {
    running = false;
  }

  return fired;
}

export function startGroupsFlowScheduler() {
  if (timer) return;
  void processDueGroupsSchedules().catch((err) =>
    console.error("[groups-schedule] tick inicial falhou", err)
  );
  timer = setInterval(() => {
    void processDueGroupsSchedules().catch((err) =>
      console.error("[groups-schedule] tick falhou", err)
    );
  }, POLL_INTERVAL_MS);
  console.log(`[groups-schedule] Agenda de grupos ativa (poll ${POLL_INTERVAL_MS / 1000}s, TZ=${TIMEZONE})`);
}

export function stopGroupsFlowScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
