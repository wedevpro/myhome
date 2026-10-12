import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Uses the actual production application in demo mode: no accounts or household data.
const appDirectory = fileURLToPath(new URL("..", import.meta.url));
const artifactRoot = join(appDirectory, ".sites-runtime", "checklist-links-browser");
mkdirSync(artifactRoot, { recursive: true });
assert.ok(realpathSync(artifactRoot).startsWith(realpathSync(appDirectory) + sep));
const artifacts = mkdtempSync(join(artifactRoot, "run-"));
const profile = mkdtempSync(join(artifacts, "edge-profile-"));
const edgePath = process.env.EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
assert.ok(existsSync(edgePath), "Set EDGE_PATH to an installed Chromium browser");
assert.ok(existsSync(join(appDirectory, ".next", "standalone", "server.js")), "Build production before running this test");
const socket = createServer();
await new Promise(done => socket.listen(0, "127.0.0.1", done));
const port = socket.address().port;
await new Promise(done => socket.close(done));
const origin = `http://127.0.0.1:${port}`;
const pause = milliseconds => new Promise(done => setTimeout(done, milliseconds));
const outcomes = [], errors = [];
let service, browser, cdp, serviceLog = "", browserLog = "", mobile = false;

async function connect(url) {
  const ws = new WebSocket(url), pending = new Map();
  let nextId = 0;
  await new Promise((done, reject) => {
    const timeout = setTimeout(() => { ws.close(); reject(new Error("Browser connection timed out")); }, 8000);
    ws.addEventListener("open", () => { clearTimeout(timeout); done(); }, { once: true });
    ws.addEventListener("error", error => { clearTimeout(timeout); reject(error); }, { once: true });
  });
  ws.addEventListener("message", event => {
    const message = JSON.parse(String(event.data));
    if (message.id) {
      const request = pending.get(message.id);
      if (!request) return;
      clearTimeout(request.timeout); pending.delete(message.id);
      if (message.error) request.reject(new Error(JSON.stringify(message.error))); else request.resolve(message.result);
    } else if (message.method === "Runtime.exceptionThrown") errors.push(message);
  });
  return { ws, send: (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId, timeout = setTimeout(() => { pending.delete(id); reject(new Error("CDP timeout: " + method)); }, 8000);
    pending.set(id, { resolve, reject, timeout }); ws.send(JSON.stringify({ id, method, params }));
  }) };
}
async function evaluate(expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function until(expression, label) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (await evaluate(expression)) return;
    await pause(75);
  }
  throw new Error("Timed out: " + label);
}
const element = selector => `document.querySelector(${JSON.stringify(selector)})`;
const named = (text, selector = "button") => `[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(text)}&&e.getClientRects().length)`;
const region = name => element(`.task-items[aria-label="Éléments de ${name}"]`);
const checkbox = name => element(`[role="checkbox"][aria-label="Terminer ${name}"]`);
const row = name => `${checkbox(name)}?.closest('.item-row')`;
async function press(expression) {
  await until(`!!(${expression})`, expression);
  await evaluate(`(${expression}).scrollIntoView({block:'center',inline:'nearest'})`);
  await pause(100);
  const point = await evaluate(`(()=>{const e=(${expression}),r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);return {x,y,hit:e===hit||e.contains(hit),disabled:e.disabled}})()`);
  assert.ok(point.hit, "Action must hit the actual visible control: " + expression);
  assert.ok(!point.disabled, "Control must be enabled: " + expression);
  if (mobile) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: point.x, y: point.y, id: 1, radiusX: 4, radiusY: 4 }] });
    await pause(40);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else {
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  }
  await pause(350);
}
async function select(label, text) {
  await press(element(`[role="combobox"][aria-label="${label}"]`));
  await press(named(text, '[role="option"]'));
}
async function replaceInput(expression, text) {
  await press(expression);
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 });
  await cdp.send("Input.insertText", { text });
}
async function capture(name) {
  const result = await cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(artifacts, name + ".png"), Buffer.from(result.data, "base64"));
}
async function navigate(text) {
  if (mobile) await press(element('[data-slot="sidebar-trigger"]'));
  await press(named(text));
  await until(text === "Tableau de bord" ? "document.querySelector('h1')?.textContent.startsWith('Bonjour')" : `document.querySelector('h1')?.textContent.trim()===${JSON.stringify(text + ".")}`, "navigation to " + text);
}
async function editItem(name, target, newName) {
  await press(`${row(name)}.querySelector('.item-actions-trigger')`);
  await press(named("Modifier l’élément", '[role="menuitem"]'));
  await select("Checklist liée (facultatif)", target);
  if (newName) await replaceInput(element('[role="dialog"] input[type="text"]'), newName);
  await press(named("Enregistrer", '[role="dialog"] button'));
}
async function openToiletries() {
  await press(element('button[aria-label="Ouvrir la checklist Trousse de toilette"]'));
  await until(`!!(${region("Trousse de toilette")})`, "linked checklist content");
}
const pageTitle = text => text === "Tableau de bord"
  ? "document.querySelector('h1')?.textContent.startsWith('Bonjour')"
  : `document.querySelector('h1')?.textContent.trim()===${JSON.stringify(text + ".")}`;
