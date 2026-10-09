import type { Entity } from "./model";
export function mapRecord(row: Record<string, string>): Entity {
  return { id: row.id, kind: row.kind as Entity["kind"], householdId: row.household_id, data: JSON.parse(row.data), revision: row.revision, createdBy: row.created_by, createdAt: row.created_at, updatedBy: row.updated_by, updatedAt: row.updated_at };
}
