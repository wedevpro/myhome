import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Reuse the application's existing database when the default filename changes.
 * Custom DB_PATH values remain exact. No file is renamed or modified here.
 * @param {string} [filename]
 * @param {string} [defaultFilename]
 */
export function resolveDatabasePath(filename = process.env.DB_PATH || resolve("data/myhome.sqlite"), defaultFilename = resolve("data/myhome.sqlite")) {
  if (filename === ":memory:") return filename;
  const target = resolve(filename);
  if (target !== resolve(defaultFilename) || existsSync(target)) return target;
  const directory = dirname(target);
  if (!existsSync(directory)) return target;
  const candidates = readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith(".sqlite"))
    .map(entry => resolve(directory, entry.name));
  if (!candidates.length) return target;

  const recognized = [];
  for (const candidate of candidates) {
    let db;
    try {
      db = new DatabaseSync(candidate, { readOnly: true });
      const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
      if (["app_migrations", "users", "households", "memberships", "records", "barcodes", "accounts", "sessions"].every(table => tables.has(table))) recognized.push(candidate);
    } catch {
      // An unrelated or unreadable file must never be treated as this app's data.
    } finally {
      db?.close();
    }
  }
  if (recognized.length !== 1) throw new Error("Cannot select an existing myHome database safely. Set DB_PATH to the intended SQLite file before starting; no new database was created.");
  return recognized[0];
}
