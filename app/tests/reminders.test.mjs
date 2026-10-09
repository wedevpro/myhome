import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

async function moduleFrom(path) {
  const bundled = await build({ entryPoints: [fileURLToPath(new URL(path, import.meta.url))], write: false, bundle: true, platform: "node", format: "esm", target: "node22" });
  return import("data:text/javascript;base64," + Buffer.from(bundled.outputFiles[0].text).toString("base64"));
}
const { SqliteDatabase } = await moduleFrom("../lib/sqlite.ts");
const { runDuePushNotifications, vapidKeys } = await moduleFrom("../lib/push.ts");

test("Rappels NAS : envoi réel construit, déduplication, abonnement retiré et échec réseau", async () => {
  const db = new SqliteDatabase(":memory:", fileURLToPath(new URL("../drizzle", import.meta.url)));
  const previousDb = globalThis.myhomeiaDatabase, originalFetch = globalThis.fetch;
  globalThis.myhomeiaDatabase = db;
  const audit = ["u", "2026-10-09T10:00:00Z", "u", "2026-10-09T10:00:00Z"];
  try {
    await db.prepare("INSERT INTO users VALUES(?,?,?,?,?,?,?)").bind("u", "Test", "test@example.fr", ...audit).run();
    await db.prepare("INSERT INTO households VALUES(?,?,?,?,?,?,?)").bind("h", "Test", "CODE", ...audit).run();
    await db.prepare("INSERT INTO memberships VALUES(?,?,?,?,?,?,?,?)").bind("h", "u", "admin", "active", ...audit).run();
    await db.prepare("INSERT INTO preferences VALUES(?,?,?,?,?,?,?)").bind("h", "u", JSON.stringify({ notifications: true }), ...audit).run();
    await db.prepare("INSERT INTO records(id,household_id,kind,data,revision,created_by,created_at,updated_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").bind("w", "h", "waste", JSON.stringify({ name: "Bac jaune", weekday: 5, frequency: 1, reminder: "19:00" }), "r", ...audit).run();
    const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
    const subscription = { endpoint: "https://updates.push.services.mozilla.com/wpush/v2/myhomeia-test", keys: { p256dh: Buffer.from(await crypto.subtle.exportKey("raw", pair.publicKey)).toString("base64url"), auth: randomBytes(16).toString("base64url") } };
    await db.prepare("INSERT INTO push_subscriptions VALUES(?,?,?,?,?,?,?,?,?)").bind("s", "h", "u", subscription.endpoint, JSON.stringify(subscription), ...audit).run();
    let calls = 0;
    globalThis.fetch = async (url, init) => {
      calls++;
      assert.equal(url, subscription.endpoint);
      assert.ok(init.body.byteLength > 20, "Encrypted push payload");
      assert.ok(init.signal, "Bounded network request");
      return new Response(null, { status: 201 });
    };
    const due = new Date("2026-10-09T17:00:00Z");
    assert.deepEqual(await runDuePushNotifications(new Date("2026-10-09T16:59:00Z"), "https://maison.example.fr"), { sent: 0, failed: 0 });
    assert.deepEqual(await runDuePushNotifications(due, "https://maison.example.fr"), { sent: 1, failed: 0 });
    assert.deepEqual(await runDuePushNotifications(due, "https://maison.example.fr"), { sent: 0, failed: 0 });
    assert.equal(calls, 1);
    const keys = await vapidKeys(); assert.deepEqual(await vapidKeys(), keys);
    await db.prepare("DELETE FROM push_deliveries").run();
    globalThis.fetch = async () => { throw new Error("Simulated timeout"); };
    const originalError = console.error; console.error = () => {};
    try { assert.deepEqual(await runDuePushNotifications(due, "https://maison.example.fr"), { sent: 0, failed: 1 }); } finally { console.error = originalError; }
    assert.equal((await db.prepare("SELECT status FROM push_deliveries").first()).status, "failed");
    assert.deepEqual(await runDuePushNotifications(due, "https://maison.example.fr"), { sent: 0, failed: 0 }, "Fresh lease prevents immediate retry");
    await db.prepare("UPDATE push_deliveries SET updated_at=?").bind(new Date(Date.now() - 180000).toISOString()).run();
    globalThis.fetch = async () => new Response(null, { status: 410 });
    assert.deepEqual(await runDuePushNotifications(due, "https://maison.example.fr"), { sent: 0, failed: 1 });
    assert.equal((await db.prepare("SELECT COUNT(*) AS count FROM push_subscriptions").first()).count, 0);
    await db.prepare("INSERT INTO push_subscriptions VALUES(?,?,?,?,?,?,?,?,?)").bind("s2", "h", "u", subscription.endpoint, JSON.stringify(subscription), ...audit).run();
    await db.prepare("UPDATE memberships SET status='removed'").run();
    globalThis.fetch = async () => { throw new Error("Removed member must not receive push"); };
    assert.deepEqual(await runDuePushNotifications(due, "https://maison.example.fr"), { sent: 0, failed: 0 });
  } finally { globalThis.fetch = originalFetch; globalThis.myhomeiaDatabase = previousDb; db.close(); }
});
