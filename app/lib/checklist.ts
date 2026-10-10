import type { Entity } from "./model";

const nameCollator = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

function searchableName(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("fr");
}

export function getChecklistItems(entities: Entity[], list: Entity | undefined): Entity[] {
  if (!list || list.kind !== "checklist") return [];
  const items = entities.filter(item => item.kind === "item" && item.householdId === list.householdId && item.data.listId === list.id);
  const byId = new Map(items.map(item => [item.id, item]));
  const ordered: Entity[] = [];
  const included = new Set<string>();

  for (const id of Array.isArray(list.data.itemOrder) ? list.data.itemOrder : []) {
    const item = byId.get(id);
    if (item && !included.has(id)) {
      ordered.push(item);
      included.add(id);
    }
  }
  // Older lists keep snapshot order; newly created tasks appear at the end.
  for (const item of items) {
    if (!included.has(item.id)) {
      ordered.push(item);
      included.add(item.id);
    }
  }
  return ordered;
}

export function sortChecklistItems(items: Entity[], direction: "asc" | "desc"): Entity[] {
  return items.map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const comparison = nameCollator.compare(a.item.data.name || "", b.item.data.name || "");
      return (direction === "desc" ? -comparison : comparison) || a.index - b.index;
    })
    .map(entry => entry.item);
}

export function filterChecklistItems(items: Entity[], query: string): Entity[] {
  const search = searchableName(query.trim());
  return items.filter(item => searchableName(item.data.name || "").includes(search));
}

export function completedItemsLast(items: Entity[]): Entity[] {
  const pending: Entity[] = [];
  const completed: Entity[] = [];
  for (const item of items) (item.data.checked ? completed : pending).push(item);
  return [...pending, ...completed];
}

export function moveChecklistItem(items: Entity[], itemId: string, direction: "up" | "down"): string[] {
  const ids = items.map(item => item.id);
  const index = ids.indexOf(itemId);
  if (index < 0) return ids;
  const target = index + (direction === "up" ? -1 : 1);
  if (target < 0 || target >= ids.length) return ids;
  [ids[index], ids[target]] = [ids[target], ids[index]];
  return ids;
}
