import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../lib/app-navigation-history.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { createAppNavigationHistory } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));

function fakeBrowser() {
  const href = 'https://myhome.test/';
  const nextState = { __NA: true, __PRIVATE_NEXTJS_INTERNALS_TREE: { route: 'home' }, unrelated: 'keep' };
  const entries = [{ state: { external: true }, href: 'https://before.test/' }, { state: nextState, href }];
  let pointer = 1;
  const listeners = new Set();
  const traversals = [];
  let exited = false;
  let pushes = 0;
  const host = {
    location: { get href() { return entries[pointer].href; } },
    history: {
      get state() { return structuredClone(entries[pointer].state); },
      pushState(state, title, nextHref) {
        entries.splice(pointer + 1, entries.length, { state: structuredClone(state), href: nextHref });
        pointer++;
        pushes++;
      },
      replaceState(state, title, nextHref) { entries[pointer] = { state: structuredClone(state), href: nextHref }; },
      go(delta) { traversals.push(delta); },
      back() { this.go(-1); },
    },
    addEventListener(type, listener) { assert.equal(type, 'popstate'); listeners.add(listener); },
    removeEventListener(type, listener) { assert.equal(type, 'popstate'); listeners.delete(listener); },
  };
  return {
    host,
    entries,
    listeners,
    get pointer() { return pointer; },
    get pushes() { return pushes; },
    get exited() { return exited; },
    flush() {
      let count = 0;
      while (traversals.length) {
        assert.ok(++count < 100, 'Back handling must finish without a traversal loop.');
        const destination = pointer + traversals.shift();
        if (destination < 0 || destination >= entries.length) continue;
        pointer = destination;
        if (entries[pointer].href !== href) exited = true;
        for (const listener of listeners) listener({ state: structuredClone(entries[pointer].state) });
      }
    },
    emit(state = host.history.state) { for (const listener of listeners) listener({ state }); },
  };
}

test('Retour restaure les pages et Avancer conserve les visites suivantes', () => {
  const browser = fakeBrowser();
  const restored = [];
  const navigation = createAppNavigationHistory(browser.host, { initial: { page: 'dashboard' }, onRestore: scene => restored.push(scene) });
  navigation.record({ page: 'checklists', selectedId: 'valise' });
  navigation.record({ page: 'checklists', selectedId: 'toilette' });
  navigation.back();
  assert.deepEqual(restored, [], 'Native history traversal is asynchronous.');
  browser.flush();
  assert.deepEqual(restored.at(-1), { page: 'checklists', selectedId: 'valise' });
  navigation.back();
  browser.flush();
  assert.deepEqual(restored.at(-1), { page: 'dashboard' });
  browser.host.history.go(1);
  browser.flush();
  assert.deepEqual(restored.at(-1), { page: 'checklists', selectedId: 'valise' });
  browser.host.history.go(1);
  browser.flush();
  assert.deepEqual(restored.at(-1), { page: 'checklists', selectedId: 'toilette' });
});

test('Sans page précédente, Retour reste sur place sans empiler de nouvelles entrées', () => {
  const browser = fakeBrowser();
  const restored = [];
  const navigation = createAppNavigationHistory(browser.host, { initial: { page: 'dashboard' }, onRestore: scene => restored.push(scene) });
  const originalLength = browser.entries.length;
  const originalPushes = browser.pushes;
  for (let attempt = 0; attempt < 20; attempt++) {
    navigation.back();
    browser.flush();
    assert.equal(browser.pointer, 2);
    assert.equal(browser.exited, false);
  }
  assert.equal(browser.entries.length, originalLength);
  assert.equal(browser.pushes, originalPushes);
  assert.deepEqual(restored, []);
});

test('Le garde de racine ne supprime pas les pages disponibles en navigation avant', () => {
  const browser = fakeBrowser();
  const restored = [];
  const navigation = createAppNavigationHistory(browser.host, { initial: 'dashboard', onRestore: scene => restored.push(scene) });
  navigation.record('notes');
  navigation.back(); browser.flush();
  navigation.back(); browser.flush();
  browser.host.history.go(1); browser.flush();
  assert.equal(restored.at(-1), 'notes');
});

test('Le checkpoint mémorise le scroll et le filtre sans ajouter de page', () => {
  const browser = fakeBrowser();
  const restored = [];
  const navigation = createAppNavigationHistory(browser.host, { initial: { page: 'checklists', scroll: 0, filter: '' }, onRestore: scene => restored.push(scene) });
  const length = browser.entries.length;
  navigation.checkpoint({ page: 'checklists', scroll: 420, filter: 'vêtements' });
  assert.equal(browser.entries.length, length);
  navigation.record({ page: 'notes', scroll: 0, filter: '' });
  navigation.back(); browser.flush();
  assert.deepEqual(restored.at(-1), { page: 'checklists', scroll: 420, filter: 'vêtements' });
});

