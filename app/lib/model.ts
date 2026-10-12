export type Kind = "shopping" | "checklist" | "item" | "product" | "note" | "category" | "contact" | "electricity" | "waste";
export type Data = { name?: string; icon?: string; listId?: string; linkedChecklistId?: string; productId?: string; checked?: boolean; quantity?: number; comment?: string; unit?: string; category?: string; reusable?: boolean; itemOrder?: string[]; content?: string; color?: string; parentId?: string; categoryId?: string; phone?: string; email?: string; address?: string; start?: string; end?: string; days?: number[]; weekday?: number; reminder?: string; barcodes?: string[]; frequency?: number; anchorDate?: string; [key: string]: unknown };
export type Entity = { id: string; kind: Kind; householdId: string; data: Data; revision: string; createdBy: string; createdAt: string; updatedBy: string; updatedAt: string };
export type Household = { id: string; name: string; code: string; role: "admin" | "member" };
export type User = { id: string; name: string; email: string };
export type Member = User & { role: "admin" | "member" };
export type Preferences = { shoppingId?: string; checklistId?: string; layout?: "side" | "rotate"; rotation?: number; camera?: "user" | "environment"; peakColor?: string; offPeakColor?: string; notifications?: boolean };
export type Snapshot = { user: User | null; households: Household[]; household: Household | null; entities: Entity[]; members: Member[]; preferences: Preferences };
export const audit = (id: string, kind: Kind, data: Data, householdId = "demo"): Entity => { const now = new Date().toISOString(); return { id, kind, data, householdId, revision:crypto.randomUUID(), createdBy: "demo", createdAt: now, updatedBy: "demo", updatedAt: now }; };
const minuteMs = 60_000;
const dayMs = 24 * 60 * minuteMs;
const weekMinutes = 7 * 24 * 60;
const parisClockFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
type ElectricityInterval = { start: number; end: number };

function parisClock(now: Date) {
  const parts = parisClockFormatter.formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value);
  const local = Date.UTC(value("year"), value("month") - 1, value("day"), value("hour"), value("minute"));
  return { local, offset: local - Math.floor(now.getTime() / minuteMs) * minuteMs };
}

function electricityIntervals(entities: Entity[]): ElectricityInterval[] {
  const intervals: ElectricityInterval[] = [];
  const parseTime = (time: string | undefined) => {
    if (!time || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
    return Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  };
  for (const entity of entities) {
    if (entity.kind !== "electricity") continue;
    const start = parseTime(entity.data.start), end = parseTime(entity.data.end);
    if (start === null || end === null) continue;
    const duration = start < end ? end - start : 1440 - start + end;
    for (const day of entity.data.days ?? [0, 1, 2, 3, 4, 5, 6]) {
      if (!Number.isInteger(day) || day < 0 || day > 6) continue;
      const from = day * 1440 + start, to = from + duration;
      intervals.push({ start: from, end: Math.min(to, weekMinutes) });
      if (to > weekMinutes) intervals.push({ start: 0, end: to - weekMinutes });
    }
  }
  intervals.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: ElectricityInterval[] = [];
  for (const interval of intervals) {
    const previous = merged[merged.length - 1];
    if (previous && interval.start <= previous.end) previous.end = Math.max(previous.end, interval.end);
    else merged.push({ ...interval });
  }
  return merged;
}

function electricityAtMinute(intervals: ElectricityInterval[], minute: number) {
  let low = 0, high = intervals.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2), interval = intervals[middle];
    if (minute < interval.start) high = middle - 1;
    else if (minute >= interval.end) low = middle + 1;
    else return true;
  }
  return false;
}

function electricityAtLocal(intervals: ElectricityInterval[], local: number) {
  const date = new Date(local);
  const minute = date.getUTCDay() * 1440 + date.getUTCHours() * 60 + date.getUTCMinutes();
  return electricityAtMinute(intervals, minute);
}

