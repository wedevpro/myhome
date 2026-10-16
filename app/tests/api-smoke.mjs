import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";

const temporary = mkdtempSync(resolve(tmpdir(), "myhome-api-"));
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
async function checkBarcodeNameAssociation({ admin, member, adminId, memberId }) {
  const expectStatus = (response, status, label) => assert.equal(response.status, status, `${label}: ${JSON.stringify(response.json)}`);
  let response = await admin("/api/command", { action: "createHousehold", name: "Barcode name fixtures" });
  expectStatus(response, 200, "Create isolated barcode-name household");
  const household = response.json.household, list = response.json.entities.find(entity => entity.kind === "shopping");
  let state = response.json;
  const products = () => state.entities.filter(entity => entity.kind === "product");
  const find = id => state.entities.find(entity => entity.id === id);
  const run = async (data, label, actor = admin) => {
    const result = await actor("/api/command", { householdId: household.id, ...data });
    expectStatus(result, 200, label); state = result.json; return state;
  };
  const createProduct = async (data, label) => {
    const previousIds = new Set(products().map(product => product.id));
    await run({ action: "save", kind: "product", data }, label);
    const added = products().filter(product => !previousIds.has(product.id));
    assert.equal(added.length, 1, label + " creates exactly one product"); return added[0];
  };
  const add = async (data, label, actor = admin) => {
    const previousIds = new Set(state.entities.map(entity => entity.id));
    await run({ action: "addItem", listId: list.id, ...data }, label, actor);
    const added = state.entities.filter(entity => entity.kind === "item" && !previousIds.has(entity.id));
    assert.equal(added.length, 1, label + " adds exactly one item");
    const item = added[0], actorId = actor === member ? memberId : adminId;
    assert.equal(item.householdId, household.id); assert.equal(item.data.listId, list.id);
    assert.equal(item.data.checked, false); assert.equal(item.createdBy, actorId); assert.equal(item.updatedBy, actorId);
    assert.ok(Number.isFinite(Date.parse(item.createdAt))); assert.equal(item.updatedAt, item.createdAt);
    return item;
  };

  // A matching name in another household must not fill this initially empty catalog.
  response = await admin("/api/command", { action: "createHousehold", name: "Foreign barcode-name fixture" });
  expectStatus(response, 200, "Create foreign product household");
  const foreignHousehold = response.json.household;
  response = await admin("/api/command", { householdId: foreignHousehold.id, action: "save", kind: "product", data: { name: "Thé vert", category: "Privé", barcodes: ["NAME-FOREIGN-OLD"] } });
  expectStatus(response, 200, "Create identically named foreign product");
  const foreignProduct = response.json.entities.find(entity => entity.kind === "product");
  const emptyCatalogState = state.entities;
  for (let read = 0; read < 2; read++) {
    response = await admin("/api/state?household=" + household.id);
    expectStatus(response, 200, "Read empty catalog without creating products"); state = response.json;
    assert.equal(products().length, 0); assert.deepEqual(state.entities, emptyCatalogState);
  }
  const isolatedItem = await add({ barcode: "NAME-LOCAL-TEA", name: "  THÉ VERT  ", saveProduct: false, quantity: 0.5, unit: "kg" }, "Unknown name creates local product despite a foreign match");
  assert.equal(products().length, 1);
  const localTea = find(isolatedItem.data.productId);
  assert.ok(localTea); assert.notEqual(localTea.id, foreignProduct.id);
  assert.equal(localTea.householdId, household.id); assert.equal(localTea.data.name, "THÉ VERT");
  assert.deepEqual(localTea.data.barcodes, ["NAME-LOCAL-TEA"]);
  assert.equal(localTea.createdBy, adminId); assert.equal(localTea.updatedBy, adminId);
  assert.equal(isolatedItem.data.name, "THÉ VERT"); assert.equal(isolatedItem.data.quantity, 0.5); assert.equal(isolatedItem.data.unit, "kg");
  response = await member("/api/command", { action: "joinHousehold", code: household.code });
  expectStatus(response, 200, "Join barcode-name fixtures as simple member");

  const coffee = await createProduct({ name: "Café", category: "Épicerie", barcodes: ["NAME-CAFE-OLD"] }, "Create coffee fixture with an existing barcode");
  const coffeeAudit = { createdBy: coffee.createdBy, createdAt: coffee.createdAt };
  const coffeeCodes = ["NAME-CAFE-OLD"];
  for (const [index, name] of ["Café", "cafe", "CAFÉ"].entries()) {
    const previousProduct = find(coffee.id), count = products().length, barcode = "NAME-CAFE-" + index;
    const actor = index === 2 ? member : admin;
    const item = await add({ barcode, name, quantity: 2.5, unit: "paquets" }, "Reuse exact normalized name " + name, actor);
    coffeeCodes.push(barcode);
    assert.equal(products().length, count, "An exact name must not create another catalog product");
    assert.equal(item.data.productId, coffee.id); assert.equal(item.data.name, "Café");
    assert.equal(item.data.category, "Épicerie"); assert.equal(item.data.quantity, 2.5); assert.equal(item.data.unit, "paquets");
    const currentProduct = find(coffee.id);
    assert.equal(currentProduct.data.name, "Café"); assert.equal(currentProduct.data.category, "Épicerie");
    assert.deepEqual(currentProduct.data.barcodes, coffeeCodes, "Associating a code preserves all previous codes");
    assert.deepEqual({ createdBy: currentProduct.createdBy, createdAt: currentProduct.createdAt }, coffeeAudit);
    assert.equal(currentProduct.updatedBy, actor === member ? memberId : adminId);
    assert.notEqual(currentProduct.revision, previousProduct.revision);
    assert.ok(Date.parse(currentProduct.updatedAt) >= Date.parse(currentProduct.createdAt));
  }

  const beforeNewProduct = new Set(products().map(product => product.id));
  const freshItem = await add({ barcode: "NAME-NEW-CHOCOLATE", name: "  Chocolat noir 70 %  ", saveProduct: false }, "New barcode and name create a trimmed product");
  const newProducts = products().filter(product => !beforeNewProduct.has(product.id));
  assert.equal(newProducts.length, 1);
  const chocolate = newProducts[0];
  assert.equal(chocolate.data.name, "Chocolat noir 70 %"); assert.deepEqual(chocolate.data.barcodes, ["NAME-NEW-CHOCOLATE"]);
  assert.equal(freshItem.data.productId, chocolate.id); assert.equal(freshItem.data.name, chocolate.data.name);
  assert.equal(freshItem.data.quantity, 1); assert.equal(freshItem.data.unit, "");
  assert.equal(chocolate.createdBy, adminId); assert.equal(chocolate.updatedBy, adminId);

  for (const [index, name] of ["Caf", "Café moulu"].entries()) {
    const previousIds = new Set(products().map(product => product.id));
    const barcode = "NAME-APPROXIMATE-" + index;
    const item = await add({ barcode, name }, "Approximate name remains a new product: " + name);
    const created = products().filter(product => !previousIds.has(product.id));
    assert.equal(created.length, 1); assert.equal(created[0].data.name, name);
    assert.notEqual(created[0].id, coffee.id); assert.equal(item.data.productId, created[0].id);
    assert.deepEqual(created[0].data.barcodes, [barcode]);
  }

  const duplicate = await createProduct({ name: "CAFÉ", category: "Autre café", barcodes: ["NAME-DUPLICATE-OLD"] }, "Create a second product with the same normalized name");
  const beforeAmbiguous = state.entities;
  response = await admin("/api/command", { householdId: household.id, action: "addItem", listId: list.id, barcode: "NAME-AMBIGUOUS", name: "cafe" });
  expectStatus(response, 409, "Ambiguous exact name requires an explicit product choice");
  response = await admin("/api/state?household=" + household.id);
  expectStatus(response, 200, "Read records after ambiguous association"); state = response.json;
  assert.deepEqual(state.entities, beforeAmbiguous, "Ambiguity must not create a product or item, associate a code, or alter audits");
  const beforeExplicitCoffee = find(coffee.id), countBeforeChoice = products().length;
  const explicitItem = await add({ barcode: "NAME-AMBIGUOUS", productId: duplicate.id, name: "cafe", quantity: 3, unit: "boîtes" }, "Explicit ID selects the intended normalized-name duplicate");
  assert.equal(products().length, countBeforeChoice);
  assert.equal(explicitItem.data.productId, duplicate.id); assert.equal(explicitItem.data.name, "CAFÉ");
  assert.equal(explicitItem.data.quantity, 3); assert.equal(explicitItem.data.unit, "boîtes");
  assert.deepEqual(find(duplicate.id).data.barcodes, ["NAME-DUPLICATE-OLD", "NAME-AMBIGUOUS"]);
  assert.deepEqual(find(coffee.id), beforeExplicitCoffee, "Explicit selection must not update the other matching product");
  const beforeCollision = state.entities;
  for (const [data, label] of [
    [{ productId: duplicate.id, name: "cafe" }, "Known barcode cannot be reassigned to another explicit product"],
    [{ name: "Chocolat noir 70 %" }, "Known barcode cannot be associated using a conflicting product name"],
  ]) {
    response = await admin("/api/command", { householdId: household.id, action: "addItem", listId: list.id, barcode: "NAME-CAFE-OLD", ...data });
    expectStatus(response, 409, label);
    response = await admin("/api/state?household=" + household.id);
    expectStatus(response, 200, "Read catalog and items after conflicting barcode association"); state = response.json;
    assert.deepEqual(state.entities, beforeCollision, "A barcode collision leaves catalog, items, revisions and audits intact");
  }
  const beforeKnownScan = products();
  const knownItem = await add({ barcode: "NAME-CAFE-OLD", name: "cafe" }, "Existing barcode association remains authoritative despite ambiguous names");
  assert.equal(knownItem.data.productId, coffee.id); assert.deepEqual(products(), beforeKnownScan);
  response = await member("/api/state?household=" + household.id);
  expectStatus(response, 200, "Name-based associations are shared with household members");
  assert.deepEqual(response.json.entities, state.entities);
  response = await admin("/api/state?household=" + foreignHousehold.id);
  expectStatus(response, 200, "Read foreign product after local associations");
  assert.deepEqual(response.json.entities.find(entity => entity.id === foreignProduct.id), foreignProduct);
  return {
    householdId: household.id, records: state.entities, foreignHouseholdId: foreignHousehold.id, foreignProduct,
    rescan: [
      { barcode: "NAME-CAFE-2", productId: coffee.id },
      { barcode: "NAME-NEW-CHOCOLATE", productId: chocolate.id },
      { barcode: "NAME-AMBIGUOUS", productId: duplicate.id },
    ],
  };
}
async function checkLinkedChecklists({ admin, member, outsider, adminId, memberId }) {
  const expectStatus = (response, status, label) => assert.equal(response.status, status, `${label}: ${JSON.stringify(response.json)}`);
  let response = await admin("/api/command", { action: "createHousehold", name: "Linked checklist fixtures" });
  expectStatus(response, 200, "Create isolated linked-checklist household");
  const household = response.json.household;
  let state = response.json;
  const find = id => state.entities.find(entity => entity.id === id);
  const items = listId => state.entities.filter(entity => entity.kind === "item" && entity.data.listId === listId);
  const run = async (data, label, actor = admin) => {
    const result = await actor("/api/command", { householdId: household.id, ...data });
    expectStatus(result, 200, label); state = result.json; return state;
  };
  const create = async (kind, data, label, actor = admin) => {
    const previousIds = new Set(state.entities.map(entity => entity.id));
    await run({ action: "save", kind, data }, label, actor);
    const added = state.entities.filter(entity => !previousIds.has(entity.id));
    assert.equal(added.length, 1, label + " creates exactly one record"); return added[0];
  };
  const add = async (listId, data, label, actor = admin) => {
    const previousIds = new Set(state.entities.map(entity => entity.id));
    await run({ action: "addItem", listId, ...data }, label, actor);
    const added = state.entities.filter(entity => entity.kind === "item" && !previousIds.has(entity.id));
    assert.equal(added.length, 1, label + " creates exactly one item"); return added[0];
  };
  const edit = async (id, data, label, actor = admin) => {
    const previous = find(id);
    await run({ action: "save", kind: previous.kind, id, expectedRevision: previous.revision, data: { ...previous.data, ...data } }, label, actor);
    return find(id);
  };
  const reject = async (data, status, label, actor = admin) => {
    const before = state.entities;
    const result = await actor("/api/command", { householdId: household.id, ...data });
    expectStatus(result, status, label);
    const inspected = await admin("/api/state?household=" + household.id);
    expectStatus(inspected, 200, "Inspect records after rejected linked-checklist operation"); state = inspected.json;
    assert.deepEqual(state.entities, before, label + " leaves every record, revision and audit intact");
  };
  const assertAudit = (current, previous, actorId, label) => {
    assert.equal(current.id, previous.id); assert.equal(current.kind, previous.kind);
    assert.equal(current.householdId, previous.householdId);
    assert.equal(current.createdBy, previous.createdBy); assert.equal(current.createdAt, previous.createdAt);
    assert.equal(current.updatedBy, actorId, label + " records the actor");
    assert.notEqual(current.revision, previous.revision, label + " invalidates the previous revision");
    assert.ok(Date.parse(current.updatedAt) >= Date.parse(previous.updatedAt), label + " records an update time");
  };

  response = await member("/api/command", { action: "joinHousehold", code: household.code });
  expectStatus(response, 200, "Join linked-checklist fixtures as a simple member");
  const shopping = state.entities.find(entity => entity.kind === "shopping");
  const suitcase = await create("checklist", { name: "Valise", icon: "bag", reusable: true }, "Create parent checklist");
  const toiletries = await create("checklist", { name: "Trousse de toilette", icon: "check", reusable: true }, "Create target checklist");
  const chargers = await create("checklist", { name: "Chargeurs", icon: "check", reusable: true }, "Create another target checklist");
  const weekend = await create("checklist", { name: "Week-end", icon: "plane", reusable: false }, "Create a second parent checklist");
  const note = await create("note", { name: "Note sans liste", content: "Ne peut pas servir de checklist liée." }, "Create wrong-kind link target");
  const toothbrush = await add(toiletries.id, { name: "Brosse à dents" }, "Add target checklist detail");
  await add(toiletries.id, { name: "Dentifrice" }, "Add another target checklist detail");
  await edit(toothbrush.id, { checked: true }, "Complete one detail in the target checklist");
  const socks = await add(suitcase.id, { name: "Chaussettes" }, "Add a normal parent checklist item");
  const linked = await add(suitcase.id, { name: "Ma trousse de toilette", linkedChecklistId: toiletries.id }, "Member adds a linked checklist item", member);
  assert.equal(linked.data.linkedChecklistId, toiletries.id);
  assert.equal(linked.data.name, "Ma trousse de toilette"); assert.equal(linked.data.listId, suitcase.id);
  assert.equal(linked.data.checked, false); assert.equal(linked.createdBy, memberId); assert.equal(linked.updatedBy, memberId);
  assert.equal(linked.createdAt, linked.updatedAt); assert.ok(Number.isFinite(Date.parse(linked.createdAt)));
  assert.equal(items(suitcase.id).length, 2, "Linking a checklist does not copy its detail items into the parent");
  assert.equal(items(toiletries.id).length, 2, "Linking leaves the target checklist's contents intact");

  const targetContents = items(toiletries.id), targetBeforeCheck = find(toiletries.id);
  await edit(linked.id, { checked: true }, "Complete the parent link independently of the target details", member);
  assert.deepEqual(items(toiletries.id), targetContents, "Completing a link leaves every target item's completion and audit unchanged");
  assert.deepEqual(find(toiletries.id), targetBeforeCheck);
  await run({ action: "reset", listId: suitcase.id }, "Reset a reusable checklist containing a link", member);
  assert.equal(find(linked.id).data.checked, false);
  assert.equal(find(linked.id).data.linkedChecklistId, toiletries.id, "Reset preserves linked-checklist IDs");
  assert.deepEqual(items(toiletries.id), targetContents, "Resetting the parent leaves linked checklist details unchanged");

  const linkedBeforeRename = find(linked.id), targetBeforeRename = find(toiletries.id);
  await edit(toiletries.id, { name: "Trousse de toilette familiale" }, "Rename the target checklist");
  assert.deepEqual(find(linked.id), linkedBeforeRename, "A target rename preserves the explicit item label and the stable link ID");
  assert.equal(find(toiletries.id).data.name, "Trousse de toilette familiale");
  response = await member("/api/state?household=" + household.id);
  expectStatus(response, 200, "Member sees linked checklist and renamed target");
  assert.deepEqual(response.json.entities, state.entities);

  const beforeLinkEdit = find(socks.id);
  await edit(socks.id, { name: "Chargeurs à emporter", linkedChecklistId: chargers.id }, "Associate an existing item with another checklist", member);
  assert.equal(find(socks.id).data.linkedChecklistId, chargers.id);
  assert.equal(find(socks.id).data.name, "Chargeurs à emporter");
  assertAudit(find(socks.id), beforeLinkEdit, memberId, "Link edit");
  await edit(socks.id, { linkedChecklistId: toiletries.id }, "Change an existing item's linked checklist", member);
  assert.equal(find(socks.id).data.linkedChecklistId, toiletries.id);
  const beforeUnlink = find(socks.id), { linkedChecklistId: removedLink, ...unlinkedData } = beforeUnlink.data;
  assert.equal(removedLink, toiletries.id);
  await run({ action: "save", kind: "item", id: socks.id, expectedRevision: beforeUnlink.revision, data: unlinkedData }, "Omitting the link explicitly unlinks an existing item", member);
  assert.equal(find(socks.id).data.linkedChecklistId, undefined);
  assert.deepEqual(find(socks.id).data, unlinkedData, "Unlinking preserves all other item data");
  assertAudit(find(socks.id), beforeUnlink, memberId, "Unlink edit");

  const weekendLink = await create("item", { name: "La trousse du week-end", listId: weekend.id, linkedChecklistId: toiletries.id, checked: true, quantity: 2, comment: "À préparer vendredi.", unit: "trousses" }, "Create a linked checklist item through the generic save API");
  assert.equal(weekendLink.data.linkedChecklistId, toiletries.id); assert.equal(weekendLink.createdBy, adminId);
  const persistentLink = await add(suitcase.id, { name: "Vérifier les chargeurs", linkedChecklistId: chargers.id }, "Add a link that will survive the target deletion and restart", member);
  const returnLink = await add(chargers.id, { name: "Revoir la valise", linkedChecklistId: suitcase.id }, "A reference back to another checklist is allowed without recursive expansion");
  assert.equal(returnLink.data.linkedChecklistId, suitcase.id);
  await edit(linked.id, { checked: true, comment: "À garder en bagage cabine." }, "Retain a checked parent link and its temporary note");
  const parentOrder = [persistentLink.id, socks.id, linked.id];
  const orderedItems = parentOrder.map(find);
  await run({ action: "reorderChecklist", listId: suitcase.id, itemIds: parentOrder, expectedRevision: find(suitcase.id).revision }, "Reorder a checklist containing linked items", member);
  assert.deepEqual(find(suitcase.id).data.itemOrder, parentOrder);
  assert.deepEqual(parentOrder.map(find), orderedItems, "Reordering preserves every linked item's data, revision and audit");

  response = await outsider("/api/command", { action: "createHousehold", name: "Foreign linked checklist fixture" });
  expectStatus(response, 200, "Create a foreign household for linked-checklist isolation");
  const foreignHousehold = response.json.household, foreignChecklist = response.json.entities.find(entity => entity.kind === "checklist");
  response = await outsider("/api/command", { householdId: foreignHousehold.id, action: "addItem", listId: foreignChecklist.id, name: "Détail privé" });
  expectStatus(response, 200, "Create a private foreign checklist detail");
  const foreignRecords = response.json.entities;
  const missingId = "00000000-0000-4000-8000-999999999999";
  for (const [linkedChecklistId, status, label] of [
    [suitcase.id, 400, "An item cannot link its own parent checklist"],
    [shopping.id, 400, "A shopping list cannot be a linked checklist target"],
    [note.id, 400, "A note cannot be a linked checklist target"],
    [foreignChecklist.id, 404, "An item cannot reference another household's checklist"],
    [missingId, 404, "A missing linked checklist is rejected"],
  ]) {
    await reject({ action: "addItem", listId: suitcase.id, name: "Lien refusé", linkedChecklistId }, status, label + " on add");
    const previous = find(socks.id);
    await reject({ action: "save", kind: "item", id: previous.id, expectedRevision: previous.revision, data: { ...previous.data, linkedChecklistId } }, status, label + " on edit");
  }
  await reject({ action: "addItem", listId: shopping.id, name: "Lien en courses", linkedChecklistId: toiletries.id }, 400, "A shopping item cannot be created with a checklist link");
  await reject({ action: "save", kind: "item", data: { name: "Lien en courses", listId: shopping.id, linkedChecklistId: toiletries.id } }, 400, "Generic save cannot create a linked shopping item");
  await reject({ action: "addItem", listId: suitcase.id, name: "Lien mélangé", linkedChecklistId: toiletries.id, saveProduct: true }, 400, "A checklist reference cannot also create a product");
  const linkedBeforeMove = find(linked.id);
  await reject({ action: "save", kind: "item", id: linked.id, expectedRevision: linkedBeforeMove.revision, data: { ...linkedBeforeMove.data, listId: shopping.id } }, 400, "Moving a linked item into a shopping list is rejected");
  await reject({ action: "addItem", listId: suitcase.id, name: "Lien non autorisé", linkedChecklistId: chargers.id }, 403, "A non-member cannot add a linked household item", outsider);
  await reject({ action: "save", kind: "item", id: socks.id, expectedRevision: beforeLinkEdit.revision, data: { ...beforeLinkEdit.data, linkedChecklistId: chargers.id } }, 409, "Stale item edits cannot restore an obsolete link");
  await reject({ action: "delete", id: toiletries.id, expectedRevision: targetBeforeRename.revision }, 409, "A stale target deletion cannot remove any checklist or link");

  const deletedTarget = find(toiletries.id), deletedChildIds = items(toiletries.id).map(entity => entity.id);
  const referencedBeforeDelete = [find(linked.id), find(weekendLink.id)];
  const parentBeforeDelete = find(suitcase.id), weekendBeforeDelete = find(weekend.id);
  const unrelatedBeforeDelete = state.entities.filter(entity => entity.id !== toiletries.id && !deletedChildIds.includes(entity.id) && !referencedBeforeDelete.some(item => item.id === entity.id));
  await run({ action: "delete", id: toiletries.id, expectedRevision: deletedTarget.revision }, "Member deletes a target checklist and clears its incoming links", member);
  assert.equal(find(toiletries.id), undefined);
  for (const id of deletedChildIds) assert.equal(find(id), undefined, "Deleting a target also removes its own detail item: " + id);
  for (const before of referencedBeforeDelete) {
    const current = find(before.id), { linkedChecklistId, ...expectedData } = before.data;
    assert.equal(linkedChecklistId, toiletries.id);
    assert.ok(current, "An incoming link remains a normal checklist item after its target is deleted");
    assert.deepEqual(current.data, expectedData, "Target deletion preserves each referencing item's label, completion, quantity, note and other data");
    assertAudit(current, before, memberId, "Target deletion cleanup");
  }
  assert.deepEqual(find(suitcase.id), parentBeforeDelete, "Removing incoming links leaves the parent list's order, revision and audit intact");
  assert.deepEqual(find(weekend.id), weekendBeforeDelete, "Cleanup covers incoming links in every checklist without modifying their parent lists");
  for (const previous of unrelatedBeforeDelete) assert.deepEqual(find(previous.id), previous, "Target deletion leaves every unrelated entity intact: " + previous.id);
  assert.equal(find(persistentLink.id).data.linkedChecklistId, chargers.id, "A link to another target remains associated");
  await reject({ action: "save", kind: "item", id: linked.id, expectedRevision: linkedBeforeMove.revision, data: linkedBeforeMove.data }, 409, "An old edit cannot restore a link cleaned up by target deletion");
  await reject({ action: "addItem", listId: suitcase.id, name: "Lien supprimé", linkedChecklistId: toiletries.id }, 404, "A deleted target cannot receive a new link");
  response = await member("/api/state?household=" + household.id);
  expectStatus(response, 200, "Target deletion and cleaned-up links are shared with household members");
  assert.deepEqual(response.json.entities, state.entities);
  response = await outsider("/api/state?household=" + foreignHousehold.id);
  expectStatus(response, 200, "Read the foreign household after local link operations");
  assert.deepEqual(response.json.entities, foreignRecords, "Rejected cross-household associations and target deletion never alter foreign records");
  const temporaryParent = await create("checklist", { name: "Valise temporaire", icon: "bag", reusable: false }, "Create a parent to verify deletion does not cascade through links");
  await add(temporaryParent.id, { name: "Mes chargeurs", linkedChecklistId: chargers.id }, "Link to a surviving checklist from a temporary parent");
  const survivingTarget = find(chargers.id), survivingContents = items(chargers.id);
  await run({ action: "delete", id: temporaryParent.id, expectedRevision: temporaryParent.revision }, "Delete a parent checklist without deleting a referenced checklist");
  assert.deepEqual(find(chargers.id), survivingTarget);
  assert.deepEqual(items(chargers.id), survivingContents, "Deleting a parent never deletes the linked checklist's content");
  return { householdId: household.id, records: state.entities, deletedIds: [toiletries.id, ...deletedChildIds], persistentLinkId: persistentLink.id, targetId: chargers.id, foreignHouseholdId: foreignHousehold.id, foreignRecords };
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
async function checkCompletedPurge({ admin, member, outsider, household, productId, memberId }) {
  const expectStatus = (response, status, label) => assert.equal(response.status, status, `${label}: ${JSON.stringify(response.json)}`);
  const target = item => ({ id: item.id, revision: item.revision });
  let response = await admin("/api/state?household=" + household.id);
  expectStatus(response, 200, "Read records before completed-item tests");
  let state = response.json;
  const protectedEntities = state.entities, protectedMembers = state.members;
  const find = id => state.entities.find(entity => entity.id === id);
  const run = async (data, label, actor = admin) => {
    const result = await actor("/api/command", { householdId: household.id, ...data });
    expectStatus(result, 200, label); state = result.json; return state;
  };
  const createList = async (kind, name, reusable = false) => {
    await run({ action: "save", kind, data: { name, icon: kind === "shopping" ? "basket" : "check", ...(kind === "checklist" ? { reusable } : {}) } }, "Create purge fixture " + name);
    return state.entities.find(entity => entity.kind === kind && entity.data.name === name);
  };
  const add = async (list, name, knownProduct = false, quantity = 1) => {
    const existingIds = new Set(state.entities.map(entity => entity.id));
    await run({ action: "addItem", listId: list.id, name, quantity, ...(knownProduct ? { productId } : {}) }, "Add purge fixture item");
    return state.entities.find(entity => entity.kind === "item" && !existingIds.has(entity.id));
  };
  const edit = async (id, changes, actor = admin) => {
    const before = find(id);
    await run({ action: "save", kind: "item", id, expectedRevision: before.revision, data: { ...before.data, ...changes } }, "Edit purge fixture item", actor);
    return find(id);
  };
  const shopping = await createList("shopping", "Courses pour tester la purge");
  const shoppingIds = [];
  for (const quantity of [1, 2, 3, 4]) shoppingIds.push((await add(shopping, "Lait", true, quantity)).id);
  const ephemeral = await createList("checklist", "Tâches éphémères pour tester la purge");
  const ephemeralIds = [];
  for (const name of ["Appeler", "Classer", "Réserver"]) ephemeralIds.push((await add(ephemeral, name)).id);
  const ephemeralOrder = [ephemeralIds[2], ephemeralIds[0], ephemeralIds[1]];
  await run({ action: "reorderChecklist", listId: ephemeral.id, itemIds: ephemeralOrder, expectedRevision: find(ephemeral.id).revision }, "Record ephemeral checklist order");
  const orderedListRevision = find(ephemeral.id).revision;
  await edit(ephemeralIds[0], { checked: true, quantity: 2, comment: "À conserver en renommant" });
  const beforeRename = find(ephemeralIds[0]);
  await edit(ephemeralIds[0], { name: "Appeler le plombier" }, member);
  const renamed = find(ephemeralIds[0]);
  assert.equal(renamed.data.name, "Appeler le plombier");
  assert.equal(renamed.data.checked, true, "Checking an ephemeral task retains it until explicit purge");
  assert.equal(renamed.data.quantity, 2);
  assert.equal(renamed.data.comment, "À conserver en renommant");
  assert.equal(renamed.data.listId, ephemeral.id);
  assert.equal(renamed.updatedBy, memberId);
  assert.notEqual(renamed.revision, beforeRename.revision);
  assert.equal(renamed.createdBy, beforeRename.createdBy);
  assert.equal(renamed.createdAt, beforeRename.createdAt);
  assert.deepEqual(find(ephemeral.id).data.itemOrder, ephemeralOrder);
  assert.equal(find(ephemeral.id).revision, orderedListRevision, "Label edit leaves checklist order revision unchanged");
  response = await admin("/api/command", { householdId: household.id, action: "save", kind: "item", id: renamed.id, expectedRevision: beforeRename.revision, data: { ...beforeRename.data, name: "Ancien libellé" } });
  expectStatus(response, 409, "Stale task label edit rejected");
  await edit(ephemeralIds[2], { checked: true });
  const reusable = await createList("checklist", "Tâches réutilisables protégées", true);
  const reusableItemId = (await add(reusable, "Ne pas supprimer")).id;
  await edit(reusableItemId, { checked: true });

  await edit(shoppingIds[0], { checked: true });
  await edit(shoppingIds[1], { checked: true });
  const staleRequested = [target(find(shoppingIds[0])), target(find(shoppingIds[1]))];
  await edit(shoppingIds[1], { quantity: 2.5, comment: "Version plus récente" }, member);
  const shoppingBeforeRejection = shoppingIds.map(find);
  const ephemeralBeforeRejection = ephemeralIds.map(find);
  const largePurgeRequest = {
    householdId: household.id, action: "clearCompleted", listId: shopping.id,
    completedItems: Array.from({ length: 2000 }, (_, index) => ({
      id: "00000000-0000-4000-8000-" + String(index).padStart(12, "0"),
      revision: "11111111-1111-4111-8111-" + String(index).padStart(12, "0"),
    })),
  };
  const largePurgeBytes = Buffer.byteLength(JSON.stringify(largePurgeRequest), "utf8");
  assert.ok(largePurgeBytes > 150000 && largePurgeBytes < 1200000, "Large purge crosses the former request limit");
  response = await admin("/api/command", largePurgeRequest);
  expectStatus(response, 409, "A purge over 150 KB reaches item validation instead of 413");
  const oversizedRequest = {
    ...largePurgeRequest,
    completedItems: Array.from({ length: 3000 }, (_, index) => ({ id: String(index).padStart(12, "0") + "x".repeat(188), revision: "r".repeat(200) })),
  };
  assert.ok(Buffer.byteLength(JSON.stringify(oversizedRequest), "utf8") > 1200000, "Oversized request exceeds the new byte limit");
  response = await admin("/api/command", oversizedRequest);
  expectStatus(response, 413, "Requests over 1.2 MB are rejected before any deletion");
  for (const [listId, completedItems, expected, label] of [
    [shopping.id, staleRequested, 409, "One stale target prevents deleting every requested item"],
    [shopping.id, [target(find(shoppingIds[0])), target(find(shoppingIds[3]))], 409, "One unchecked target prevents partial purge"],
    [shopping.id, [target(find(shoppingIds[0])), target(find(ephemeralIds[0]))], 409, "Target in another list prevents partial purge"],
    [shopping.id, [target(find(shoppingIds[0])), target(find(shoppingIds[0]))], 400, "Duplicate purge targets rejected"],
    [reusable.id, [target(find(reusableItemId))], 400, "Reusable checklist cannot be purged"],
  ]) {
    response = await admin("/api/command", { householdId: household.id, action: "clearCompleted", listId, completedItems });
    expectStatus(response, expected, label);
  }
  response = await outsider("/api/command", { householdId: household.id, action: "clearCompleted", listId: shopping.id, completedItems: [target(find(shoppingIds[0]))] });
  expectStatus(response, 403, "Non-member cannot purge household items");
  response = await outsider("/api/state");
  expectStatus(response, 200, "Read foreign purge target");
  const foreignHousehold = response.json.household;
  const foreignItem = response.json.entities.find(entity => entity.kind === "item");
  response = await admin("/api/command", { householdId: household.id, action: "clearCompleted", listId: foreignItem.data.listId, completedItems: [target(foreignItem)] });
  expectStatus(response, 404, "Foreign household list is inaccessible to purge");
  response = await admin("/api/command", { householdId: household.id, action: "clearCompleted", listId: shopping.id, completedItems: [target(find(shoppingIds[0])), target(foreignItem)] });
  expectStatus(response, 409, "Foreign household target cannot cause a partial purge");
  response = await member("/api/state?household=" + household.id);
  expectStatus(response, 200, "Inspect unsuccessful purges"); state = response.json;
  assert.deepEqual(shoppingIds.map(find), shoppingBeforeRejection, "Every shopping target and pending item survives rejected purge");
  assert.deepEqual(ephemeralIds.map(find), ephemeralBeforeRejection);
  assert.ok(find(reusableItemId)?.data.checked, "Reusable checked task is retained");
  assert.deepEqual(find(ephemeralIds[0]), renamed, "Rejected label edit preserves the renamed task");

  // Purge only the checked snapshot the user requested; a later checked task remains.
  const requested = [target(find(shoppingIds[0])), target(find(shoppingIds[1]))];
  await edit(shoppingIds[2], { checked: true });
  const newlyChecked = find(shoppingIds[2]), pendingShopping = find(shoppingIds[3]);
  await run({ action: "clearCompleted", listId: shopping.id, completedItems: requested }, "Member purges requested shopping items", member);
  assert.equal(find(shoppingIds[0]), undefined);
  assert.equal(find(shoppingIds[1]), undefined);
  assert.deepEqual(find(shoppingIds[2]), newlyChecked, "Newly checked item outside the request remains");
  assert.deepEqual(find(shoppingIds[3]), pendingShopping, "Pending shopping item remains");
  assert.equal(state.entities.filter(entity => entity.kind === "item" && entity.data.listId === shopping.id).length, 2);
  const pendingEphemeral = find(ephemeralIds[1]);
  await run({ action: "clearCompleted", listId: ephemeral.id, completedItems: [target(find(ephemeralIds[0])), target(find(ephemeralIds[2]))] }, "Member purges completed ephemeral tasks", member);
  assert.equal(find(ephemeralIds[0]), undefined);
  assert.equal(find(ephemeralIds[2]), undefined);
  assert.deepEqual(find(ephemeralIds[1]), pendingEphemeral);
  assert.equal(state.entities.filter(entity => entity.kind === "item" && entity.data.listId === ephemeral.id).length, 1);
  assert.ok(find(reusableItemId)?.data.checked);
  for (const entity of protectedEntities) assert.deepEqual(find(entity.id), entity, "Purge leaves other lists and catalog untouched: " + entity.id);
  assert.deepEqual(state.members, protectedMembers, "Purge does not change household memberships");
  response = await admin("/api/state?household=" + household.id);
  expectStatus(response, 200, "Purge results are shared with administrator");
  assert.equal(response.json.entities.some(entity => entity.id === shoppingIds[0] || entity.id === ephemeralIds[0]), false);
  assert.deepEqual(response.json.entities.find(entity => entity.id === shoppingIds[3]), pendingShopping);
  response = await outsider("/api/state?household=" + foreignHousehold.id);
  expectStatus(response, 200, "Foreign household survives purge attempts");
  assert.deepEqual(response.json.entities.find(entity => entity.id === foreignItem.id), foreignItem);
  return {
    deletedIds: [shoppingIds[0], shoppingIds[1], ephemeralIds[0], ephemeralIds[2]],
    survivors: [newlyChecked, pendingShopping, pendingEphemeral, find(reusableItemId)],
  };
}
try {
  await start();
  const admin = client(), member = client(), outsider = client(), anonymous = client();
  const password = "Un mot de passe pour le test 2026!";
  let demoPage = await anonymous("/"); assert.equal(demoPage.status, 200);
  // Widget routing waits for client hydration before showing lists; HTTP checks
  // validate the shell. Interactive list controls are exercised in browser tests.
  assert.match(demoPage.text, /<title>myHome — Votre foyer, simplement<\/title>/);
  assert.match(demoPage.text, /"myhome-theme"/);
  assert.match(demoPage.text, /Chargement de votre foyer/);
  assert.doesNotMatch(demoPage.text, /929290566|Only plain objects|:E\{/);
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
  const barcodeNameAssociation = await checkBarcodeNameAssociation({ admin, member, adminId, memberId });
  const linkedChecklists = await checkLinkedChecklists({ admin, member, outsider, adminId, memberId });
  const orderedChecklist = await checkChecklistOrdering({ admin, member, outsider, command, household, shoppingList: list, adminId, memberId });
  const editedShoppingItem = await checkShoppingItemEdits({ admin, member, outsider, command, household, shoppingList: list, productId: product.id, memberId });
  const purgedItems = await checkCompletedPurge({ admin, member, outsider, household, productId: product.id, memberId });
  r = await outsider("/api/state?household=" + household.id); assert.equal(r.status, 403);
  r = await admin("/api/command", { action: "renameHousehold", householdId: household.id, name: "Forbidden" }, { Origin: "https://attacker.example" }); assert.equal(r.status, 403);
  r = await admin("/api/auth/logout", {}, { Origin: "https://attacker.example" }); assert.equal(r.status, 403);
  r = await admin("/api/push/run", {}); assert.equal(r.status, 403);
  await stop(); await start();
  r = await admin("/api/state?household=" + household.id); assert.equal(r.status, 200, "Session survives restart"); assert.equal(r.json.preferences.rotation, 10); assert.equal(r.json.entities.find(e => e.id === product.id).data.name, "Lait modifié");
  const persistedAssociations = await admin("/api/state?household=" + barcodeNameAssociation.householdId);
  assert.equal(persistedAssociations.status, 200, "Read barcode-name fixture household after restart");
  assert.deepEqual(persistedAssociations.json.entities, barcodeNameAssociation.records, "Name-based associations, product codes, items and audits survive restart");
  const persistedLinks = await admin("/api/state?household=" + linkedChecklists.householdId);
  assert.equal(persistedLinks.status, 200, "Read linked checklists after restart");
  assert.deepEqual(persistedLinks.json.entities, linkedChecklists.records, "Checklist links, cleaned references, order and audits survive restart");
  assert.equal(persistedLinks.json.entities.find(entity => entity.id === linkedChecklists.persistentLinkId).data.linkedChecklistId, linkedChecklists.targetId);
  for (const id of linkedChecklists.deletedIds) assert.equal(persistedLinks.json.entities.some(entity => entity.id === id), false, "Deleted target and its content stay deleted after restart");
  const persistedForeignLinks = await outsider("/api/state?household=" + linkedChecklists.foreignHouseholdId);
  assert.equal(persistedForeignLinks.status, 200);
  assert.deepEqual(persistedForeignLinks.json.entities, linkedChecklists.foreignRecords, "Link operations never mutate another household, including after restart");
  let persistedBarcodeState = persistedAssociations.json;
  const persistedBarcodeCatalog = persistedBarcodeState.entities.filter(entity => entity.kind === "product");
  const persistedBarcodeList = persistedBarcodeState.entities.find(entity => entity.kind === "shopping");
  for (const association of barcodeNameAssociation.rescan) {
    const previousIds = new Set(persistedBarcodeState.entities.map(entity => entity.id));
    const rescanned = await admin("/api/command", { householdId: barcodeNameAssociation.householdId, action: "addItem", listId: persistedBarcodeList.id, barcode: association.barcode });
    assert.equal(rescanned.status, 200, "Newly associated barcode is recognized after restart: " + association.barcode);
    persistedBarcodeState = rescanned.json;
    const addedItems = persistedBarcodeState.entities.filter(entity => entity.kind === "item" && !previousIds.has(entity.id));
    assert.equal(addedItems.length, 1); assert.equal(addedItems[0].data.productId, association.productId);
    assert.deepEqual(persistedBarcodeState.entities.filter(entity => entity.kind === "product"), persistedBarcodeCatalog, "Rescanning a persisted code does not alter or duplicate catalog products");
  }
  const persistedForeignProduct = await admin("/api/state?household=" + barcodeNameAssociation.foreignHouseholdId);
  assert.equal(persistedForeignProduct.status, 200, "Read foreign barcode-name fixture after restart");
  assert.deepEqual(persistedForeignProduct.json.entities.find(entity => entity.id === barcodeNameAssociation.foreignProduct.id), barcodeNameAssociation.foreignProduct, "Foreign product remains unchanged after restart");
  for (const id of purgedItems.deletedIds) assert.equal(r.json.entities.some(entity => entity.id === id), false, "Purged item remains deleted after restart: " + id);
  for (const survivor of purgedItems.survivors) assert.deepEqual(r.json.entities.find(entity => entity.id === survivor.id), survivor, "Purge survivor data and revision survive restart: " + survivor.id);
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
  console.log("NAS API/pages passed: authenticated dashboard after signup/login/restart, logout recovery page, secure sessions, household sharing/isolation, roles, barcodes/name matching/ambiguity/explicit selection, shopping item quantities/comments/validation/isolation, checklist links/independent completion/audited cleanup/isolation, checklist ordering/sharing/audits/conflicts/reset/rename, completed-item purge/atomicity/isolation, task label edits, renamed page metadata, preferences, CSRF and persistence.");
} catch (error) { console.error(logs); throw error; }
finally {
  await stop();
  if (!resolve(temporary).startsWith(resolve(tmpdir()) + sep + "myhome-api-")) throw new Error("Unexpected temporary path");
  rmSync(temporary, { recursive: true, force: true });
}
