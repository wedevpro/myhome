import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../lib/validation.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText
  .replace(/from ["']zod["']/, 'from ' + JSON.stringify(import.meta.resolve('zod')));
const { dataSchemas } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
const legacyItem = { name: 'Lait', listId: 'shopping-list', productId: 'known-product' };

test('Article : compatibilité des anciens articles sans commentaire', () => {
  const result = dataSchemas.item.parse(legacyItem);
  assert.equal(result.comment, '');
  assert.equal(result.quantity, 1);
  assert.equal(result.productId, legacyItem.productId);
  assert.equal(result.listId, legacyItem.listId);
  assert.equal(Object.hasOwn(legacyItem, 'comment'), false);
  const existing = dataSchemas.item.parse({ ...legacyItem, quantity: 2.5, unit: 'L', checked: true });
  assert.equal(existing.quantity, 2.5);
  assert.equal(existing.unit, 'L');
  assert.equal(existing.checked, true);
  assert.equal(existing.comment, '');
});
test('Article : quantités décimales positives et limite de 10000', () => {
  for (const quantity of [0.25, 1, 2.5, 10000]) {
    assert.equal(dataSchemas.item.parse({ ...legacyItem, quantity }).quantity, quantity);
  }
  for (const quantity of [0, -1, 10000.01, Infinity, NaN, '2', null]) {
    assert.equal(dataSchemas.item.safeParse({ ...legacyItem, quantity }).success, false, `Quantité refusée : ${String(quantity)}`);
  }
});
test('Article : commentaire libre, suppression et limite de 2000 caractères', () => {
  const comment = 'Sans lactose, si possible.\nFormat familial — merci !';
  assert.equal(dataSchemas.item.parse({ ...legacyItem, comment }).comment, comment);
  assert.equal(dataSchemas.item.parse({ ...legacyItem, comment: '' }).comment, '');
  assert.equal(dataSchemas.item.parse({ ...legacyItem, comment: 'é'.repeat(2000) }).comment.length, 2000);
  for (const invalidComment of ['a'.repeat(2001), 42, true, null, ['texte']]) {
    assert.equal(dataSchemas.item.safeParse({ ...legacyItem, comment: invalidComment }).success, false);
  }
});
test('Produit : les commentaires restent propres aux articles de liste', () => {
  const product = dataSchemas.product.parse({ name: 'Lait', category: 'Frais', barcodes: ['0001234567890'], comment: 'Uniquement pour cette course', quantity: 2.5 });
  assert.deepEqual(product, { name: 'Lait', category: 'Frais', barcodes: ['0001234567890'] });
  assert.equal(Object.hasOwn(product, 'comment'), false);
  assert.equal(Object.hasOwn(product, 'quantity'), false);
});
