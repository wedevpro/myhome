import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../lib/auth-crypto.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { normalizeEmail, hashPassword, verifyPassword, hashToken, newSessionToken, allowedRequestOrigin } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
const bodySource = fs.readFileSync(new URL('../lib/auth-body.ts', import.meta.url), 'utf8');
const bodyCompiled = ts.transpileModule(bodySource, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { readAuthJson } = await import('data:text/javascript;base64,' + Buffer.from(bodyCompiled).toString('base64'));

test('Authentification : scrypt salé et refus du mauvais mot de passe', async () => {
  const password = 'une phrase de test suffisamment longue';
  const first = await hashPassword(password), second = await hashPassword(password);
  assert.notEqual(first, second);
  assert.equal(first.includes(password), false);
  assert.equal(await verifyPassword(password, first), true);
  assert.equal(await verifyPassword('un autre mot de passe', first), false);
  assert.equal(await verifyPassword(password, 'scrypt-v1$bad$bad'), false);
  assert.equal(await verifyPassword(password, first + '$unexpected'), false);
});
test('Authentification : jetons aléatoires et e-mail normalisé', () => {
  const token = newSessionToken();
  assert.match(token, /^[A-Za-z0-9_-]{64}$/);
  assert.notEqual(token, newSessionToken());
  assert.match(hashToken(token), /^[a-f0-9]{64}$/);
  assert.notEqual(hashToken(token), token);
  assert.equal(normalizeEmail(' Antoine@Exemple.FR '), 'antoine@exemple.fr');
});
test('Origine : refus des requêtes externes et configuration production obligatoire', () => {
  const request = (headers = {}) => new Request('http://localhost:3000/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers } });
  assert.equal(allowedRequestOrigin(request({ Origin: 'https://maison.example.fr' }), 'https://maison.example.fr', true), true);
  assert.equal(allowedRequestOrigin(request({ Origin: 'https://pirate.example.fr' }), 'https://maison.example.fr', true), false);
  assert.equal(allowedRequestOrigin(request({ Origin: 'null' }), 'https://maison.example.fr', true), false);
  assert.equal(allowedRequestOrigin(request({ Origin: 'https://maison.example.fr', 'Sec-Fetch-Site': 'cross-site' }), 'https://maison.example.fr', true), false);
  assert.equal(allowedRequestOrigin(request(), undefined, true), false);
  assert.equal(allowedRequestOrigin(request({ Origin: 'http://localhost:3000' }), undefined, false), true);
  assert.equal(allowedRequestOrigin(new Request('http://localhost:3000/api/auth/logout', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }), undefined, false), false);
});
test('Migrations auth : e-mail unique, session révocable et suppression en cascade', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  for (const file of fs.readdirSync(new URL('../drizzle', import.meta.url)).filter(file => file.endsWith('.sql')).sort()) db.exec(fs.readFileSync(new URL('../drizzle/' + file, import.meta.url), 'utf8'));
  const audit = ['u1', 'now', 'u1', 'now'];
  for (const id of ['u1', 'u2']) db.prepare('INSERT INTO users(id,name,email,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?)').run(id, id, 'user@example.fr', ...audit);
  db.prepare('INSERT INTO accounts(user_id,email,password_hash,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?)').run('u1', 'user@example.fr', 'test-hash', ...audit);
  assert.throws(() => db.prepare('INSERT INTO accounts(user_id,email,password_hash,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?)').run('u2', 'user@example.fr', 'test-hash', ...audit), /UNIQUE constraint/);
  const token = hashToken(newSessionToken());
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?)').run(token, 'u1', Date.now() + 1000, ...audit);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 1);
  db.prepare('DELETE FROM users WHERE id=?').run('u1');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM accounts').get().count, 0);
  db.close();
});
test('Corps auth chunked : arrêt et annulation dès la limite sans Content-Length', async () => {
  let pulled = 0, cancelled = false;
  const stream = new ReadableStream({
    pull(controller) { pulled++; controller.enqueue(new Uint8Array(4096)); },
    cancel() { cancelled = true; },
  });
  const request = new Request('http://localhost/api/auth/login', { method: 'POST', body: stream, duplex: 'half' });
  assert.equal(request.headers.has('content-length'), false);
  await assert.rejects(() => readAuthJson(request), error => error.status === 413);
  assert.equal(cancelled, true);
  assert.ok(pulled <= 4, `Le flux devrait être arrêté rapidement, lu ${pulled} fois`);
  assert.deepEqual(await readAuthJson(new Request('http://localhost/api/auth/login', { method: 'POST', body: '{"email":"test@example.fr"}' })), { email: 'test@example.fr' });
});
