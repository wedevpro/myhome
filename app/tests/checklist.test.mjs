import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../lib/checklist.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { getChecklistItems, sortChecklistItems, filterChecklistItems, moveChecklistItem } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
const entity = (id, kind, data, householdId = 'h1') => Object.freeze({ id, kind, householdId, data: Object.freeze(data), revision: 'revision-' + id, createdBy: 'user', createdAt: '2026-10-09T12:00:00Z', updatedBy: 'user', updatedAt: '2026-10-09T12:00:00Z' });
const item = (id, name, listId = 'list') => entity(id, 'item', { name, listId, checked: false });
const ids = items => items.map(value => value.id);

test('Checklist : conserver l’ordre historique sans ordre enregistré', () => {
  const list = entity('list', 'checklist', { name: 'Voyage', reusable: true });
  const values = Object.freeze([item('c', 'Chargeur'), item('a', 'Adaptateur'), item('other-list', 'Autre', 'another'), entity('other-household', 'item', { name: 'Autre foyer', listId: 'list' }, 'h2'), entity('product', 'product', { name: 'Produit', listId: 'list' }), item('b', 'Billet')]);
  assert.deepEqual(ids(getChecklistItems(values, list)), ['c', 'a', 'b']);
  assert.deepEqual(ids(getChecklistItems(values, undefined)), []);
  assert.deepEqual(ids(getChecklistItems(values, entity('list', 'shopping', { name: 'Courses' }))), []);
  assert.deepEqual(ids(values), ['c', 'a', 'other-list', 'other-household', 'product', 'b']);
});
test('Checklist : ordre enregistré, ajouts à la fin et références supprimées ignorées', () => {
  const list = entity('list', 'checklist', { name: 'Voyage', itemOrder: ['c', 'deleted', 'c', 'foreign', 'a'] });
  const values = Object.freeze([item('a', 'Adaptateur'), item('b', 'Billet'), item('c', 'Chargeur'), item('foreign', 'Autre liste', 'another'), item('new', 'Nouveau')]);
  assert.deepEqual(ids(getChecklistItems(values, list)), ['c', 'a', 'b', 'new']);
  assert.deepEqual(list.data.itemOrder, ['c', 'deleted', 'c', 'foreign', 'a']);
  assert.deepEqual(ids(values), ['a', 'b', 'c', 'foreign', 'new']);
});
test('Checklist : tri français numérique et égalités stables dans les deux sens', () => {
  const values = Object.freeze([item('e10', 'École 10'), item('e2-first', 'école 2'), item('e2-second', 'ECOLE 2'), item('a', 'Abricot'), item('b', 'Banane')]);
  assert.deepEqual(ids(sortChecklistItems(values, 'asc')), ['a', 'b', 'e2-first', 'e2-second', 'e10']);
  assert.deepEqual(ids(sortChecklistItems(values, 'desc')), ['e10', 'e2-first', 'e2-second', 'b', 'a']);
  assert.deepEqual(ids(values), ['e10', 'e2-first', 'e2-second', 'a', 'b']);
});
test('Checklist : filtre sans casse ni accents et requête vide conservant l’ordre', () => {
  const values = Object.freeze([item('identity', 'Carte d’identité'), item('school', 'ÉCOLE'), item('school-combining', 'e\u0301cole du quartier'), item('summer', 'Préparer l’été')]);
  assert.deepEqual(ids(filterChecklistItems(values, '  eCoLe  ')), ['school', 'school-combining']);
  assert.deepEqual(ids(filterChecklistItems(values, 'IDENTITE')), ['identity']);
  assert.deepEqual(ids(filterChecklistItems(values, 'ete')), ['summer']);
  assert.deepEqual(ids(filterChecklistItems(values, 'inexistant')), []);
  assert.deepEqual(ids(filterChecklistItems(values, '   ')), ids(values));
  assert.deepEqual(ids(values), ['identity', 'school', 'school-combining', 'summer']);
});
test('Checklist : déplacements adjacents avec bornes et identifiant absent', () => {
  const values = Object.freeze([item('a', 'Adaptateur'), item('b', 'Billet'), item('c', 'Chargeur')]);
  assert.deepEqual(moveChecklistItem(values, 'b', 'up'), ['b', 'a', 'c']);
  assert.deepEqual(moveChecklistItem(values, 'b', 'down'), ['a', 'c', 'b']);
  assert.deepEqual(moveChecklistItem(values, 'a', 'down'), ['b', 'a', 'c']);
  assert.deepEqual(moveChecklistItem(values, 'c', 'up'), ['a', 'c', 'b']);
  assert.deepEqual(moveChecklistItem(values, 'a', 'up'), ['a', 'b', 'c']);
  assert.deepEqual(moveChecklistItem(values, 'c', 'down'), ['a', 'b', 'c']);
  assert.deepEqual(moveChecklistItem(values, 'missing', 'up'), ['a', 'b', 'c']);
  assert.deepEqual(moveChecklistItem([], 'missing', 'down'), []);
  assert.deepEqual(ids(values), ['a', 'b', 'c']);
});