async function markDocument() {
  const token = "mobile-back-" + Date.now();
  await evaluate(`window.__mobileBackDocument=${JSON.stringify(token)};window.__mobileBackTraversals=0;window.addEventListener('popstate',()=>window.__mobileBackTraversals++)`);
  return token;
}
async function assertSameDocument(token) {
  assert.equal(await evaluate("window.__mobileBackDocument"), token, "Back must restore application state without reloading the document");
  assert.equal(await evaluate("location.origin"), origin, "Back cannot leave the application at its first page");
}
// history.back() traverses the same history as the Android device Back button.
// Controls still receive real coordinate-based touch events through CDP.
async function traverse(direction, expression, label, token) {
  const before = await evaluate("window.__mobileBackTraversals");
  await evaluate(`history.${direction}()`);
  await until(`window.__mobileBackTraversals>${before}`, label + " history event");
  await until(expression, label);
  await pause(150);
  await assertSameDocument(token);
}
async function runMobileBack() {
  let token = await markDocument();
  await traverse("back", pageTitle("Tableau de bord"), "first-page back stays on dashboard", token);
  await navigate("Notes");
  await navigate("Checklists");
  await navigate("Paramètres");
  await traverse("back", pageTitle("Checklists"), "settings back to checklists", token);
  await traverse("back", pageTitle("Notes"), "checklists back to notes", token);
  await traverse("back", pageTitle("Tableau de bord"), "notes back to dashboard", token);
  await traverse("forward", pageTitle("Notes"), "forward to notes", token);
  await traverse("forward", pageTitle("Checklists"), "forward to checklists", token);
  await traverse("forward", pageTitle("Paramètres"), "forward to settings", token);

  await press(element('[data-slot="sidebar-trigger"]'));
  await until("!!document.querySelector('[data-mobile=true][data-state=open]')", "mobile menu open");
  await traverse("back", "!document.querySelector('[data-mobile=true][data-state=open]')", "back closes the mobile menu first", token);
  assert.ok(await evaluate(pageTitle("Paramètres")), "Closing the menu cannot change the current page");
  await press(element('button[aria-label="Notifications"]'));
  await until("!!document.querySelector('[role=dialog][data-state=open]')", "notification dialog open");
  await traverse("back", "!document.querySelector('[role=dialog][data-state=open]')", "back closes the dialog first", token);
  assert.ok(await evaluate(pageTitle("Paramètres")), "Closing a dialog cannot change the current page");

  await navigate("Checklists");
  await select("Checklist affichée", "Prêts pour les vacances");
  await press(checkbox("Chargeurs"));
  await openToiletries();
  await editItem("Dentifrice", "Prêts pour les vacances");
  await press(element('button[aria-label="Ouvrir la checklist Prêts pour les vacances"]'));
  await until(`!!${region("Prêts pour les vacances")}`, "second-level linked checklist");
  await traverse("back", `!!${region("Trousse de toilette")}`, "back restores the first linked checklist", token);
  await traverse("back", `!!${region("Prêts pour les vacances")}`, "back restores the originating checklist", token);
  assert.equal(await evaluate(`${checkbox("Chargeurs")}.getAttribute('aria-checked')`), "true", "Demo changes must survive history traversal without a reload");
  await traverse("forward", `!!${region("Trousse de toilette")}`, "forward restores the linked checklist", token);
  await traverse("back", `!!${region("Prêts pour les vacances")}`, "return before testing the UI Back control", token);
  await navigate("Notes");
  await navigate("Checklists");
  await openToiletries();
  await press(element('.checklist-back-button'));
  await until(`!!${region("Prêts pour les vacances")}`, "checklist UI Back restores its parent");
  await traverse("back", pageTitle("Notes"), "native Back after UI Back has no duplicate parent entry", token);

  await navigate("Contacts");
  await navigate("Paramètres");
  await evaluate("history.back();setTimeout(()=>history.back(),60)");
  await until(pageTitle("Notes"), "two quick Back presses restore the second previous page");
  await assertSameDocument(token);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
  mobile = false;
  await navigate("Contacts");
  await traverse("back", pageTitle("Notes"), "history remains consistent after resizing", token);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  mobile = true;
  await capture("mobile-native-back");
  await cdp.send("Page.reload");
  await until("document.querySelector('.status-grid')?.getAttribute('data-device-pending')==='false'", "dashboard hydrated after reload");
  token = await markDocument();
  await navigate("Notes");
  await traverse("back", pageTitle("Tableau de bord"), "back after reload restores its new root", token);
  await traverse("back", pageTitle("Tableau de bord"), "root guard remains active after reload", token);
  outcomes.push({ scenario: "mobile-device-back", passed: true });
  console.log("PASS mobile device Back: root, pages, forward, overlays, linked checklists, reload and resize");
  // Start the existing checklist flow with pristine demo data after its mutations.
  await cdp.send("Page.reload");
  await until("document.querySelector('.status-grid')?.getAttribute('data-device-pending')==='false'", "pristine demo after Back regression");
}
async function run(mobileMode) {
  mobile = mobileMode;
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: mobile ? 390 : 1280, height: mobile ? 844 : 900, deviceScaleFactor: 1, mobile });
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: mobile, maxTouchPoints: 1 });
  await cdp.send("Page.navigate", { url: origin });
  await until(`!!(${element('[data-slot="sidebar-trigger"]')})`, "hydrated demo");
  await until("document.querySelector('.status-grid')?.getAttribute('data-device-pending')==='false'", "hydrated dashboard");
  if (mobile) await runMobileBack();
  await navigate("Checklists");
  await select("Checklist affichée", "Prêts pour les vacances");
  assert.equal(await evaluate(`${region("Prêts pour les vacances")}.querySelectorAll('.item-row').length`), 3);
  await openToiletries();
  assert.equal(await evaluate(`${checkbox("Brosse à dents")}.getAttribute('aria-checked')`), "false");
  await press(checkbox("Brosse à dents"));
  await editItem("Dentifrice", "Prêts pour les vacances");
  await press(element('button[aria-label="Ouvrir la checklist Prêts pour les vacances"]'));
  await until(`!!${region("Prêts pour les vacances")}`, "nested linked checklist");
  assert.equal(await evaluate(`${element('.checklist-back-button')}.textContent.trim()`), "Retour à Trousse de toilette");
  await press(element('.checklist-back-button'));
  await until(`!!${region("Trousse de toilette")}`, "return from nested linked checklist");
  await capture(mobile ? "mobile-linked-content" : "desktop-linked-content");
  await press(element('.checklist-back-button'));
  assert.equal(await evaluate(`${checkbox("Trousse de toilette")}.getAttribute('aria-checked')`), "false", "Opening a link cannot check its parent item");
  await press(checkbox("Trousse de toilette"));
  await openToiletries();
  assert.equal(await evaluate(`${checkbox("Brosse à dents")}.getAttribute('aria-checked')`), "true");
  assert.equal(await evaluate(`${checkbox("Dentifrice")}.getAttribute('aria-checked')`), "false", "Checking the parent cannot check the linked contents");
  await press(element('.checklist-back-button'));
  await editItem("Chargeurs", "Trousse de toilette", "Ma petite trousse");
  assert.ok(await evaluate(`!!${row("Ma petite trousse")}.querySelector('.linked-checklist-link')`));
  await press(named("Ajouter une checklist liée"));
  await select("Checklist à ouvrir", "Trousse de toilette");
  assert.equal(await evaluate(`${element('[role="dialog"] input[type="text"]')}.value`), "Trousse de toilette", "The linked checklist name prefills the parent item label");
  await replaceInput(element('[role="dialog"] input[type="text"]'), "Trousse secondaire");
  await press(named("Ajouter l’élément", '[role="dialog"] button'));
  assert.equal(await evaluate(`${region("Prêts pour les vacances")}.querySelectorAll('.item-row').length`), 4, "Adding a reference creates one item, without copying contents");
  await editItem("Trousse secondaire", "Aucune");
  assert.equal(await evaluate(`!!${row("Trousse secondaire")}.querySelector('.linked-checklist-link')`), false, "Removing a link preserves the label as a normal item");
  await navigate("Tableau de bord");
  await select("Checklist affichée", "Prêts pour les vacances");
  await press(named("Mode cuisine"));
  await openToiletries();
  assert.equal(await evaluate(`${element('.checklist-back-button')}.textContent.trim()`), "Retour au tableau de bord");
  await press(element('.checklist-back-button'));
  assert.ok(await evaluate(`!!${region("Prêts pour les vacances")}`), "Returning to the kitchen restores its selected checklist");
  assert.ok(await evaluate(`!!${element('.wall-mode')}`), "Following a link preserves kitchen mode");
  await press(named("Quitter le mode cuisine"));
  await navigate("Checklists");
  await select("Checklist affichée", "Trousse de toilette");
  await press(element('button[aria-label="Options des tâches"]'));
  await press(named("Supprimer la liste", '[role="menuitem"]'));
  await press(named("Confirmer", '[role="alertdialog"] button'));
  await select("Checklist affichée", "Prêts pour les vacances");
  assert.equal(await evaluate(`${region("Prêts pour les vacances")}.querySelectorAll('.item-row').length`), 4);
  assert.equal(await evaluate(`!!${region("Prêts pour les vacances")}.querySelector('.linked-checklist-link')`), false, "Deleting a target leaves all parent labels and removes their links");
  await capture(mobile ? "mobile-cleaned-links" : "desktop-cleaned-links");
  outcomes.push({ mode: mobile ? "touch" : "mouse", passed: true });
  console.log("PASS checklist links: " + (mobile ? "touch" : "mouse"));
}

