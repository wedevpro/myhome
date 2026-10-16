import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Real production app, isolated SQLite database, fictitious account and Edge profile.
const appDirectory = fileURLToPath(new URL("..", import.meta.url));
const artifactRoot = join(appDirectory, ".sites-runtime", "mobile-widget-browser");
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
let service, browser, cdp, serviceLog = "", browserLog = "", cookie = "";
const errors = [], outcomes = [];
const account = { name: "Widget Test", email: "widget-browser@example.test", password: "Widget-fictif-2026-test!" };

async function request(path, data) {
  const response = await fetch(origin + path, { method: data === undefined ? "GET" : "POST", headers: { ...(cookie ? { Cookie: cookie } : {}), ...(data === undefined ? {} : { "Content-Type": "application/json", Origin: origin }) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const value = await response.json();
  assert.ok(response.ok, path + ": " + JSON.stringify(value));
  return value;
}
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
      const item = pending.get(message.id);
      if (!item) return;
      clearTimeout(item.timeout); pending.delete(message.id);
      if (message.error) item.reject(new Error(JSON.stringify(message.error))); else item.resolve(message.result);
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
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if (await evaluate(expression)) return; } catch (error) {
      if (!error.message.includes("context")) throw error;
    }
    await pause(100);
  }
  throw new Error("Timed out: " + label);
}
const element = selector => `document.querySelector(${JSON.stringify(selector)})`;
const named = (text, selector = "button") => `[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(text)}&&e.getClientRects().length)`;
async function press(expression) {
  await until(`!!(${expression})`, expression);
  await evaluate(`(${expression}).scrollIntoView({block:'center',inline:'nearest'})`);
  await pause(100);
  const point = await evaluate(`(()=>{const e=(${expression}),r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);return {x,y,hit:e===hit||e.contains(hit),disabled:e.disabled}})()`);
  assert.ok(point.hit && !point.disabled, "Touch must hit the actual enabled control: " + expression);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: point.x, y: point.y, id: 1, radiusX: 4, radiusY: 4 }] });
  await pause(40);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await pause(200);
}
async function input(selector, value) {
  await press(element(selector));
  await cdp.send("Input.insertText", { text: value });
}
async function capture(name) {
  const result = await cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(artifacts, name + ".png"), Buffer.from(result.data, "base64"));
}
function link(household, list, action = "open", item) {
  const params = new URLSearchParams({ mobileWidget: "1", household, list, action });
  if (item) params.set("item", item);
  return origin + "/?" + params;
}
async function navigate(url) {
  await cdp.send("Page.navigate", { url });
}
async function assertList(name, houseName) {
  await until(`document.querySelector('.list-panel-title')?.textContent===${JSON.stringify(name)}`, "widget list " + name);
  assert.ok(await evaluate(`document.querySelector('.breadcrumb')?.textContent.includes(${JSON.stringify(houseName)})`));
  assert.equal(await evaluate("!!document.querySelector('.wall-mode')"), false, "Widget must open the list outside kitchen mode");
  assert.equal(await evaluate("!!document.querySelector('.status-grid')"), false, "Widget must open a list, not dashboard");
}
async function assertConsumed() {
  assert.equal(await evaluate("new URL(location.href).searchParams.get('action')"), "open");
  assert.equal(await evaluate("new URL(location.href).searchParams.has('item')"), false);
  assert.equal(await evaluate("sessionStorage.getItem('myhome-pending-widget')"), null);
}

