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
async function checkChecklistOrdering({ admin, member, outsider, command, household, shoppingList, adminId, memberId }) {
  const expectStatus = (response, status, label) => assert.equal(response.status, status, `${label}: ${JSON.stringify(response.json)}`);
  const findChecklist = state => state.entities.find(entity => entity.id === checklist.id);
  const ownItems = state => state.entities.filter(entity => entity.kind === "item" && entity.data.listId === checklist.id);
  const memberCommand = data => member("/api/command", { householdId: household.id, ...data });
  let response = await command({ action: "save", kind: "checklist", data: { name: "Voyage de test", icon: "plane", reusable: true } });
  expectStatus(response, 200, "Create reusable checklist");
  let checklist = response.json.entities.find(entity => entity.kind === "checklist" && entity.data.name === "Voyage de test");
  const originalAudit = { createdBy: checklist.createdBy, createdAt: checklist.createdAt };
  const names = ["Passeport", "Chargeur", "Billet"];
  for (const name of names) {
    response = await command({ action: "addItem", listId: checklist.id, name });
    expectStatus(response, 200, "Add checklist item " + name);
  }
  const items = names.map(name => ownItems(response.json).find(item => item.data.name === name));
  const originalIds = items.map(item => item.id);
  checklist = findChecklist(response.json);
  const originalRevision = checklist.revision;
  const firstOrder = [originalIds[2], originalIds[0], originalIds[1]];
  response = await command({ action: "reorderChecklist", listId: checklist.id, itemIds: firstOrder, expectedRevision: checklist.revision });
  expectStatus(response, 200, "Persist checklist order");
  checklist = findChecklist(response.json);
  assert.deepEqual(checklist.data.itemOrder, firstOrder);
  assert.notEqual(checklist.revision, originalRevision);
  assert.equal(checklist.updatedBy, adminId);
  assert.deepEqual({ createdBy: checklist.createdBy, createdAt: checklist.createdAt }, originalAudit);
  assert.deepEqual(ownItems(response.json).map(item => item.data.name).sort(), [...names].sort());

  // Saving the public form must preserve the order owned by the reorder action.
  response = await command({ action: "save", kind: "checklist", id: checklist.id, expectedRevision: checklist.revision, data: { name: "Voyage renommé", icon: "plane", reusable: true, itemOrder: originalIds } });
  expectStatus(response, 200, "Rename preserves checklist order");
  checklist = findChecklist(response.json);
  assert.equal(checklist.data.name, "Voyage renommé");
  assert.deepEqual(checklist.data.itemOrder, firstOrder);
  const checkedItem = ownItems(response.json).find(item => item.id === originalIds[0]);
  response = await command({ action: "save", kind: "item", id: checkedItem.id, expectedRevision: checkedItem.revision, data: { ...checkedItem.data, checked: true } });
  expectStatus(response, 200, "Check reusable checklist item");
  assert.equal(ownItems(response.json).find(item => item.id === checkedItem.id).data.checked, true);
  response = await command({ action: "reset", listId: checklist.id });
  expectStatus(response, 200, "Reset preserves checklist order");
  checklist = findChecklist(response.json);
  assert.deepEqual(checklist.data.itemOrder, firstOrder);
  assert.ok(ownItems(response.json).every(item => item.data.checked === false));

  const beforeRejected = ownItems(response.json).map(item => ({ id: item.id, data: item.data, revision: item.revision }));
  const shoppingItems = response.json.entities.filter(item => item.kind === "item" && item.data.listId === shoppingList.id);
  const foreignId = shoppingItems[0].id;
  for (const [data, expected, label] of [
    [{ itemIds: originalIds }, 409, "Missing revision"],
    [{ itemIds: originalIds, expectedRevision: originalRevision }, 409, "Stale revision"],
    [{ itemIds: [originalIds[0], originalIds[0], originalIds[2]], expectedRevision: checklist.revision }, 400, "Duplicate item IDs"],
    [{ itemIds: originalIds.slice(0, 2), expectedRevision: checklist.revision }, 409, "Incomplete permutation"],
    [{ itemIds: [originalIds[0], originalIds[1], foreignId], expectedRevision: checklist.revision }, 409, "Item from another list"],
    [{ itemIds: [...originalIds, foreignId], expectedRevision: checklist.revision }, 409, "Extra item ID"],
  ]) {
    response = await command({ action: "reorderChecklist", listId: checklist.id, ...data });
    expectStatus(response, expected, label);
  }
  response = await command({ action: "reorderChecklist", listId: shoppingList.id, itemIds: shoppingItems.map(item => item.id), expectedRevision: shoppingList.revision });
  expectStatus(response, 400, "Shopping lists cannot use checklist ordering");
  response = await outsider("/api/command", { action: "reorderChecklist", householdId: household.id, listId: checklist.id, itemIds: originalIds, expectedRevision: checklist.revision });
  expectStatus(response, 403, "Non-member cannot reorder household checklist");
  response = await member("/api/state?household=" + household.id);
  expectStatus(response, 200, "Checklist shared with member");
  assert.deepEqual(findChecklist(response.json).data.itemOrder, firstOrder);
  assert.equal(findChecklist(response.json).revision, checklist.revision);
  assert.deepEqual(ownItems(response.json).map(item => ({ id: item.id, data: item.data, revision: item.revision })), beforeRejected, "Rejected operations leave tasks intact");

  // A concurrent addition invalidates an otherwise current list revision's item set.
  response = await command({ action: "addItem", listId: checklist.id, name: "Sac" });
  expectStatus(response, 200, "Add item after recording order");
  checklist = findChecklist(response.json);
  const addedItem = ownItems(response.json).find(item => item.data.name === "Sac");
  assert.deepEqual(checklist.data.itemOrder, firstOrder, "New task does not discard stored order");
  response = await memberCommand({ action: "reorderChecklist", listId: checklist.id, itemIds: firstOrder, expectedRevision: checklist.revision });
  expectStatus(response, 409, "Stale item set after addition");
  const orderWithNewItem = [addedItem.id, ...firstOrder];
  response = await memberCommand({ action: "reorderChecklist", listId: checklist.id, itemIds: orderWithNewItem, expectedRevision: checklist.revision });
  expectStatus(response, 200, "Household member can reorder");
  checklist = findChecklist(response.json);
  assert.deepEqual(checklist.data.itemOrder, orderWithNewItem);
  assert.equal(checklist.updatedBy, memberId);
  response = await command({ action: "delete", id: addedItem.id, expectedRevision: addedItem.revision });
  expectStatus(response, 200, "Delete previously ordered item");
  checklist = findChecklist(response.json);
  assert.equal(ownItems(response.json).length, originalIds.length);
  response = await memberCommand({ action: "reorderChecklist", listId: checklist.id, itemIds: orderWithNewItem, expectedRevision: checklist.revision });
  expectStatus(response, 409, "Stale item set after deletion");
  const finalOrder = [originalIds[1], originalIds[2], originalIds[0]];
  response = await memberCommand({ action: "reorderChecklist", listId: checklist.id, itemIds: finalOrder, expectedRevision: checklist.revision });
  expectStatus(response, 200, "Reorder remaining tasks after deletion");
  checklist = findChecklist(response.json);
  assert.equal(checklist.updatedBy, memberId);
  assert.deepEqual(checklist.data.itemOrder, finalOrder);
  assert.deepEqual(ownItems(response.json).map(item => item.data.name).sort(), [...names].sort());
  assert.ok(ownItems(response.json).every(item => item.data.checked === false));

  response = await outsider("/api/command", { action: "createHousehold", name: "Other checklist household" });
  expectStatus(response, 200, "Create isolated household");
  const otherHousehold = response.json.household;
  const otherChecklist = response.json.entities.find(item => item.kind === "checklist");
  response = await outsider("/api/command", { action: "addItem", householdId: otherHousehold.id, listId: otherChecklist.id, name: "Tâche privée" });
  expectStatus(response, 200, "Add foreign household task");
  const otherItem = response.json.entities.find(item => item.kind === "item" && item.data.listId === otherChecklist.id);
  response = await command({ action: "reorderChecklist", listId: checklist.id, itemIds: [originalIds[0], originalIds[1], otherItem.id], expectedRevision: checklist.revision });
  expectStatus(response, 409, "Foreign household item rejected");
  response = await command({ action: "reorderChecklist", listId: otherChecklist.id, itemIds: [otherItem.id], expectedRevision: otherChecklist.revision });
  expectStatus(response, 404, "Foreign household list is inaccessible");
  response = await admin("/api/state?household=" + household.id);
  expectStatus(response, 200, "Administrator sees member order");
  assert.deepEqual(findChecklist(response.json).data.itemOrder, finalOrder);
  assert.equal(findChecklist(response.json).updatedBy, memberId);
  assert.deepEqual({ createdBy: findChecklist(response.json).createdBy, createdAt: findChecklist(response.json).createdAt }, originalAudit);
  return { id: checklist.id, itemOrder: finalOrder, itemIds: originalIds, updatedBy: memberId };
}
async function checkShoppingItemEdits({ admin, member, outsider, command, household, shoppingList, productId, memberId }) {
  const expectStatus = (response, status, label) => assert.equal(response.status, status, `${label}: ${JSON.stringify(response.json)}`);
  let response = await admin("/api/state?household=" + household.id);
  expectStatus(response, 200, "Read shopping items before editing");
  const relatedItems = response.json.entities.filter(entity => entity.kind === "item" && entity.data.listId === shoppingList.id && entity.data.productId === productId);
  assert.equal(relatedItems.length, 2);
  let item = relatedItems[0];
  const sibling = relatedItems[1], product = response.json.entities.find(entity => entity.id === productId);
  const originalRevision = item.revision, originalAudit = { createdBy: item.createdBy, createdAt: item.createdAt };
  const findItem = state => state.entities.find(entity => entity.id === item.id);
  const assertUnrelatedUnchanged = state => {
    assert.deepEqual(state.entities.find(entity => entity.id === sibling.id), sibling, "Another item using the same product is unchanged");
    assert.deepEqual(state.entities.find(entity => entity.id === productId), product, "Catalog product is unchanged");
  };
  const initialComment = "Sans lactose, si possible.\nFormat familial.";
  response = await command({ action: "save", kind: "item", id: item.id, expectedRevision: item.revision, data: { ...item.data, quantity: 2.5, comment: initialComment } });
  expectStatus(response, 200, "Edit item quantity and comment");
  item = findItem(response.json);
  assert.equal(item.data.quantity, 2.5);
  assert.equal(item.data.comment, initialComment);
  assert.notEqual(item.revision, originalRevision);
  assert.equal(item.data.productId, productId);
  assert.equal(item.data.listId, shoppingList.id);
  assert.deepEqual({ createdBy: item.createdBy, createdAt: item.createdAt }, originalAudit);
  assertUnrelatedUnchanged(response.json);
  response = await member("/api/state?household=" + household.id);
  expectStatus(response, 200, "Item edits shared with household member");
  assert.equal(findItem(response.json).data.quantity, 2.5);
  assert.equal(findItem(response.json).data.comment, initialComment);

  response = await command({ action: "save", kind: "item", id: item.id, expectedRevision: item.revision, data: { ...item.data, checked: true } });
  expectStatus(response, 200, "Checking an item preserves its comment");
  item = findItem(response.json);
  assert.equal(item.data.checked, true);
  assert.equal(item.data.comment, initialComment);
  assert.equal(item.data.quantity, 2.5);
  response = await command({ action: "save", kind: "item", id: item.id, expectedRevision: item.revision, data: { ...item.data, comment: "" } });
  expectStatus(response, 200, "Clear item comment");
  item = findItem(response.json);
  assert.equal(item.data.comment, "");
  assert.equal(item.data.checked, true);
  assert.equal(item.data.quantity, 2.5);
  const finalComment = "Pour le petit-déjeuner partagé.\nPrendre le grand format.";
  response = await member("/api/command", { householdId: household.id, action: "save", kind: "item", id: item.id, expectedRevision: item.revision, data: { ...item.data, quantity: 3.75, comment: finalComment, checked: false } });
  expectStatus(response, 200, "Simple member can edit shopping item");
  item = findItem(response.json);
  assert.equal(item.updatedBy, memberId);
  assert.equal(item.data.quantity, 3.75);
  assert.equal(item.data.comment, finalComment);
  assert.deepEqual({ createdBy: item.createdBy, createdAt: item.createdAt }, originalAudit);
  assertUnrelatedUnchanged(response.json);
  const latest = item;

  response = await command({ action: "save", kind: "item", id: item.id, expectedRevision: originalRevision, data: { ...item.data, quantity: 9, comment: "Ancienne version" } });
  expectStatus(response, 409, "Stale item revision cannot overwrite member edits");
  for (const [changes, label] of [
    [{ quantity: 0, comment: "Ne doit pas être enregistré" }, "Zero quantity rejected"],
    [{ quantity: -1 }, "Negative quantity rejected"],
    [{ quantity: 10001 }, "Quantity above limit rejected"],
    [{ comment: "a".repeat(2001), quantity: 8 }, "Oversized comment rejected"],
  ]) {
    response = await command({ action: "save", kind: "item", id: item.id, expectedRevision: item.revision, data: { ...item.data, ...changes } });
    expectStatus(response, 400, label);
  }
  response = await outsider("/api/command", { householdId: household.id, action: "save", kind: "item", id: item.id, expectedRevision: item.revision, data: { ...item.data, quantity: 7, comment: "Interdit" } });
  expectStatus(response, 403, "Non-member cannot edit shopping item");
  response = await admin("/api/state?household=" + household.id);
  expectStatus(response, 200, "Read item after rejected edits");
  assert.deepEqual(findItem(response.json), latest, "Rejected saves leave item data, revision and audit unchanged");
  assertUnrelatedUnchanged(response.json);

  // Reusing a catalog product must not reuse a previous item's comment or quantity.
  const originalIds = new Set(response.json.entities.filter(entity => entity.kind === "item").map(entity => entity.id));
  response = await command({ action: "addItem", listId: shoppingList.id, barcode: "0001234567890" });
  expectStatus(response, 200, "Add same product later without copying comment");
  const laterItem = response.json.entities.find(entity => entity.kind === "item" && entity.data.listId === shoppingList.id && !originalIds.has(entity.id));
  assert.equal(laterItem.data.productId, productId);
  assert.equal(laterItem.data.comment ?? "", "");
  assert.equal(laterItem.data.quantity, 1);
  assert.equal(findItem(response.json).data.comment, finalComment);
  assertUnrelatedUnchanged(response.json);
  response = await command({ action: "save", kind: "shopping", data: { name: "Courses ponctuelles", icon: "bag" } });
  expectStatus(response, 200, "Create another shopping list");
  const otherList = response.json.entities.find(entity => entity.kind === "shopping" && entity.data.name === "Courses ponctuelles");
  response = await command({ action: "addItem", listId: otherList.id, productId });
  expectStatus(response, 200, "Add product to another list without copying comment");
  const otherListItem = response.json.entities.find(entity => entity.kind === "item" && entity.data.listId === otherList.id);
  assert.equal(otherListItem.data.comment ?? "", "");
  assert.equal(otherListItem.data.quantity, 1);
  assert.equal(otherListItem.data.productId, productId);
  assertUnrelatedUnchanged(response.json);

  response = await outsider("/api/state");
  expectStatus(response, 200, "Read isolated household item");
  const foreignItem = response.json.entities.find(entity => entity.kind === "item");
  assert.ok(foreignItem, "Checklist scenario created an item in the outsider household");
  const foreignHouseholdId = response.json.household.id;
  response = await command({ action: "save", kind: "item", id: foreignItem.id, expectedRevision: foreignItem.revision, data: { ...foreignItem.data, quantity: 4, comment: "Interdit" } });
  expectStatus(response, 404, "An item from another household cannot be edited");
  response = await outsider("/api/state?household=" + foreignHouseholdId);
  expectStatus(response, 200, "Foreign household stays intact");
  assert.deepEqual(response.json.entities.find(entity => entity.id === foreignItem.id), foreignItem);
  return { id: item.id, quantity: 3.75, comment: finalComment, updatedBy: memberId, product, sibling, otherListItem };
}
try {
  await start();
  const admin = client(), member = client(), outsider = client(), anonymous = client();
  const password = "Un mot de passe pour le test 2026!";
  let demoPage = await anonymous("/"); assert.equal(demoPage.status, 200);
  assert.match(demoPage.text, /Trier la checklist de A à Z/);
  assert.match(demoPage.text, /Trier la checklist de Z à A/);
  assert.match(demoPage.text, /Filtrer les éléments de Les petites choses à faire/);
  assert.match(demoPage.text, /Choisir la position de Arroser les plantes, position actuelle 1/);
  assert.match(demoPage.text, /aria-label="Modifier la quantit(?:é|&eacute;|&#0*233;|&#x0*[eE]9;) de Avocats"/);
  assert.match(demoPage.text, /aria-label="Modifier la quantit(?:é|&eacute;|&#0*233;|&#x0*[eE]9;) et la note de Avocats"/);
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
  const orderedChecklist = await checkChecklistOrdering({ admin, member, outsider, command, household, shoppingList: list, adminId, memberId });
  const editedShoppingItem = await checkShoppingItemEdits({ admin, member, outsider, command, household, shoppingList: list, productId: product.id, memberId });
  r = await outsider("/api/state?household=" + household.id); assert.equal(r.status, 403);
  r = await admin("/api/command", { action: "renameHousehold", householdId: household.id, name: "Forbidden" }, { Origin: "https://attacker.example" }); assert.equal(r.status, 403);
  r = await admin("/api/auth/logout", {}, { Origin: "https://attacker.example" }); assert.equal(r.status, 403);
  r = await admin("/api/push/run", {}); assert.equal(r.status, 403);
  await stop(); await start();
  r = await admin("/api/state?household=" + household.id); assert.equal(r.status, 200, "Session survives restart"); assert.equal(r.json.preferences.rotation, 10); assert.equal(r.json.entities.find(e => e.id === product.id).data.name, "Lait modifié");
  const persistedChecklist = r.json.entities.find(e => e.id === orderedChecklist.id);
  assert.deepEqual(persistedChecklist.data.itemOrder, orderedChecklist.itemOrder, "Checklist order survives server restart");
  assert.equal(persistedChecklist.updatedBy, orderedChecklist.updatedBy);
  assert.deepEqual(r.json.entities.filter(e => e.kind === "item" && e.data.listId === orderedChecklist.id).map(e => e.id).sort(), [...orderedChecklist.itemIds].sort());
  const persistedShoppingItem = r.json.entities.find(e => e.id === editedShoppingItem.id);
  assert.equal(persistedShoppingItem.data.quantity, editedShoppingItem.quantity, "Edited quantity survives server restart");
  assert.equal(persistedShoppingItem.data.comment, editedShoppingItem.comment, "Item comment survives server restart");
  assert.equal(persistedShoppingItem.updatedBy, editedShoppingItem.updatedBy);
  assert.deepEqual(r.json.entities.find(e => e.id === product.id), editedShoppingItem.product);
  assert.deepEqual(r.json.entities.find(e => e.id === editedShoppingItem.sibling.id), editedShoppingItem.sibling);
  assert.deepEqual(r.json.entities.find(e => e.id === editedShoppingItem.otherListItem.id), editedShoppingItem.otherListItem);
  r = await admin("/"); assert.equal(r.status, 200); assert.doesNotMatch(r.text, /929290566|Only plain objects|:E\{/);
  r = await admin("/api/auth/logout", {}); assert.equal(r.status, 200);
  r = await admin("/api/state"); assert.equal(r.status, 401);
  r = await admin("/api/auth/login", { email: "ADMIN@example.fr", password: "wrong password" }); assert.equal(r.status, 401);
  r = await admin("/api/auth/login", { email: "ADMIN@example.fr", password }); assert.equal(r.status, 200);
  r = await admin("/"); assert.equal(r.status, 200); assert.doesNotMatch(r.text, /929290566|Only plain objects|:E\{/);
  r = await command({ action: "member", userId: memberId, role: "remove" }); assert.equal(r.status, 200);
  r = await member("/api/state?household=" + household.id); assert.equal(r.status, 403);
  r = await member("/api/command", { action: "joinHousehold", code: household.code }); assert.equal(r.status, 403);
  r = await command({ action: "delete", id: list.id, expectedRevision: list.revision }); assert.equal(r.status, 200); assert.equal(r.json.entities.filter(e => e.kind === "item" && e.data.listId === list.id).length, 0); assert.equal(r.json.entities.filter(e => e.kind === "product").length, 1); assert.equal(r.json.entities.filter(e => e.kind === "item" && e.data.listId === orderedChecklist.id).length, orderedChecklist.itemIds.length);
  console.log("NAS API/pages passed: authenticated dashboard after signup/login/restart, logout recovery page, secure sessions, household sharing/isolation, roles, barcodes, shopping item quantities/comments/validation/isolation, checklist ordering/sharing/audits/conflicts/reset/rename, preferences, CSRF and persistence.");
} catch (error) { console.error(logs); throw error; }
finally {
  await stop();
  if (!resolve(temporary).startsWith(resolve(tmpdir()) + sep + "myhomeia-api-")) throw new Error("Unexpected temporary path");
  rmSync(temporary, { recursive: true, force: true });
}
