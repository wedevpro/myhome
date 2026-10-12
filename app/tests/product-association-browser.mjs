import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

// A browser regression test, intentionally separate from npm test and API smoke.
// Usage: node tests/product-association-browser.mjs (optional EDGE_PATH override).
const appDirectory = fileURLToPath(new URL("..", import.meta.url));
assert.match(readFileSync(join(appDirectory, ".gitignore"), "utf8"), /^\/\.sites-runtime\/$/m);
const artifactRoot = join(appDirectory, ".sites-runtime", "product-association-browser");
mkdirSync(artifactRoot, { recursive: true });
const resolvedRoot = realpathSync(artifactRoot);
assert.ok(resolvedRoot.startsWith(realpathSync(appDirectory) + sep));
const artifacts = mkdtempSync(join(resolvedRoot, "run-"));
const profile = mkdtempSync(join(artifacts, "edge-profile-"));
const edgePath = process.env.EDGE_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
assert.ok(existsSync(edgePath), "Edge executable missing; set EDGE_PATH to an installed Chromium browser");
const cssDirectory = join(appDirectory, ".next", "static", "css");
const cssFiles = readdirSync(cssDirectory).filter(name => name.endsWith(".css"));
assert.ok(cssFiles.length, "Compile production CSS before running this isolated browser test");
const css = cssFiles.map(name => readFileSync(join(cssDirectory, name), "utf8")).join("\n");
const bundle = await build({
  absWorkingDir: appDirectory,
  entryPoints: ["tests/fixtures/product-association.tsx"],
  bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  tsconfig: join(appDirectory, "tsconfig.json"),
  // Optional source snapshot allows checking the regression against a prior version.
  alias: process.env.PRODUCT_ASSOCIATION_PICKER_SOURCE ? {
    "@/components/product-association-picker": resolve(appDirectory, process.env.PRODUCT_ASSOCIATION_PICKER_SOURCE),
  } : undefined,
});
const javascript = bundle.outputFiles[0].text;
writeFileSync(join(artifacts, "fixture.js"), javascript);
const html = '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Product association regression</title><link rel="stylesheet" href="/production.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>';
const server = createServer((request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  const content = path === "/fixture.js" ? javascript : path === "/production.css" ? css : path === "/" ? html : undefined;
  response.writeHead(content === undefined ? 404 : 200, { "Content-Type": path === "/fixture.js" ? "text/javascript" : path === "/production.css" ? "text/css" : "text/html", "Cache-Control": "no-store" });
  response.end(content || "Not found");
});
await new Promise(done => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const pause = milliseconds => new Promise(done => setTimeout(done, milliseconds));
const results = [], browserErrors = [];
let browser, cdp, browserLog = "";

async function connect(url) {
  const socket = new WebSocket(url), pending = new Map();
  let nextId = 0;
  await new Promise((done, reject) => {
    const timeout = setTimeout(() => { socket.close(); reject(new Error("Edge WebSocket connection timed out")); }, 8000);
    socket.addEventListener("open", () => { clearTimeout(timeout); done(); }, { once: true });
    socket.addEventListener("error", error => { clearTimeout(timeout); reject(error); }, { once: true });
  });
  socket.addEventListener("message", event => {
    const message = JSON.parse(String(event.data));
    if (message.id) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id); clearTimeout(request.timeout);
      if (message.error) request.reject(new Error(JSON.stringify(message.error))); else request.resolve(message.result);
    } else if (message.method === "Runtime.exceptionThrown" || message.method === "Log.entryAdded" || message.method === "Runtime.consoleAPICalled") {
      browserErrors.push(message);
    }
  });
  return {
    socket,
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++nextId;
        const timeout = setTimeout(() => { pending.delete(id); reject(new Error("CDP timeout: " + method)); }, 8000);
        pending.set(id, { resolve, reject, timeout }); socket.send(JSON.stringify({ id, method, params }));
      });
    },
  };
}
async function evaluate(expression) {
  const response = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return response.result.value;
}
async function until(expression, label) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const value = await evaluate(expression);
    if (value) return value;
    await pause(50);
  }
  throw new Error("Timed out waiting for " + label);
}
async function screenshot(name) {
  const capture = await cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(artifacts, name + ".png"), Buffer.from(capture.data, "base64"));
}
async function move(x, y) { await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }); }
async function click(x, y) {
  await move(x, y);
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}
const geometry = `(selector) => {
  const element = document.querySelector(selector); if (!element) return null;
  const rect = element.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, scrollTop: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight };
}`;
async function bounds(selector) { return evaluate(`(${geometry})(${JSON.stringify(selector)})`); }
async function option(index) {
  return evaluate(`(() => {
    const expected = ${JSON.stringify(`Produit ${String(index).padStart(3, "0")} Famille ${Math.floor(index / 20)}`)};
    const element = [...document.querySelectorAll('[role="option"]')].find(option => option.textContent.includes(expected));
    if (!element) return null;
    const rect = element.getBoundingClientRect(), x = rect.x + rect.width / 2, y = rect.y + rect.height / 2;
    const hit = document.elementFromPoint(x, y)?.closest('[role="option"]');
    return { text: element.textContent, x, y, height: rect.height, visible: x > 0 && x < innerWidth && y > 0 && y < innerHeight && hit === element, hit: hit?.textContent || null };
  })()`);
}
async function wheel(x, y, deltaY) {
  await move(x, y);
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY });
  await pause(180);
}
async function touch(type, x, y) {
  await cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }] });
}
async function tap(x, y) { await touch("touchStart", x, y); await pause(50); await touch("touchEnd", x, y); }
async function key(key, code, virtualKeyCode) {
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: virtualKeyCode });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: virtualKeyCode });
}
async function swipe(x, y, deltaY) {
  await touch("touchStart", x, y);
  for (let step = 1; step <= 15; step++) { await touch("touchMove", x, y - deltaY * step / 15); await pause(16); }
  await touch("touchEnd", x, y - deltaY); await pause(350);
}
async function runScenario({ name, index, filter = "", collision = false, scroll = false, mobile = false, compatibilityRelease = false, keyboard = false }) {
  const height = mobile ? 844 : 720;
  const result = { scenario: name, expectedId: `fixture-product-${String(index).padStart(3, "0")}`, filter, collision, mobile, trace: [] };
  results.push(result);
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: mobile ? 390 : 1024, height, deviceScaleFactor: 1, mobile });
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: mobile, maxTouchPoints: 1 });
  await cdp.send("Page.navigate", { url: origin + (collision ? "/?collision=1" : "/") });
  await until(`!!document.querySelector('input[aria-label="Nom du produit"]')`, "fixture input");
  await pause(300);
  await evaluate(`window.__pointerLog = []; for (const type of ['touchstart','touchmove','touchend','touchcancel','pointerdown','pointermove','pointerup','pointercancel','mousedown','mousemove','mouseup','click']) document.addEventListener(type, event => {
    const point = event.changedTouches?.[0] || event;
    const target = event.target.closest?.('[role="option"]');
    const highlighted = document.querySelector('[role="option"][data-highlighted], [role="option"][aria-selected="true"]');
    const id = element => element?.textContent.match(/Produit (\\d{3})/)?.[1] || null;
    window.__pointerLog.push({ type, time: event.timeStamp, pointerType: event.pointerType, trusted: event.isTrusted, x: point.clientX, y: point.clientY, option: target?.textContent || null, targetId: id(target), highlightedId: id(highlighted), listScrollTop: document.querySelector('[data-slot="combobox-list"], [role="listbox"]')?.scrollTop, dialogScrollTop: document.querySelector('[data-test="fixture-dialog"]')?.scrollTop, selectedId: document.querySelector('[data-test="selected-id"]')?.textContent });
  }, { capture: true, passive: true });`);
  result.emulation = await evaluate(`({ width: innerWidth, height: innerHeight, touchPoints: navigator.maxTouchPoints, coarsePointer: matchMedia('(pointer: coarse)').matches })`);
  if (mobile) assert.ok(result.emulation.touchPoints > 0 && result.emulation.coarsePointer, "Mobile scenarios must use touch emulation");
  if (collision) {
    for (let attempt = 0; attempt < 12; attempt++) {
      const input = await bounds('input[aria-label="Nom du produit"]'), dialog = await bounds('[data-test="fixture-dialog"]');
      const y = input.y + input.height / 2;
      if (y > dialog.y + 20 && y < dialog.y + dialog.height - 30) break;
      const delta = Math.max(-240, Math.min(240, y - (dialog.y + dialog.height / 2)));
      if (mobile) await swipe(dialog.x + dialog.width - 30, delta > 0 ? dialog.y + dialog.height - 30 : dialog.y + 30, delta);
      else await wheel(dialog.x + dialog.width - 30, dialog.y + dialog.height / 2, delta);
    }
  }
  const input = await bounds('input[aria-label="Nom du produit"]');
  const inputPoint = { x: input.x + input.width / 2, y: input.y + input.height / 2 };
  assert.equal(await evaluate(`document.elementFromPoint(${inputPoint.x},${inputPoint.y})?.closest('input')?.getAttribute('aria-label')`), "Nom du produit", "Input click must land inside the real dialog");
  if (mobile) await tap(inputPoint.x, inputPoint.y); else await click(inputPoint.x, inputPoint.y);
  if (filter) await cdp.send("Input.insertText", { text: filter });
  await until(`!!document.querySelector('[role="option"]')`, "suggestions");
  await pause(250);
  const listSelector = '[data-slot="combobox-list"], [role="listbox"]';
  const initialList = await bounds(listSelector), initialDialog = await bounds('[data-test="fixture-dialog"]');
  result.initialList = initialList; result.initialDialog = initialDialog;
  let target = await option(index);
  assert.ok(target, "Target product must be rendered among suggestions");
  if (scroll) {
    assert.equal(target.visible, false, "Scrolled scenario must target a product outside the initial viewport");
    assert.ok(initialList.scrollHeight > initialList.clientHeight, "Real production CSS must create a scrollable suggestions list");
    for (let attempt = 0; attempt < 30 && !target.visible; attempt++) {
      const list = await bounds(listSelector), dialog = await bounds('[data-test="fixture-dialog"]');
      const top = Math.max(list.y, dialog.y, 0) + 5, bottom = Math.min(list.y + list.height, dialog.y + dialog.height, height) - 5;
      assert.ok(bottom > top, "Suggestions must have a visible scroll region inside the dialog");
      const x = list.x + list.width / 2, y = (top + bottom) / 2;
      const limit = mobile ? Math.min(240, bottom - top - 30) : 300;
      const delta = Math.max(-limit, Math.min(limit, target.y - y));
      if (mobile) await swipe(x, delta > 0 ? bottom - 10 : top + 10, delta); else await wheel(x, y, delta);
      target = await option(index);
      result.trace.push({ list: await bounds(listSelector), dialog: await bounds('[data-test="fixture-dialog"]'), target });
      assert.ok(target, "Scrolling must not close the suggestions before a deliberate selection");
      assert.equal(await evaluate(`document.querySelector('[data-test="selected-id"]').textContent`), "", "Each scrolling gesture must leave the selection empty");
    }
    assert.ok(target.visible, "User scrolling must bring the intended product into view");
    assert.ok((await bounds(listSelector)).scrollTop > initialList.scrollTop, "User scrolling must scroll suggestions, not just the outer dialog");
    assert.equal(await evaluate(`document.querySelector('[data-test="selected-id"]').textContent`), "", "Scrolling alone must not select a product");
  }
  if (compatibilityRelease) {
    // Some touch browsers deliver compatibility mouse events after a gesture.
    // A release without a new press must not select a row or close suggestions.
    await move(target.x, target.y);
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: target.x, y: target.y, button: "left", clickCount: 1 });
    await pause(100);
    result.afterCompatibilityRelease = await evaluate(`({ selectedId: document.querySelector('[data-test="selected-id"]').textContent, open: !!document.querySelector('[role="option"]'), pointerLog: window.__pointerLog })`);
    assert.equal(result.afterCompatibilityRelease.selectedId, "", "A compatibility mouse release after touch scrolling must not select a product");
    assert.ok(result.afterCompatibilityRelease.open, "A compatibility mouse release must leave suggestions open");
    target = await option(index);
  }
  assert.ok(target.visible, "The expected product must be under the pointer before mousedown");
  if (!mobile) { await move(target.x, target.y); await pause(80); }
  target = await option(index);
  assert.ok(target.visible, "Pointer movement must not change the intended hit target");
  result.beforeMouseDown = target;
  await screenshot(name + "-before");
  if (keyboard) await key("ArrowDown", "ArrowDown", 40);
  else if (mobile) await touch("touchStart", target.x, target.y);
  else await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: target.x, y: target.y, button: "left", clickCount: 1 });
  result.beforeMouseUp = await evaluate(`({ hit: document.elementFromPoint(${target.x}, ${target.y})?.closest('[role="option"]')?.textContent || null, selectedId: document.querySelector('[data-test="selected-id"]')?.textContent, name: document.querySelector('[data-test="selected-name"]')?.textContent })`);
  if (keyboard) await key("Enter", "Enter", 13);
  else if (mobile) { await pause(50); await touch("touchEnd", target.x, target.y); }
  else await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: target.x, y: target.y, button: "left", clickCount: 1 });
  await pause(250);
  result.observed = await evaluate(`({ selectedId: document.querySelector('[data-test="selected-id"]')?.textContent, name: document.querySelector('[data-test="selected-name"]')?.textContent, pointerLog: window.__pointerLog, selections: JSON.parse(document.querySelector('[data-test="selection-trace"]')?.textContent || '[]') })`);
  await screenshot(name + "-after");
  assert.equal(result.observed.selectedId, result.expectedId, "Clicked product ID must match the actual visible option: " + name);
  assert.equal(result.observed.name, `Produit ${String(index).padStart(3, "0")} Famille ${Math.floor(index / 20)}`, "Selected name must match the clicked product");
  if (keyboard) assert.equal(await evaluate(`document.querySelector('[data-test="submissions"]').textContent`), "0", "Enter selecting a suggestion must not submit the form");
  result.passed = true;
}

