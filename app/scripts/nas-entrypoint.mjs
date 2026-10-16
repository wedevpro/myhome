import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { resolveDatabasePath } from "./database-path.mjs";

if (existsSync(".env")) process.loadEnvFile(".env");
if (!process.env.SITE_ORIGIN) throw new Error("SITE_ORIGIN must be configured before starting myHome.");
const publicUrl = new URL(process.env.SITE_ORIGIN);
if (publicUrl.protocol !== "https:" && !(publicUrl.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(publicUrl.hostname))) throw new Error("SITE_ORIGIN must use HTTPS (HTTP is allowed only on loopback for local checks).");
const server = existsSync("server.js") ? resolve("server.js") : resolve(".next/standalone/server.js");
const reminders = resolve("runtime/reminders.mjs");
if (!existsSync(server) || !existsSync(reminders)) throw new Error("Build myHome before starting: npm run build.");
const databasePath = resolveDatabasePath();
const children = [server, reminders].map(script => spawn(process.execPath, [script], { stdio: "inherit", env: { ...process.env, NODE_ENV: "production", HOSTNAME: process.env.HOSTNAME || "0.0.0.0", DB_PATH: databasePath, MIGRATIONS_DIR: process.env.MIGRATIONS_DIR || resolve("drizzle") } }));
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  const deadline = setTimeout(() => { for (const child of children) if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); process.exit(code); }, 8000);
  Promise.all(children.map(child => child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise(resolveExit => child.once("exit", resolveExit)))).then(() => { clearTimeout(deadline); process.exit(code); });
}
for (const child of children) {
  child.once("error", error => { console.error(error); stop(1); });
  child.once("exit", code => { if (!stopping) { console.error("A myHome process exited; stopping the service."); stop(code || 1); } });
}
process.on("SIGTERM", () => stop());
process.on("SIGINT", () => stop());
// IPC permits the integration test to stop children cleanly on Windows too.
process.on("message", message => { if (message?.action === "stop") stop(); });
