import type { Entity, Snapshot } from "./model";

export const mobileWidgetActions = ["open", "add", "scan", "edit", "delete", "clearCompleted"] as const;
export type MobileWidgetAction = typeof mobileWidgetActions[number];
export type MobileWidgetRequest = { householdId: string; listId: string; action: MobileWidgetAction; itemId?: string };
export type MobileWidgetLink = { status: "absent" } | { status: "invalid"; error: string } | { status: "valid"; request: MobileWidgetRequest };
export const pendingWidgetStorageKey = "myhome-pending-widget";
const invalidLink = "Ce lien de widget est invalide. Reconfigurez le widget sur votre écran d’accueil.";
const identifier = /^[A-Za-z0-9_-]{1,200}$/;
const lifetime = 30 * 60 * 1000;
const fields = ["mobileWidget", "household", "list", "action", "item"];

/** Widget URLs select a screen; they never contain a command or editable data. */
export function parseMobileWidgetLink(value: string, origin: string): MobileWidgetLink {
  let url: URL;
  try { url = new URL(value, origin); } catch { return { status: "invalid", error: invalidLink }; }
  if (!url.searchParams.has("mobileWidget")) return { status: "absent" };
  const params = url.searchParams;
  if (url.origin !== origin || !["http:", "https:"].includes(url.protocol) || url.pathname !== "/" || url.username || url.password || params.get("mobileWidget") !== "1" || fields.some(field => params.getAll(field).length > 1)) return { status: "invalid", error: invalidLink };
  const householdId = params.get("household") || "", listId = params.get("list") || "";
  const action = params.get("action") || "open", itemId = params.get("item") || undefined;
  if (!identifier.test(householdId) || !identifier.test(listId) || !(mobileWidgetActions as readonly string[]).includes(action) || (itemId !== undefined && !identifier.test(itemId)) || (["edit", "delete"].includes(action) ? !itemId : params.has("item"))) return { status: "invalid", error: invalidLink };
  return { status: "valid", request: { householdId, listId, action: action as MobileWidgetAction, ...(itemId ? { itemId } : {}) } };
}

export function mobileWidgetPath(request: MobileWidgetRequest): string {
  const params = new URLSearchParams({ mobileWidget: "1", household: request.householdId, list: request.listId, action: request.action });
  if (request.itemId) params.set("item", request.itemId);
  return `/?${params}`;
}

export function storePendingWidgetLink(request: MobileWidgetRequest, now = Date.now()): string {
  return JSON.stringify({ path: mobileWidgetPath(request), createdAt: now });
}

/** Expired, foreign-origin or malformed stored requests cannot change navigation. */
export function readPendingWidgetLink(value: string | null, origin: string, now = Date.now()): MobileWidgetRequest | null {
  if (!value) return null;
  try {
    const stored = JSON.parse(value) as { path?: unknown; createdAt?: unknown };
    if (typeof stored.path !== "string" || !stored.path.startsWith("/?") || typeof stored.createdAt !== "number" || !Number.isFinite(stored.createdAt) || stored.createdAt > now || now - stored.createdAt > lifetime) return null;
    const parsed = parseMobileWidgetLink(stored.path, origin);
    return parsed.status === "valid" ? parsed.request : null;
  } catch { return null; }
}

/** Validate the current authorized snapshot, including the exact item parent. */
export function resolveMobileWidgetTarget(request: MobileWidgetRequest, snapshot: Snapshot): { list: Entity; item?: Entity; completedItems: Entity[] } {
  if (!snapshot.user) throw new Error("Connectez-vous pour ouvrir cette liste.");
  if (snapshot.household?.id !== request.householdId || !snapshot.households.some(house => house.id === request.householdId)) throw new Error("Vous n’avez pas accès au foyer de ce widget.");
  const list = snapshot.entities.find(entity => entity.id === request.listId && entity.householdId === request.householdId && (entity.kind === "shopping" || entity.kind === "checklist"));
  if (!list) throw new Error("La liste de ce widget n’existe plus ou n’est plus accessible. Reconfigurez le widget.");
  const items = snapshot.entities.filter(entity => entity.kind === "item" && entity.householdId === request.householdId && entity.data.listId === list.id);
  const item = request.itemId ? items.find(entity => entity.id === request.itemId) : undefined;
  if (["edit", "delete"].includes(request.action) && !item) throw new Error("Cet élément n’existe plus dans la liste du widget.");
  if (request.action === "scan" && list.kind !== "shopping") throw new Error("Le scanner est disponible uniquement pour les listes de courses.");
  if (request.action === "clearCompleted" && list.kind === "checklist" && list.data.reusable) throw new Error("Les éléments terminés d’une checklist réutilisable sont conservés.");
  return { list, item, completedItems: items.filter(entity => entity.data.checked) };
}
