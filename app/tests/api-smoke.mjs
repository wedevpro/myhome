import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const temporary = mkdtempSync(resolve(tmpdir(), "myhomeia-api-"));
const socket = createServer();
await new Promise(done => socket.listen(0, "127.0.0.1", done));
const port = socket.address().port;
await new Promise(done => socket.close(done));
const origin = `http://127.0.0.1:${port}`;
const appDirectory = fileURLToPath(new URL("..", import.meta.url));
let service, logs = "";
async function start() {
  service = spawn(process.execPath, ["scripts/nas-entrypoint.mjs"], { cwd: appDirectory, env: { ...process.env, NODE_ENV: "production", SITE_ORIGIN: origin, HOSTNAME: "127.0.0.1", PORT: String(port), DB_PATH: resolve(temporary, "test.sqlite") }, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  service.stdout.on("data", value => { logs += value; });
  service.stderr.on("data", value => { logs += value; });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (service.exitCode !== null) throw new Error(`Server exited: ${logs}`);
    try { if ((await fetch(origin + "/api/health")).ok) return; } catch {}
    await new Promise(done => setTimeout(done, 200));
  }
  throw new Error(`Server did not start: ${logs}`);
}
async function stop() {
  if (!service || service.exitCode !== null) return;
  const child = service, exited = new Promise(done => child.once("exit", done));
  if (child.connected) child.send({ action: "stop" }); else child.kill("SIGTERM");
  await exited;
}
function client() {
  let cookie = "";
  return async function request(path, data, extraHeaders = {}) {
    const response = await fetch(origin + path, { method: data === undefined ? "GET" : "POST", headers: { ...(cookie ? { Cookie: cookie } : {}), ...(data === undefined ? {} : { "Content-Type": "application/json", Origin: origin }), ...extraHeaders }, ...(data === undefined ? {} : { body: JSON.stringify(data) }), redirect: "manual" });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const text = await response.text();
    const json = response.headers.get("content-type")?.includes("application/json") ? JSON.parse(text) : undefined;
    return { status: response.status, json, text, response };
  };
}
try {
  await start();
  const admin = client(), member = client(), outsider = client(), anonymous = client();
  const password = "Un mot de passe pour le test 2026!";
  let recovery = await anonymous("/deconnexion"); assert.equal(recovery.status, 200); assert.match(recovery.text, /Fermer votre session/);
  let r = await anonymous("/api/state"); assert.equal(r.status, 401);
  r = await anonymous("/api/state", undefined, { "oai-authenticated-user-id": "local_seedy", "oai-authenticated-user-email": "admin@example.fr" }); assert.equal(r.status, 401);
  for (const [request, name] of [[admin, "Admin"], [member, "Member"], [outsider, "Outside"]]) {
    r = await request("/api/auth/signup", { name, email: `${name}@example.fr`, password }); assert.equal(r.status, 201, JSON.stringify(r.json));
    const cookie = r.response.headers.get("set-cookie"); assert.match(cookie, /HttpOnly/i); assert.match(cookie, /Secure/i); assert.match(cookie, /SameSite=lax/i);
    r = await request("/"); assert.equal(r.status, 200, `Authenticated page after signup: ${r.text.slice(0, 1000)}`);
    assert.doesNotMatch(r.text, /929290566|Only plain objects|:E\{/);
    assert.match(r.text, /Bienvenue à la maison/);
    recovery = await request("/deconnexion"); assert.equal(recovery.status, 200); assert.match(recovery.text, /Fermer votre session/);
  }
  r = await admin("/api/command", { action: "createHousehold", name: "NAS smoke" }); assert.equal(r.status, 200, JSON.stringify(r.json));
  const household = r.json.household, adminId = r.json.user.id, list = r.json.entities.find(e => e.kind === "shopping");
  const command = data => admin("/api/command", { householdId: household.id, ...data });
  r = await command({ action: "addItem", listId: list.id, name: "Lait", saveProduct: true, barcode: "0001234567890" }); assert.equal(r.status, 200, JSON.stringify(r.json));
  const product = r.json.entities.find(e => e.kind === "product"); assert.deepEqual(product.data.barcodes, ["0001234567890"]);
  r = await command({ action: "addItem", listId: list.id, barcode: "0001234567890" }); assert.equal(r.status, 200); assert.equal(r.json.entities.filter(e => e.kind === "item").length, 2);
  r = await command({ action: "save", id: product.id, kind: "product", expectedRevision: product.revision, data: { ...product.data, name: "Lait modifié" } }); assert.equal(r.status, 200);
  r = await command({ action: "save", id: product.id, kind: "product", expectedRevision: product.revision, data: { ...product.data, name: "Ancienne version" } }); assert.equal(r.status, 409);
  r = await command({ action: "member", userId: adminId, role: "member" }); assert.equal(r.status, 409);
  r = await command({ action: "preferences", data: { shoppingId: list.id, layout: "rotate", rotation: 10 } }); assert.equal(r.status, 200);
  r = await member("/api/command", { action: "joinHousehold", code: household.code }); assert.equal(r.status, 200); const memberId = r.json.user.id;
  r = await member("/api/state?household=" + household.id); assert.equal(r.status, 200); assert.equal(r.json.entities.find(e => e.id === product.id).data.name, "Lait modifié"); assert.equal(r.json.preferences.rotation, undefined);
  r = await member("/api/command", { action: "member", householdId: household.id, userId: memberId, role: "admin" }); assert.equal(r.status, 403);
  r = await member("/api/command", { action: "save", householdId: household.id, kind: "electricity", data: { start: "22:00", end: "06:00", days: [1] } }); assert.equal(r.status, 403);
  r = await outsider("/api/state?household=" + household.id); assert.equal(r.status, 403);
  r = await admin("/api/command", { action: "renameHousehold", householdId: household.id, name: "Forbidden" }, { Origin: "https://attacker.example" }); assert.equal(r.status, 403);
  r = await admin("/api/auth/logout", {}, { Origin: "https://attacker.example" }); assert.equal(r.status, 403);
  r = await admin("/api/push/run", {}); assert.equal(r.status, 403);
  await stop(); await start();
  r = await admin("/api/state?household=" + household.id); assert.equal(r.status, 200, "Session survives restart"); assert.equal(r.json.preferences.rotation, 10); assert.equal(r.json.entities.find(e => e.id === product.id).data.name, "Lait modifié");
  r = await admin("/"); assert.equal(r.status, 200); assert.doesNotMatch(r.text, /929290566|Only plain objects|:E\{/);
  r = await admin("/api/auth/logout", {}); assert.equal(r.status, 200);
  r = await admin("/api/state"); assert.equal(r.status, 401);
  r = await admin("/api/auth/login", { email: "ADMIN@example.fr", password: "wrong password" }); assert.equal(r.status, 401);
  r = await admin("/api/auth/login", { email: "ADMIN@example.fr", password }); assert.equal(r.status, 200);
  r = await admin("/"); assert.equal(r.status, 200); assert.doesNotMatch(r.text, /929290566|Only plain objects|:E\{/);
  r = await command({ action: "member", userId: memberId, role: "remove" }); assert.equal(r.status, 200);
  r = await member("/api/state?household=" + household.id); assert.equal(r.status, 403);
  r = await member("/api/command", { action: "joinHousehold", code: household.code }); assert.equal(r.status, 403);
  r = await command({ action: "delete", id: list.id, expectedRevision: list.revision }); assert.equal(r.status, 200); assert.equal(r.json.entities.filter(e => e.kind === "item").length, 0); assert.equal(r.json.entities.filter(e => e.kind === "product").length, 1);
  console.log("NAS API/pages passed: authenticated dashboard after signup/login/restart, logout recovery page, secure sessions, household sharing/isolation, roles, barcodes, conflicts, preferences, CSRF and persistence.");
} catch (error) { console.error(logs); throw error; }
finally {
  await stop();
  if (!resolve(temporary).startsWith(resolve(tmpdir()) + sep + "myhomeia-api-")) throw new Error("Unexpected temporary path");
  rmSync(temporary, { recursive: true, force: true });
}