test('Une nouvelle visite après Retour remplace seulement la branche avant', () => {
  const browser = fakeBrowser();
  const restored = [];
  const navigation = createAppNavigationHistory(browser.host, { initial: 'dashboard', onRestore: scene => restored.push(scene) });
  navigation.record('shopping');
  navigation.record('notes');
  navigation.back(); browser.flush();
  navigation.record('contacts');
  navigation.back(); browser.flush();
  browser.host.history.go(1); browser.flush();
  assert.equal(restored.at(-1), 'contacts');
  assert.ok(!restored.includes('notes'));
});

test('Le retour ferme un overlay, reste sur sa page et conserve la navigation suivante', () => {
  const browser = fakeBrowser();
  const restored = [];
  let overlay = true;
  const navigation = createAppNavigationHistory(browser.host, {
    initial: 'dashboard', onRestore: scene => restored.push(scene),
    onBeforeBack() { if (!overlay) return false; overlay = false; return true; },
  });
  navigation.record('notes');
  const length = browser.entries.length;
  navigation.back(); browser.flush();
  assert.equal(overlay, false);
  assert.deepEqual(restored, []);
  assert.equal(browser.entries.length, length);
  navigation.back(); browser.flush();
  assert.equal(restored.at(-1), 'dashboard');
  browser.host.history.go(1); browser.flush();
  assert.equal(restored.at(-1), 'notes');
});

test('Un overlay est fermé aussi sur la première page et ne déclenche pas de double fermeture', () => {
  const browser = fakeBrowser();
  let calls = 0;
  let overlay = true;
  const navigation = createAppNavigationHistory(browser.host, {
    initial: 'dashboard', onRestore() { assert.fail('The initial page must not change.'); },
    onBeforeBack() { calls++; if (!overlay) return false; overlay = false; return true; },
  });
  navigation.back(); browser.flush();
  assert.equal(calls, 1);
  navigation.back(); browser.flush();
  assert.equal(calls, 2);
  assert.equal(browser.exited, false);
});

test('Les métadonnées Next restent intactes et les données privées de page restent en mémoire', () => {
  const browser = fakeBrowser();
  const navigation = createAppNavigationHistory(browser.host, { initial: { selectedId: 'private-id', query: 'private-search' }, onRestore() {} });
  navigation.record({ selectedId: 'private-contact', query: 'private-email' });
  for (const { state } of browser.entries.slice(1)) {
    assert.equal(state.__NA, true);
    assert.deepEqual(state.__PRIVATE_NEXTJS_INTERNALS_TREE, { route: 'home' });
    assert.equal(state.unrelated, 'keep');
    assert.ok(!JSON.stringify(state).includes('private-'));
    assert.deepEqual(Object.keys(state.__myhome_navigation).sort(), ['index', 'session']);
  }
});

test('Changer de foyer neutralise les anciennes pages et les anciennes traversées en attente', () => {
  const browser = fakeBrowser();
  const restored = [];
  const navigation = createAppNavigationHistory(browser.host, { initial: 'foyer A dashboard', onRestore: scene => restored.push(scene) });
  navigation.record('foyer A notes');
  navigation.back();
  navigation.reset('foyer B dashboard');
  browser.flush();
  assert.ok(!restored.some(scene => scene.startsWith('foyer A')));
  navigation.back(); browser.flush();
  assert.equal(browser.exited, false);
  navigation.record('foyer B checklist');
  navigation.back(); browser.flush();
  assert.equal(restored.at(-1), 'foyer B dashboard');
});

test('Strict Mode dispose puis recrée le contrôleur sans restaurer de vieilles scènes', () => {
  const browser = fakeBrowser();
  const restored = [];
  const first = createAppNavigationHistory(browser.host, { initial: 'old page', onRestore: scene => restored.push(scene) });
  first.record('old notes');
  const pointer = browser.pointer;
  first.dispose();
  first.dispose();
  assert.equal(browser.pointer, pointer, 'Cleanup must never traverse the browser history.');
  assert.equal(browser.listeners.size, 0);
  const second = createAppNavigationHistory(browser.host, { initial: 'current page', onRestore: scene => restored.push(scene) });
  assert.equal(browser.listeners.size, 1);
  second.back(); browser.flush();
  assert.deepEqual(restored, []);
  second.record('current notes');
  second.back(); browser.flush();
  assert.equal(restored.at(-1), 'current page');
  first.record('disposed write');
  first.back();
  first.reset('disposed reset');
  browser.flush();
  assert.equal(restored.at(-1), 'current page');
});

test('Un ancien état de rechargement ne restaure ni les anciennes données ni une autre URL', () => {
  const browser = fakeBrowser();
  browser.host.history.replaceState({ __NA: true, __myhome_navigation: { session: 'before-reload', index: 6 } }, '', browser.host.location.href);
  const restored = [];
  const navigation = createAppNavigationHistory(browser.host, { initial: 'reloaded dashboard', onRestore: scene => restored.push(scene) });
  navigation.back(); browser.flush();
  assert.equal(browser.exited, false);
  assert.deepEqual(restored, []);
});

