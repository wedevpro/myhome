import { runDuePushNotifications } from "../lib/push";
import { database } from "../lib/sqlite";

database();
let stopping = false;
let timer: ReturnType<typeof setTimeout>;
async function tick() {
  try {
    const result = await runDuePushNotifications();
    if (result.sent || result.failed) console.log("MyHomeIA reminders", result);
  } catch (error) { console.error("MyHomeIA reminder check failed", error); }
  if (!stopping) timer = setTimeout(tick, 60000);
}
for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => { stopping = true; clearTimeout(timer); process.exit(0); });
void tick();