try {
  service = spawn(process.execPath, [".next/standalone/server.js"], { cwd: appDirectory, env: { ...process.env, NODE_ENV: "production", SITE_ORIGIN: origin, HOSTNAME: "127.0.0.1", PORT: String(port), DB_PATH: join(artifacts, "test.sqlite") }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  service.stdout.on("data", data => { serviceLog += data; }); service.stderr.on("data", data => { serviceLog += data; });
  let serviceReady = false;
  const startupDeadline = Date.now() + 90000;
  while (Date.now() < startupDeadline) {
    if (service.exitCode !== null) throw new Error(serviceLog);
    try { if ((await fetch(origin + "/api/health", { signal: AbortSignal.timeout(1000) })).ok) { serviceReady = true; break; } } catch {}
    await pause(100);
  }
  assert.ok(serviceReady, "Production server did not start: " + serviceLog);
  await request("/api/auth/signup", account);
  const houseA = (await request("/api/command", { action: "createHousehold", name: "Foyer A — navigateur" })).household;
  let state = await request("/api/command", { action: "createHousehold", name: "Foyer B — widget" });
  const houseB = state.household;
  let shopping = state.entities.find(entity => entity.kind === "shopping");
  let checklist = state.entities.find(entity => entity.kind === "checklist");
  for (const [list, name] of [[shopping, "Courses du widget B"], [checklist, "Checklist du widget B"]]) state = await request("/api/command", { action: "save", householdId: houseB.id, kind: list.kind, id: list.id, expectedRevision: list.revision, data: { ...list.data, name } });
  shopping = state.entities.find(entity => entity.id === shopping.id); checklist = state.entities.find(entity => entity.id === checklist.id);
  for (const [listId, name] of [[shopping.id, "Lait du widget"], [checklist.id, "Préparer la trousse"], [shopping.id, "Pain terminé"]]) state = await request("/api/command", { action: "addItem", householdId: houseB.id, listId, name, saveProduct: false });
  const milk = state.entities.find(entity => entity.data.name === "Lait du widget");
  const task = state.entities.find(entity => entity.data.name === "Préparer la trousse");
  const bread = state.entities.find(entity => entity.data.name === "Pain terminé");
  state = await request("/api/command", { action: "save", householdId: houseB.id, kind: "item", id: bread.id, expectedRevision: bread.revision, data: { ...bread.data, checked: true } });
  const originalB = JSON.stringify((await request("/api/state?household=" + houseB.id)).entities);
  const originalA = JSON.stringify((await request("/api/state?household=" + houseA.id)).entities);
  const unchanged = async () => {
    assert.equal(JSON.stringify((await request("/api/state?household=" + houseB.id)).entities), originalB, "Opening a URL must not mutate the widget household");
    assert.equal(JSON.stringify((await request("/api/state?household=" + houseA.id)).entities), originalA, "Opening a URL must not mutate another household");
  };

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
  await cdp.send("Runtime.enable"); await cdp.send("Page.enable"); await cdp.send("Network.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  const separator = cookie.indexOf("=");
  assert.equal((await cdp.send("Network.setCookie", { name: cookie.slice(0, separator), value: cookie.slice(separator + 1), url: origin + "/", httpOnly: true, secure: false, sameSite: "Lax" })).success, true);
  await navigate(origin);
  await until("!!document.querySelector('.status-grid')", "initial authenticated dashboard");
  await evaluate(`localStorage.setItem('myhome-active-household',${JSON.stringify(houseA.id)})`);
  await navigate(link(houseB.id, shopping.id));
  await assertList(shopping.data.name, houseB.name);
  assert.equal(await evaluate("localStorage.getItem('myhome-active-household')"), houseB.id, "Explicit widget household wins over local storage");
  await unchanged(); outcomes.push("explicit-household");

  for (const [action, item, expected] of [["scan", undefined, "Scanner un produit"], ["edit", milk.id, "Modifier l’article"], ["delete", milk.id, "Supprimer Lait du widget ?"], ["clearCompleted", undefined, "Supprimer les éléments terminés ?"]]) {
    await navigate(link(houseB.id, shopping.id, action, item));
    await assertList(shopping.data.name, houseB.name);
    await until(`!!${named(expected, '[role="dialog"] h2,[role="alertdialog"] h2')}`, action + " opens the targeted dialog");
    await assertConsumed(); await unchanged();
    if (action === "edit") {
      assert.ok(await evaluate("document.querySelector('[role=dialog]')?.textContent.includes('Lait du widget')"));
      await capture("mobile-widget-edit");
    }
    await cdp.send("Page.reload");
    await assertList(shopping.data.name, houseB.name);
    await pause(2800);
    assert.equal(await evaluate("!!document.querySelector('[role=dialog],[role=alertdialog]')"), false, "Reload must not reopen consumed " + action);
    await unchanged(); outcomes.push(action + "-once");
  }
  await navigate(link(houseB.id, shopping.id, "add"));
  await assertList(shopping.data.name, houseB.name);
  await until("document.activeElement?.getAttribute('aria-label')==='Ajouter un produit'", "add focuses the correct input");
  await assertConsumed(); await unchanged(); outcomes.push("add-focus");
  await navigate(link(houseB.id, checklist.id, "add"));
  await assertList(checklist.data.name, houseB.name);
  await until("document.activeElement?.getAttribute('aria-label')==='Ajouter une tâche'", "add focuses checklist input");
  await assertConsumed(); await unchanged(); outcomes.push("checklist-add-focus");
  await navigate(link(houseB.id, checklist.id, "edit", task.id));
  await assertList(checklist.data.name, houseB.name);
  await until("document.querySelector('[role=dialog] input[type=text]')?.value==='Préparer la trousse'", "checklist edit targets its own element");
  await assertConsumed(); await unchanged(); outcomes.push("checklist-edit");

  await navigate(link("missing-household", shopping.id));
  await until("document.querySelector('.intro-card [role=alert]')?.textContent.includes('foyer')", "inaccessible household is reported");
  assert.equal(await evaluate("!!document.querySelector('.list-panel-title,.status-grid')"), false, "Invalid household must not fall back to another list");
  await capture("mobile-widget-inaccessible"); await unchanged(); outcomes.push("inaccessible-household");
  await navigate(link(houseB.id, shopping.id, "edit", task.id));
  await until("document.querySelector('.intro-card [role=alert]')?.textContent.includes('élément')", "item from another list is rejected");
  assert.equal(await evaluate("!!document.querySelector('[role=dialog],.list-panel-title')"), false);
  await unchanged(); outcomes.push("wrong-item-rejected");

  await cdp.send("Network.clearBrowserCookies");
  await navigate(link(houseB.id, shopping.id, "edit", milk.id));
  await until(`!!${named("Se connecter", "a")}`, "login required before widget destination");
  assert.ok(await evaluate("!!sessionStorage.getItem('myhome-pending-widget')"));
  await press(named("Se connecter", "a"));
  await until("location.pathname==='/connexion'&&!!document.querySelector('input[name=email]')", "login form");
  await input('input[name="email"]', account.email); await input('input[name="password"]', account.password);
  await press(named("Se connecter", "button"));
  await assertList(shopping.data.name, houseB.name);
  await until("document.querySelector('[role=dialog]')?.textContent.includes('Lait du widget')", "login resumes requested editor");
  await assertConsumed(); await unchanged(); await capture("mobile-widget-login-resumed"); outcomes.push("login-resumed");
  await cdp.send("Page.reload"); await assertList(shopping.data.name, houseB.name); await pause(300);
  assert.equal(await evaluate("!!document.querySelector('[role=dialog],[role=alertdialog]')"), false);
  assert.equal(errors.length, 0, "No client runtime exceptions");
  console.log("PASS mobile widget links: household selection, scan/edit/delete without mutation, action consumption, reload, add focus, checklist edit, access checks and login resume");
} catch (error) {
  if (cdp) {
    await capture("failure").catch(() => {});
    const state = await evaluate("({url:location.href,title:document.querySelector('h1')?.textContent,activeElement:document.activeElement?.outerHTML,dialogs:[...document.querySelectorAll('[role=dialog],[role=alertdialog]')].map(e=>e.textContent),body:document.body.innerText})").catch(() => null);
    writeFileSync(join(artifacts, "failure-state.json"), JSON.stringify(state, null, 2));
  }
  writeFileSync(join(artifacts, "failure.txt"), error.stack); throw error;
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
