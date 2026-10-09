import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync } from "node:fs";
import { build } from "esbuild";

const result = spawnSync(process.execPath, ["node_modules/next/dist/bin/next", "build", "--webpack"], { stdio: "inherit", env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } });
if (result.status !== 0) process.exit(result.status || 1);
await build({ entryPoints: ["scripts/reminder-worker.ts"], outfile: "runtime/reminders.mjs", bundle: true, platform: "node", format: "esm", target: "node22", packages: "bundle" });
// Next standalone deliberately excludes public files and browser assets.
mkdirSync(".next/standalone/.next", { recursive: true });
cpSync("public", ".next/standalone/public", { recursive: true });
cpSync(".next/static", ".next/standalone/.next/static", { recursive: true });
console.log("NAS build ready: Next standalone and reminder worker.");