export function getElectricity(entities: Entity[], now = new Date()) {
  const { local } = parisClock(now);
  const date = new Date(local);
  const time = `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
  return { offPeak: electricityAtLocal(electricityIntervals(entities), local), time };
}

/** The next effective change of the union of all off-peak rules, in Paris time. */
export function getNextElectricityTransition(entities: Entity[], now = new Date()): { at: Date; offPeak: boolean; minutesRemaining: number } | null {
  const timestamp = now.getTime();
  if (!Number.isFinite(timestamp)) return null;
  const intervals = electricityIntervals(entities);
  const boundaries = [...new Set(intervals.flatMap(interval => [interval.start % weekMinutes, interval.end % weekMinutes]))]
    .filter(minute => electricityAtMinute(intervals, minute) !== electricityAtMinute(intervals, (minute + weekMinutes - 1) % weekMinutes));
  if (!boundaries.length) return null;

  const clock = parisClock(now);
  const current = electricityAtLocal(intervals, clock.local);
  const start = Math.floor(timestamp / minuteMs) * minuteMs;
  // A whole weekly occurrence can disappear in the spring gap. Two weeks plus
  // one day cover the next occurrence; permanently covered weeks returned above.
  const end = start + 15 * dayMs;
  const segments: { start: number; end: number; offset: number }[] = [];
  let segmentStart = start, previousSample = start, offset = clock.offset;
  const offsetAt = (time: number) => parisClock(new Date(time)).offset;
  for (let sample = Math.min(start + dayMs / 2, end); sample <= end; sample = Math.min(sample + dayMs / 2, end)) {
    const sampledOffset = offsetAt(sample);
    if (sampledOffset !== offset) {
      let low = previousSample / minuteMs, high = sample / minuteMs;
      while (high - low > 1) {
        const middle = Math.floor((low + high) / 2);
        if (offsetAt(middle * minuteMs) === offset) low = middle;
        else high = middle;
      }
      const change = high * minuteMs;
      segments.push({ start: segmentStart, end: change, offset });
      segmentStart = change;
      offset = sampledOffset;
    }
    previousSample = sample;
    if (sample === end) break;
  }
  segments.push({ start: segmentStart, end, offset });

  const candidates = new Map<number, number>();
  for (const segment of segments) {
    // A clock jump can change the tariff without crossing a stored rule boundary.
    if (segment.start > timestamp) candidates.set(segment.start, segment.offset);
    const localStart = segment.start + segment.offset;
    const date = new Date(localStart);
    const sunday = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - date.getUTCDay() * dayMs;
    for (let week = sunday; week <= segment.end + segment.offset; week += 7 * dayMs) {
      for (const boundary of boundaries) {
        const candidate = week + boundary * minuteMs - segment.offset;
        if (candidate > timestamp && candidate >= segment.start && candidate < segment.end) candidates.set(candidate, segment.offset);
      }
    }
  }
  for (const [at, candidateOffset] of [...candidates].sort((a, b) => a[0] - b[0])) {
    const offPeak = electricityAtLocal(intervals, at + candidateOffset);
    if (offPeak !== current) return { at: new Date(at), offPeak, minutesRemaining: Math.ceil((at - timestamp) / minuteMs) };
  }
  return null;
}
export function upcomingWaste(entities: Entity[], now = new Date()) {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const today = new Date(date + "T12:00:00Z");
  const events = entities.filter(e => e.kind === "waste").map(e => {
    let days = ((e.data.weekday ?? 2) - today.getUTCDay() + 7) % 7;
    const frequency = e.data.frequency ?? 1;
    if (frequency > 1 && e.data.anchorDate) {
      const anchor = new Date(e.data.anchorDate + "T12:00:00Z");
      while (((Math.round((today.getTime() + days * 86400000 - anchor.getTime()) / 86400000) % (7 * frequency)) + 7 * frequency) % (7 * frequency) !== 0 && days < 366) days += 7;
    }
    return { ...e, days, date: new Date(today.getTime() + days * 86400000) };
  });
  return events.sort((a,b) => a.days - b.days);
}
