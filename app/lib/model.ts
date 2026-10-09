export type Kind = "shopping" | "checklist" | "item" | "product" | "note" | "category" | "contact" | "electricity" | "waste";
export type Data = { name?: string; icon?: string; listId?: string; productId?: string; checked?: boolean; quantity?: number; unit?: string; category?: string; reusable?: boolean; content?: string; color?: string; parentId?: string; categoryId?: string; phone?: string; email?: string; address?: string; start?: string; end?: string; days?: number[]; weekday?: number; reminder?: string; barcodes?: string[]; frequency?: number; anchorDate?: string; [key: string]: unknown };
export type Entity = { id: string; kind: Kind; householdId: string; data: Data; revision: string; createdBy: string; createdAt: string; updatedBy: string; updatedAt: string };
export type Household = { id: string; name: string; code: string; role: "admin" | "member" };
export type User = { id: string; name: string; email: string };
export type Member = User & { role: "admin" | "member" };
export type Preferences = { shoppingId?: string; checklistId?: string; layout?: "side" | "rotate"; rotation?: number; camera?: "user" | "environment"; peakColor?: string; offPeakColor?: string; notifications?: boolean };
export type Snapshot = { user: User | null; households: Household[]; household: Household | null; entities: Entity[]; members: Member[]; preferences: Preferences };
export const audit = (id: string, kind: Kind, data: Data, householdId = "demo"): Entity => { const now = new Date().toISOString(); return { id, kind, data, householdId, revision:crypto.randomUUID(), createdBy: "demo", createdAt: now, updatedBy: "demo", updatedAt: now }; };
export function getElectricity(entities: Entity[], now = new Date()) {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", weekday: "short" }).format(now);
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday);
  const time = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  const offPeak = entities.filter(e => e.kind === "electricity").some(e => {
    const { start = "", end = "", days = [0,1,2,3,4,5,6] } = e.data;
    if (start < end) return days.includes(day) && time >= start && time < end;
    return (days.includes(day) && time >= start) || (days.includes((day + 6) % 7) && time < end);
  });
  return { offPeak, time };
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
