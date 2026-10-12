import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../lib/product-matching.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { normalizeProductName, findProductsByName, findProductByName } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
const product = (id, name, kind = 'product') => ({ id, kind, householdId: 'home', data: { name, barcodes: ['initial-code'] }, revision: 'original-revision' });

test('Product names compare French accents, Unicode composition, case and surrounding whitespace', () => {
  for (const name of ['Café d’ÉTÉ', '  CAFE D’ETE  ', 'Cafe\u0301 d’E\u0301te\u0301', '\u00a0café d’été\u00a0']) {
    assert.equal(normalizeProductName(name), 'cafe d’ete');
  }
  assert.equal(normalizeProductName('Lait  entier'), 'lait  entier', 'Interior spaces remain part of the product name');
  assert.equal(normalizeProductName('Lait 1%'), 'lait 1%', 'Packaging and punctuation are not discarded');
});

test('Only exact names reuse products; autocomplete prefixes and empty names cannot resolve to a product', () => {
  const products = [product('milk', 'Lait entier'), product('chocolate', 'Chocolat noir'), product('nameless', undefined)];
  assert.strictEqual(findProductByName(products, '  LAIT ENTIER  '), products[0]);
  for (const name of ['Lait', 'Lait entier bio', 'Chocolat', '', '   ']) {
    assert.deepEqual(findProductsByName(products, name), [], name);
    assert.equal(findProductByName(products, name), undefined, name);
  }
});

test('Matching returns the original catalogue entry without changing its name, codes or ordering', () => {
  const products = [product('coffee', 'Café'), product('item', 'CAFE', 'item'), product('shopping', 'Café', 'shopping')];
  const before = structuredClone(products);
  assert.deepEqual(findProductsByName(products, 'cafe').map(entry => entry.id), ['coffee']);
  assert.strictEqual(findProductByName(products, 'cafe'), products[0]);
  assert.deepEqual(products, before);
});

test('Duplicate normalized names require an explicit choice instead of selecting an arbitrary product', () => {
  const products = [product('one', 'Café'), product('two', 'CAFE\u0301')];
  assert.deepEqual(findProductsByName(products, 'cafe').map(entry => entry.id), ['one', 'two']);
  assert.equal(findProductByName(products, 'cafe'), undefined);
  assert.equal(findProductByName([...products].reverse(), 'cafe'), undefined);
  assert.equal(findProductByName([], 'Café'), undefined);
});
