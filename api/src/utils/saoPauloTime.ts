/** Relógio e cálculos em America/Sao_Paulo (sem DST no Brasil desde 2019 → UTC−3 fixo). */

const SP_OFFSET = "-03:00";

export function getSaoPauloClock(now = new Date()): {
  weekday: number;
  hm: string;
  dayKey: string;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
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
  let hour = get("hour").padStart(2, "0");
  if (hour === "24") hour = "00";
  const minute = get("minute").padStart(2, "0");
  const month = get("month").padStart(2, "0");
  const day = get("day").padStart(2, "0");
  const year = get("year");

  return {
    weekday,
    hm: `${hour}:${minute}`,
    dayKey: `${year}-${month}-${day}`
  };
}

export function normalizeTimeHm(raw: string | undefined, fallback = "09:00"): string {
  const m = String(raw ?? fallback)
    .trim()
    .match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return fallback;
  const h = Math.min(23, Math.max(0, Number(m[1])));
  const min = Math.min(59, Math.max(0, Number(m[2])));
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function addDaysToDayKey(dayKey: string, days: number): string {
  const [y, mo, d] = dayKey.split("-").map(Number);
  const utc = new Date(Date.UTC(y, mo - 1, d + days));
  const yy = utc.getUTCFullYear();
  const mm = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(utc.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

function weekdayOfDayKey(dayKey: string): number {
  return new Date(`${dayKey}T12:00:00${SP_OFFSET}`).getUTCDay();
}

function spLocalToUtcMs(dayKey: string, hm: string): number {
  return Date.parse(`${dayKey}T${normalizeTimeHm(hm)}:00${SP_OFFSET}`);
}

/**
 * Ms até a próxima ocorrência do dia da semana + horário em Brasília.
 * Se hoje for o dia e o horário ainda não passou, usa hoje.
 */
export function msUntilNextWeekdayTime(
  weekday: number,
  timeHm: string,
  now = new Date()
): number {
  const wd = Math.max(0, Math.min(6, Math.floor(weekday)));
  const hm = normalizeTimeHm(timeHm);
  const clock = getSaoPauloClock(now);
  const nowMs = now.getTime();

  for (let add = 0; add <= 7; add++) {
    const dayKey = addDaysToDayKey(clock.dayKey, add);
    if (weekdayOfDayKey(dayKey) !== wd) continue;
    const targetMs = spLocalToUtcMs(dayKey, hm);
    if (targetMs > nowMs + 1_000) {
      return targetMs - nowMs;
    }
  }

  // Fallback: daqui a 7 dias no mesmo horário
  const fallbackKey = addDaysToDayKey(clock.dayKey, 7);
  return Math.max(60_000, spLocalToUtcMs(fallbackKey, hm) - nowMs);
}

export const WEEKDAY_LABELS_PT = [
  "Domingo",
  "Segunda",
  "Terça",
  "Quarta",
  "Quinta",
  "Sexta",
  "Sábado"
] as const;
