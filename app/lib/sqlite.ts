import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";

type Row = Record<string, unknown>;
type Result<T = Row> = { results: T[]; success: true; meta: { changes: number; last_row_id: number } };

// Preserve the application's prepared-statement contract on native SQLite.
// A batch executes synchronously inside one transaction, including rollback.
export class SqliteStatement {
  constructor(private db: DatabaseSync, private sql: string, private values: SQLInputValue[] = []) {}
  bind(...values: unknown[]) {
    return new SqliteStatement(this.db, this.sql, values.map(value => {
      if (value === undefined || value === null) return null;
      if (typeof value === "boolean") return Number(value);
      if (typeof value === "string" || typeof value === "number" || typeof value === "bigint" || value instanceof Uint8Array) return value;
      throw new TypeError("Unsupported SQLite parameter");
    }));
  }
  async first<T = Row>(column?: string): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.values);
    if (!row) return null;
    // Native SQLite rows have a null prototype; React Server Components only
    // accept ordinary objects when passing data to a Client Component.
    return (column ? row[column] ?? null : { ...row }) as T | null;
  }
  async all<T = Row>(): Promise<Result<T>> {
    const results = this.db.prepare(this.sql).all(...this.values).map(row => ({ ...row })) as T[];
    return { results, success: true, meta: { changes: 0, last_row_id: 0 } };
  }
  execute(): Result {
    const result = this.db.prepare(this.sql).run(...this.values);
    return { results: [], success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
  }
  async run() { return this.execute(); }
}

export class SqliteDatabase {
  readonly connection: DatabaseSync;
  constructor(filename: string, migrations = process.env.MIGRATIONS_DIR || resolve(process.cwd(), "drizzle")) {
    if (filename !== ":memory:") mkdirSync(dirname(resolve(filename)), { recursive: true });
    this.connection = new DatabaseSync(filename);
    this.connection.exec("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE;");
    try { this.migrate(migrations); } catch (error) { this.connection.close(); throw error; }
  }
  private migrate(directory: string) {
    const db = this.connection;
    db.exec("CREATE TABLE IF NOT EXISTS app_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL)");
    for (const name of readdirSync(directory).filter(file => /^\d+.*\.sql$/.test(file)).sort()) {
      const sql = readFileSync(resolve(directory, name), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      db.exec("BEGIN IMMEDIATE");
      try {
        const applied = db.prepare("SELECT checksum FROM app_migrations WHERE name=?").get(name);
        if (applied && applied.checksum !== checksum) throw new Error(`Applied migration changed: ${name}`);
        if (!applied) {
          // Execute the entire script so SQLite triggers remain intact.
          db.exec(sql);
          const now = new Date().toISOString();
          db.prepare("INSERT INTO app_migrations VALUES(?,?,'system',?,'system',?)").run(name, checksum, now, now);
        }
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
    }
  }
  prepare(sql: string) { return new SqliteStatement(this.connection, sql); }
  async batch(statements: SqliteStatement[]) {
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      const results = statements.map(statement => statement.execute());
      this.connection.exec("COMMIT");
      return results;
    } catch (error) { this.connection.exec("ROLLBACK"); throw error; }
  }
  exec(sql: string) { this.connection.exec(sql); }
  close() { this.connection.close(); }
}

const shared = globalThis as typeof globalThis & { myhomeiaDatabase?: SqliteDatabase };
export function database() {
  return shared.myhomeiaDatabase ??= new SqliteDatabase(process.env.DB_PATH || resolve(process.cwd(), "data", "myhomeia.sqlite"));
}