try {
  service = spawn(process.execPath, [".next/standalone/server.js"], { cwd: appDirectory, env: { ...process.env, NODE_ENV: "production", SITE_ORIGIN: origin, HOSTNAME: "127.0.0.1", PORT: String(port), DB_PATH: join(artifacts, "test.sqlite") }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  service.stdout.on("data", data => { serviceLog += data; }); service.stderr.on("data", data => { serviceLog += data; });
  for (let attempt = 0; attempt < 80; attempt++) {
    if (service.exitCode !== null) throw new Error(serviceLog);
    try { if ((await fetch(origin, { signal: AbortSignal.timeout(1000) })).ok) break; } catch {}
    await pause(100);
  }
  browser = spawn(edgePath, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--disable-background-networking", "--no-first-run", "--no-default-browser-check", "about:blank"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  browser.stdout.on("data", data => { browserLog += data; }); browser.stderr.on("data", data => { browserLog += data; });
  const portFile = join(profile, "DevToolsActivePort");
  for (let attempt = 0; attempt < 100 && !existsSync(portFile); attempt++) {
    if (browser.exitCode !== null) throw new Error(browserLog);
    await pause(100);
  }
  assert.ok(existsSync(portFile), "Browser debugging endpoint unavailable");
  const browserPort = readFileSync(portFile, "utf8").split(/\r?\n/)[0];
  const pages = await (await fetch(`http://127.0.0.1:${browserPort}/json/list`, { signal: AbortSignal.timeout(8000) })).json();
  cdp = await connect(pages.find(page => page.type === "page").webSocketDebuggerUrl);
  await cdp.send("Runtime.enable"); await cdp.send("Page.enable");
  await run(false); await run(true);
  assert.equal(errors.length, 0, "No client runtime exceptions");
} catch (error) {
  await capture("failure").catch(() => {});
  if (cdp) {
    const state = await evaluate("({url:location.href,title:document.querySelector('h1')?.textContent,history:history.state,traversals:window.__mobileBackTraversals,documentToken:window.__mobileBackDocument,dialogs:[...document.querySelectorAll('[role=dialog]')].map(e=>e.textContent),body:document.body.innerText})").catch(() => null);
    writeFileSync(join(artifacts, "failure-state.json"), JSON.stringify(state, null, 2));
  }
  writeFileSync(join(artifacts, "failure.txt"), error.stack);
  throw error;
} finally {
  writeFileSync(join(artifacts, "results.json"), JSON.stringify({ outcomes, errors }, null, 2));
  writeFileSync(join(artifacts, "server.log"), serviceLog); writeFileSync(join(artifacts, "edge.log"), browserLog);
  if (cdp) { await cdp.send("Browser.close").catch(() => {}); cdp.ws.close(); }
  if (browser && browser.exitCode === null) {
    await Promise.race([new Promise(done => browser.once("exit", done)), pause(3000)]);
    if (browser.exitCode === null) { browser.kill(); await pause(500); }
  }
  if (service && service.exitCode === null) { service.kill(); await Promise.race([new Promise(done => service.once("exit", done)), pause(3000)]); }
  const resolvedProfile = realpathSync(profile), resolvedArtifacts = realpathSync(artifacts);
  assert.ok(resolvedArtifacts.startsWith(realpathSync(artifactRoot) + sep + "run-"));
  assert.ok(resolvedProfile.startsWith(resolvedArtifacts + sep + "edge-profile-"));
  try { rmSync(resolvedProfile, { recursive: true, force: true }); } catch (error) { console.error("Temporary profile retained: " + error.message); }
  console.log("Browser artifacts: " + artifacts);
}
