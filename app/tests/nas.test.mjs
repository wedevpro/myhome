import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';

const migrationsDirectory = fileURLToPath(new URL('../drizzle/', import.meta.url));
const migrationNames = fs.readdirSync(migrationsDirectory).filter(name => /^\d+.*\.sql$/.test(name)).sort();
const source = fs.readFileSync(new URL('../lib/sqlite.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { SqliteDatabase } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));

function fixture(t, { copyMigrations = false } = {}) {
  const temporaryPath = fileURLToPath(new URL('../.sites-runtime/nas-test-fixtures/', import.meta.url));
  fs.mkdirSync(temporaryPath, { recursive: true });
  const temporaryParent = fs.realpathSync(temporaryPath);
  const directory = fs.mkdtempSync(path.join(temporaryParent, 'myhomeia-nas-'));
  const verifiedDirectory = fs.realpathSync(directory);
  const connections = new Set();
  let migrations = migrationsDirectory;

  // Every recursive removal targets only this test's verified mkdtemp child.
  function assertTemporaryDirectory() {
    const actualDirectory = fs.realpathSync(directory);
    const relative = path.relative(temporaryParent, actualDirectory);
    assert.equal(actualDirectory, verifiedDirectory);
    assert.ok(relative && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
    assert.ok(path.basename(actualDirectory).startsWith('myhomeia-nas-'));
    return actualDirectory;
  }
  assertTemporaryDirectory();

  const close = db => {
    if (connections.delete(db)) db.close();
  };
  t.after(() => {
    try {
      for (const db of connections) close(db);
    } finally {
      fs.rmSync(assertTemporaryDirectory(), { recursive: true, force: true });
    }
  });

  if (copyMigrations) {
    migrations = path.join(directory, 'migrations');
    fs.mkdirSync(migrations);
    for (const name of migrationNames) fs.copyFileSync(path.join(migrationsDirectory, name), path.join(migrations, name));
  }
  const filename = path.join(directory, 'data', 'myhomeia.sqlite');
  const open = () => {
    const db = new SqliteDatabase(filename, migrations);
    connections.add(db);
    return db;
  };
  const inspect = () => {
    const db = new DatabaseSync(filename);
    connections.add(db);
    return db;
  };
  return { directory, filename, migrations, open, inspect, close };
}

function insertUser(db, id) {
  return db.prepare('INSERT INTO users(id,name,email,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?)')
    .bind(id, 'Utilisateur ' + id, id + '@example.fr', id, '2026-10-09T12:00:00.000Z', id, '2026-10-09T12:00:00.000Z');
}

test('NAS : résultats SQLite sérialisables vers les composants React clients', async t => {
  const storage = fixture(t);
  const db = storage.open();
  await insertUser(db, 'signed-in').run();
  const row = await db.prepare('SELECT id,name,email FROM users WHERE id=?').bind('signed-in').first();
  assert.equal(Object.getPrototypeOf(row), Object.prototype);
  assert.deepEqual(row, { id: 'signed-in', name: 'Utilisateur signed-in', email: 'signed-in@example.fr' });
  const result = await db.prepare('SELECT id,name,email FROM users').all();
  assert.equal(Object.getPrototypeOf(result.results[0]), Object.prototype);
  assert.deepEqual(result.results, [row]);
  assert.equal(await db.prepare('SELECT name FROM users WHERE id=?').bind('signed-in').first('name'), row.name);
  assert.equal(await db.prepare('SELECT 0 AS value').first('value'), 0);
  assert.equal(await db.prepare("SELECT '' AS value").first('value'), '');
  assert.equal(await db.prepare('SELECT id FROM users WHERE id=?').bind('missing').first(), null);
});

test('NAS : migrations au premier démarrage, persistance et réouverture idempotente', async t => {
  const storage = fixture(t);
  const first = storage.open();
  const tables = (await first.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()).results.map(row => row.name);
  for (const name of ['users', 'households', 'memberships', 'records', 'barcodes', 'push_settings', 'push_subscriptions', 'push_deliveries', 'accounts', 'sessions']) {
    assert.ok(tables.includes(name), 'La table ' + name + ' doit exister au premier démarrage.');
  }
  assert.ok(await first.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name='records_insert_guard'").first());
  const applied = (await first.prepare('SELECT * FROM app_migrations ORDER BY name').all()).results;
  assert.deepEqual(applied.map(row => row.name), migrationNames);
  assert.ok(applied.every(row => /^[a-f0-9]{64}$/.test(row.checksum)));
  await insertUser(first, 'persisted').run();
  storage.close(first);

  const reopened = storage.open();
  assert.equal(await reopened.prepare('SELECT name FROM users WHERE id=?').bind('persisted').first('name'), 'Utilisateur persisted');
  assert.deepEqual((await reopened.prepare('SELECT * FROM app_migrations ORDER BY name').all()).results, applied);
  assert.equal(await reopened.prepare('SELECT COUNT(*) AS count FROM users').first('count'), 1);
});

test('NAS : un doublon annule le batch entier puis les transactions restent utilisables', async t => {
  const storage = fixture(t);
  const db = storage.open();
  await insertUser(db, 'existing').run();
  await assert.rejects(db.batch([insertUser(db, 'rolled-back'), insertUser(db, 'existing')]), /UNIQUE constraint/);
  assert.equal(await db.prepare('SELECT id FROM users WHERE id=?').bind('rolled-back').first(), null);
  assert.equal(await db.prepare('SELECT COUNT(*) AS count FROM users').first('count'), 1);

  const committed = await db.batch([insertUser(db, 'first'), insertUser(db, 'second')]);
  assert.deepEqual(committed.map(result => result.meta.changes), [1, 1]);
  storage.close(db);
  assert.equal(await storage.open().prepare('SELECT COUNT(*) AS count FROM users').first('count'), 3);
});

test('NAS : références orphelines refusées, rollback du batch et suppression en cascade', async t => {
  const storage = fixture(t);
  const db = storage.open();
  const membership = db.prepare('INSERT INTO memberships(household_id,user_id,role,status,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?)')
    .bind('missing-household', 'orphan', 'member', 'active', 'orphan', 'now', 'orphan', 'now');
  await assert.rejects(db.batch([insertUser(db, 'orphan'), membership]), /FOREIGN KEY constraint/);
  assert.equal(await db.prepare('SELECT id FROM users WHERE id=?').bind('orphan').first(), null);

  await insertUser(db, 'owner').run();
  await db.prepare('INSERT INTO households(id,name,code,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?)')
    .bind('h1', 'Maison', 'HOUSEHOLD-TEST', 'owner', 'now', 'owner', 'now').run();
  await db.prepare('INSERT INTO preferences(household_id,user_id,data,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?)')
    .bind('h1', 'owner', '{}', 'owner', 'now', 'owner', 'now').run();
  await db.prepare('DELETE FROM households WHERE id=?').bind('h1').run();
  assert.equal(await db.prepare('SELECT COUNT(*) AS count FROM preferences').first('count'), 0);
  assert.equal(await db.prepare('SELECT id FROM users WHERE id=?').bind('owner').first('id'), 'owner');
});

test('NAS : une migration déjà appliquée et modifiée interdit le démarrage sans perdre les données', async t => {
  const storage = fixture(t, { copyMigrations: true });
  const first = storage.open();
  await insertUser(first, 'preserved').run();
  const applied = (await first.prepare('SELECT * FROM app_migrations ORDER BY name').all()).results;
  storage.close(first);

  const copiedMigration = path.join(storage.migrations, migrationNames[0]);
  const original = fs.readFileSync(copiedMigration, 'utf8');
  fs.writeFileSync(copiedMigration, original + '\n-- Modified only inside this test fixture.\n');
  assert.throws(storage.open, /Applied migration changed:/);

  // Restoring the fixture also checks that the rejected constructor released its connection.
  fs.writeFileSync(copiedMigration, original);
  const recovered = storage.open();
  assert.equal(await recovered.prepare('SELECT id FROM users WHERE id=?').bind('preserved').first('id'), 'preserved');
  assert.deepEqual((await recovered.prepare('SELECT * FROM app_migrations ORDER BY name').all()).results, applied);
});

test('NAS : une nouvelle migration est appliquée une fois lors de la mise à jour', async t => {
  const storage = fixture(t, { copyMigrations: true });
  storage.close(storage.open());
  const name = '9998_nas_upgrade_test.sql';
  fs.writeFileSync(path.join(storage.migrations, name), 'CREATE TABLE nas_upgrade_test(value TEXT NOT NULL); INSERT INTO nas_upgrade_test VALUES(\'initialized\');');

  const updated = storage.open();
  assert.equal(await updated.prepare('SELECT value FROM nas_upgrade_test').first('value'), 'initialized');
  storage.close(updated);
  const reopened = storage.open();
  assert.equal(await reopened.prepare('SELECT COUNT(*) AS count FROM nas_upgrade_test').first('count'), 1);
  assert.equal(await reopened.prepare('SELECT COUNT(*) AS count FROM app_migrations WHERE name=?').bind(name).first('count'), 1);
});

test('NAS : une migration en échec ne conserve ni DDL partiel ni entrée de suivi', async t => {
  const storage = fixture(t, { copyMigrations: true });
  const first = storage.open();
  await insertUser(first, 'before-upgrade').run();
  storage.close(first);
  const name = '9999_nas_failed_test.sql';
  const migration = path.join(storage.migrations, name);
  fs.writeFileSync(migration, 'CREATE TABLE nas_partial_test(value TEXT); INSERT INTO nas_missing_table VALUES(1);');
  assert.throws(storage.open, /no such table: nas_missing_table/);

  const inspection = storage.inspect();
  assert.equal(inspection.prepare("SELECT name FROM sqlite_master WHERE name='nas_partial_test'").get(), undefined);
  assert.equal(inspection.prepare('SELECT name FROM app_migrations WHERE name=?').get(name), undefined);
  assert.equal(inspection.prepare('SELECT COUNT(*) AS count FROM users').get().count, 1);
  storage.close(inspection);
  fs.unlinkSync(migration);
  assert.equal(await storage.open().prepare('SELECT id FROM users WHERE id=?').bind('before-upgrade').first('id'), 'before-upgrade');
});