test('Plusieurs retours en attente restaurent le dernier curseur sans boucle', () => {
  const browser = fakeBrowser();
  const restored = [];
  const navigation = createAppNavigationHistory(browser.host, { initial: 'dashboard', onRestore: scene => restored.push(scene) });
  navigation.record('shopping');
  navigation.record('checklists');
  navigation.record('notes');
  navigation.back();
  navigation.back();
  browser.flush();
  assert.deepEqual(restored, ['checklists', 'shopping']);
  assert.equal(browser.exited, false);
  const count = restored.length;
  browser.emit();
  assert.equal(restored.length, count, 'A duplicate popstate must not restore a second time.');
});

test('Des retours rapides pendant la fermeture d’un overlay reviennent au bon curseur', () => {
  const browser = fakeBrowser();
  const restored = [];
  let overlay = false;
  const navigation = createAppNavigationHistory(browser.host, {
    initial: 'dashboard', onRestore: scene => restored.push(scene),
    onBeforeBack() { if (!overlay) return false; overlay = false; return true; },
  });
  navigation.record('shopping');
  navigation.record('checklists');
  navigation.record('notes');
  navigation.record('contacts');
  navigation.back(); browser.flush();
  assert.equal(restored.at(-1), 'notes');
  const pointer = browser.pointer;
  const length = browser.entries.length;
  overlay = true;
  navigation.back();
  navigation.back();
  browser.flush();
  assert.equal(browser.pointer, pointer);
  assert.equal(browser.entries.length, length);
  assert.equal(restored.at(-1), 'notes');
  navigation.back(); browser.flush();
  assert.equal(restored.at(-1), 'checklists');
});

test('Une traversée au garde depuis une page éloignée restaure la première page', () => {
  const browser = fakeBrowser();
  const restored = [];
  const navigation = createAppNavigationHistory(browser.host, { initial: 'dashboard', onRestore: scene => restored.push(scene) });
  navigation.record('shopping');
  navigation.record('notes');
  browser.host.history.go(-3); browser.flush();
  assert.deepEqual(restored, ['dashboard']);
  assert.equal(browser.exited, false);
  browser.host.history.go(1); browser.flush();
  assert.equal(restored.at(-1), 'shopping');
});

test('Une ancienne entrée d’un autre foyer ne peut pas révéler ses données après reset', () => {
  const browser = fakeBrowser();
  const restored = [];
  const navigation = createAppNavigationHistory(browser.host, {
    initial: { household: 'A', page: 'dashboard' }, onRestore: scene => restored.push(scene),
  });
  navigation.record({ household: 'A', page: 'contacts', selectedId: 'private-person' });
  const oldState = browser.host.history.state;
  navigation.record({ household: 'A', page: 'notes', query: 'private-note' });
  navigation.reset({ household: 'B', page: 'dashboard' });
  browser.host.history.go(-2); browser.flush();
  assert.deepEqual(restored, []);
  const currentSession = browser.host.history.state.__myhome_navigation.session;
  assert.notEqual(currentSession, oldState.__myhome_navigation.session);
  navigation.record({ household: 'B', page: 'shopping' });
  navigation.back(); browser.flush();
  assert.deepEqual(restored, [{ household: 'B', page: 'dashboard' }]);
  assert.ok(!JSON.stringify(browser.host.history.state).includes('private-'));
});

test('Un curseur inconnu ou malformé recrée une borne sûre et garde la page courante', () => {
  for (const invalid of [undefined, null, {}, { session: 'foreign', index: 2 }, { index: -1 }, { index: 1.5 }, { index: '2' }, { index: 1000 }]) {
    const browser = fakeBrowser();
    const restored = [];
    const navigation = createAppNavigationHistory(browser.host, { initial: 'dashboard', onRestore: scene => restored.push(scene) });
    navigation.record('notes');
    const session = browser.host.history.state.__myhome_navigation.session;
    const marker = invalid && typeof invalid === 'object' ? { session, ...invalid } : invalid;
    browser.host.history.replaceState({ ...browser.host.history.state, __myhome_navigation: marker }, '', browser.host.location.href);
    browser.emit();
    navigation.back(); browser.flush();
    assert.deepEqual(restored, []);
    assert.equal(browser.exited, false);
    navigation.record('contacts');
    navigation.back(); browser.flush();
    assert.equal(restored.at(-1), 'notes');
  }
});

test('Un retour encore en attente lors d’un remontage n’atteint pas les snapshots supprimés', () => {
  const browser = fakeBrowser();
  const restored = [];
  const first = createAppNavigationHistory(browser.host, { initial: 'old dashboard', onRestore: scene => restored.push(scene) });
  first.record('old notes');
  first.back();
  first.dispose();
  const second = createAppNavigationHistory(browser.host, { initial: 'current dashboard', onRestore: scene => restored.push(scene) });
  browser.flush();
  assert.deepEqual(restored, []);
  second.back(); browser.flush();
  assert.equal(browser.exited, false);
  second.record('current shopping');
  second.back(); browser.flush();
  assert.equal(restored.at(-1), 'current dashboard');
});
