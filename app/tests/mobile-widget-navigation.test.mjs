import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";

const source = readFileSync(new URL("../lib/mobile-widget-navigation.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { mobileWidgetActions, mobileWidgetPath, parseMobileWidgetLink, readPendingWidgetLink, storePendingWidgetLink, resolveMobileWidgetTarget } = await import("data:text/javascript;base64," + Buffer.from(compiled).toString("base64"));
const origin = "https://maison.example.test";
const request = { householdId: "house-2", listId: "shopping-1", action: "open" };
const entity = (id, kind, householdId, data = {}) => ({ id, kind, householdId, data, revision: "rev-1" });
function fixture() {
  return { user: { id: "alice", name: "Alice", email: "alice@example.test" }, households: [{ id: "house-1" }, { id: "house-2" }], household: { id: "house-2" }, entities: [
    entity("shopping-1", "shopping", "house-2", { name: "Courses" }),
    entity("check-1", "checklist", "house-2", { reusable: false }),
    entity("reusable", "checklist", "house-2", { reusable: true }),
    entity("note-1", "note", "house-2"),
    entity("foreign", "shopping", "house-1"),
    entity("milk", "item", "house-2", { listId: "shopping-1", checked: false }),
    entity("bread", "item", "house-2", { listId: "shopping-1", checked: true }),
    entity("another", "item", "house-2", { listId: "check-1", checked: true }),
    entity("foreign-item", "item", "house-1", { listId: "shopping-1", checked: true }),
    entity("product-1", "product", "house-2", { listId: "shopping-1" }),
  ], members: [], preferences: {} };
}

test("Widget : une URL ordinaire ne change pas la navigation", () => {
  assert.deepEqual(parseMobileWidgetLink("/?mode=kitchen", origin), { status: "absent" });
  assert.deepEqual(parseMobileWidgetLink("/", origin), { status: "absent" });
});

test("Widget : tous les écrans/actions autorisés passent par une URL canonique", () => {
  for (const action of mobileWidgetActions) {
    const target = { ...request, action, ...(["edit", "delete"].includes(action) ? { itemId: "milk" } : {}) };
    assert.deepEqual(parseMobileWidgetLink(mobileWidgetPath(target), origin), { status: "valid", request: target });
  }
  assert.equal(parseMobileWidgetLink("/?mobileWidget=1&household=house-2&list=shopping-1", origin).request.action, "open");
});

test("Widget : rejet des origines étrangères, routes et identifiants invalides", () => {
  for (const path of [
    "https://evil.example/?mobileWidget=1&household=house-2&list=shopping-1",
    "//evil.example/?mobileWidget=1&household=house-2&list=shopping-1",
    "https://user:secret@maison.example.test/?mobileWidget=1&household=house-2&list=shopping-1",
    "/api/command?mobileWidget=1&household=house-2&list=shopping-1",
    "/?mobileWidget=0&household=house-2&list=shopping-1",
    "/?mobileWidget=1&household=&list=shopping-1",
    "/?mobileWidget=1&household=house-2&list=shopping%0A1",
    "/?mobileWidget=1&household=house-2&list=" + "a".repeat(201),
    "/?mobileWidget=1&household=house-2&list=shopping-1&action=save",
  ]) assert.equal(parseMobileWidgetLink(path, origin).status, "invalid", path);
});

test("Widget : rejet des paramètres ambigus et des suppressions sans élément", () => {
  const base = mobileWidgetPath(request);
  for (const suffix of ["&mobileWidget=1", "&household=house-1", "&list=other", "&action=delete", "&item=milk", "&item="]) assert.equal(parseMobileWidgetLink(base + suffix, origin).status, "invalid", suffix);
  for (const action of ["edit", "delete"]) {
    assert.equal(parseMobileWidgetLink(mobileWidgetPath({ ...request, action }), origin).status, "invalid");
    assert.equal(parseMobileWidgetLink(mobileWidgetPath({ ...request, action, itemId: "milk" }) + "&item=bread", origin).status, "invalid");
  }
});

test("Widget : destination conservée après connexion, jusqu’à 30 minutes", () => {
  const timestamp = 1000000;
  const stored = storePendingWidgetLink({ ...request, action: "edit", itemId: "milk" }, timestamp);
  assert.deepEqual(readPendingWidgetLink(stored, origin, timestamp + 1800000), { ...request, action: "edit", itemId: "milk" });
  assert.equal(readPendingWidgetLink(stored, origin, timestamp + 1800001), null);
  assert.equal(readPendingWidgetLink(stored, origin, timestamp - 1), null);
});

test("Widget : les destinations stockées corrompues ou externes sont ignorées", () => {
  for (const value of [null, "invalid JSON", "{}", JSON.stringify({ path: "https://evil.example/", createdAt: 1 }), JSON.stringify({ path: "//evil.example/?mobileWidget=1", createdAt: 1 }), JSON.stringify({ path: mobileWidgetPath(request), createdAt: "1" }), JSON.stringify({ path: "/?mobileWidget=1&household=house-2&list=shopping-1&action=delete", createdAt: 1 })]) assert.equal(readPendingWidgetLink(value, origin, 2), null);
});

test("Widget : seul le foyer explicitement demandé est autorisé", () => {
  const state = fixture();
  const original = structuredClone(state);
  assert.equal(resolveMobileWidgetTarget(request, state).list.id, request.listId);
  assert.deepEqual(state, original, "La résolution d’un lien ne doit jamais modifier les données");
  assert.throws(() => resolveMobileWidgetTarget(request, { ...state, user: null }), /Connectez-vous/);
  assert.throws(() => resolveMobileWidgetTarget(request, { ...state, household: { id: "house-1" } }), /foyer/);
  assert.throws(() => resolveMobileWidgetTarget(request, { ...state, households: [{ id: "house-1" }] }), /foyer/);
});

test("Widget : absence de repli sur une autre liste ou un autre type d’entité", () => {
  for (const listId of ["missing", "foreign", "note-1", "milk"]) assert.throws(() => resolveMobileWidgetTarget({ ...request, listId }, fixture()), /liste/);
});

test("Widget : édition/suppression limitées à l’élément de la liste et du foyer", () => {
  for (const action of ["edit", "delete"]) {
    assert.equal(resolveMobileWidgetTarget({ ...request, action, itemId: "milk" }, fixture()).item.id, "milk");
    for (const itemId of [undefined, "missing", "foreign-item", "another", "product-1", "shopping-1"]) assert.throws(() => resolveMobileWidgetTarget({ ...request, action, itemId }, fixture()), /élément/);
  }
});

test("Widget : le scanner concerne uniquement les courses", () => {
  assert.equal(resolveMobileWidgetTarget({ ...request, action: "scan" }, fixture()).list.kind, "shopping");
  assert.throws(() => resolveMobileWidgetTarget({ ...request, listId: "check-1", action: "scan" }, fixture()), /scanner/);
});

test("Widget : suppression groupée autorisée pour courses/checklists éphémères seulement", () => {
  assert.deepEqual(resolveMobileWidgetTarget({ ...request, action: "clearCompleted" }, fixture()).completedItems.map(item => item.id), ["bread"]);
  assert.deepEqual(resolveMobileWidgetTarget({ ...request, listId: "check-1", action: "clearCompleted" }, fixture()).completedItems.map(item => item.id), ["another"]);
  assert.throws(() => resolveMobileWidgetTarget({ ...request, listId: "reusable", action: "clearCompleted" }, fixture()), /réutilisable/);
});