try {
  browser = spawn(edgePath, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--disable-background-networking", "--no-first-run", "--no-default-browser-check", "--window-size=1024,720", "about:blank"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  browser.stdout.on("data", value => { browserLog += value; }); browser.stderr.on("data", value => { browserLog += value; });
  let spawnError;
  browser.on("error", error => { spawnError = error; });
  const portFile = join(profile, "DevToolsActivePort");
  for (let attempt = 0; attempt < 100 && !existsSync(portFile); attempt++) {
    if (spawnError) throw spawnError;
    if (browser.exitCode !== null) throw new Error("Edge exited before debugging became available: " + browserLog);
    await pause(150);
  }
  assert.ok(existsSync(portFile), "Edge debugging endpoint unavailable: " + browserLog);
  const debuggingPort = readFileSync(portFile, "utf8").split(/\r?\n/)[0];
  const targets = await (await fetch(`http://127.0.0.1:${debuggingPort}/json/list`, { signal: AbortSignal.timeout(8000) })).json();
  const page = targets.find(target => target.type === "page");
  assert.ok(page?.webSocketDebuggerUrl, "Edge did not create a page target");
  cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable"); await cdp.send("Page.enable"); await cdp.send("Log.enable");
  const failures = [];
  for (const scenario of [
    { name: "no-scroll", index: 2 },
    { name: "wheel-scroll", index: 40, scroll: true },
    { name: "filter-wheel-scroll", index: 75, filter: "Famille 3", scroll: true },
    { name: "dialog-and-wheel-scroll", index: 40, collision: true, scroll: true },
    { name: "touch-no-scroll", index: 2, mobile: true },
    { name: "touch-scroll", index: 40, mobile: true, scroll: true },
    { name: "touch-filter-scroll", index: 75, filter: "Famille 3", mobile: true, scroll: true },
    { name: "touch-dialog-scroll", index: 40, collision: true, mobile: true, scroll: true },
    { name: "touch-scroll-compatibility-release", index: 40, mobile: true, scroll: true, compatibilityRelease: true },
    { name: "keyboard-selection", index: 60, filter: "Famille 3", keyboard: true },
  ].filter(scenario => !process.env.BROWSER_SCENARIO || scenario.name === process.env.BROWSER_SCENARIO)) {
    try { await runScenario(scenario); console.log("PASS " + scenario.name); }
    catch (error) {
      failures.push({ scenario: scenario.name, error: error.stack }); results.at(-1).error = error.stack;
      results.at(-1).failureState = await evaluate(`({ selectedId: document.querySelector('[data-test="selected-id"]')?.textContent, name: document.querySelector('[data-test="selected-name"]')?.textContent, pointerLog: window.__pointerLog, selections: document.querySelector('[data-test="selection-trace"]')?.textContent })`).catch(() => null);
      await screenshot(scenario.name + "-failure").catch(() => {}); console.error("FAIL " + scenario.name + ": " + error.message);
    }
  }
  assert.ok(results.length > 0, "No browser scenario matched BROWSER_SCENARIO");
  assert.equal(failures.length, 0, JSON.stringify(failures, null, 2));
  assert.equal(browserErrors.filter(event => event.method === "Runtime.exceptionThrown").length, 0, "The fixture must not throw browser runtime errors");
} finally {
  writeFileSync(join(artifacts, "results.json"), JSON.stringify({ results, browserErrors, cssFiles, fixture: relative(appDirectory, fileURLToPath(new URL("fixtures/product-association.tsx", import.meta.url))) }, null, 2));
  writeFileSync(join(artifacts, "edge.log"), browserLog);
  if (cdp) { await cdp.send("Browser.close").catch(() => {}); cdp.socket.close(); }
  if (browser && browser.exitCode === null) { await Promise.race([new Promise(done => browser.once("exit", done)), pause(2000)]); if (browser.exitCode === null) browser.kill(); }
  await new Promise(done => server.close(done));
  const resolvedProfile = realpathSync(profile), resolvedArtifacts = realpathSync(artifacts);
  assert.equal(resolve(resolvedArtifacts), resolve(artifacts));
  assert.ok(resolvedArtifacts.startsWith(resolvedRoot + sep + "run-"));
  assert.ok(resolvedProfile.startsWith(resolvedArtifacts + sep + "edge-profile-") && relative(resolvedArtifacts, resolvedProfile).split(sep).length === 1, "Refusing cleanup outside this test's temporary Edge profile");
  try { rmSync(resolvedProfile, { recursive: true, force: true }); } catch (error) { console.error("Temporary profile retained: " + error.message); }
  console.log("Browser test artifacts: " + artifacts);
}
