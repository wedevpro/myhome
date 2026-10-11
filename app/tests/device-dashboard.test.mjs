import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../lib/device-dashboard.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { DEVICE_DASHBOARD_STORAGE_KEY: key, DEFAULT_DEVICE_DASHBOARD: defaults, parseDeviceDashboard, createDeviceDashboardStore } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));

function browser(initial = null) {
  const values = new Map(initial === null ? [] : [[key, initial]]);
  const listeners = new Set();
  const writes = [];
  const storage = {
    getItem: name => values.get(name) ?? null,
    setItem: (name, value) => { values.set(name, value); writes.push([name, value]); },
  };
  return {
    values, listeners, writes, storage,
    environment: {
      getStorage: () => storage,
      subscribeStorage: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    },
    externalChange: (name, value) => {
      if (name === null) values.clear();
      else if (value === null) values.delete(name);
      else values.set(name, value);
      for (const listener of [...listeners]) listener({ key: name, newValue: value });
    },
  };
}

test('Device dashboard defaults and SSR snapshots are stable without touching storage', () => {
  let reads = 0;
  const store = createDeviceDashboardStore({ getStorage: () => { reads++; throw new Error('window unavailable'); } });
  assert.strictEqual(store.getSnapshot(), defaults);
  assert.strictEqual(store.getSnapshot(), store.getSnapshot());
  assert.strictEqual(store.getServerSnapshot(), defaults);
  assert.strictEqual(store.getServerSnapshot(), store.getServerSnapshot());
  assert.equal(store.getInitializationSnapshot(), false);
  assert.equal(store.getServerInitializationSnapshot(), false);
  assert.equal(reads, 0);
  assert.deepEqual(defaults, { showElectricity: true, showWaste: true });
  assert.equal(Object.isFrozen(defaults), true);
});

test('Stored preferences accept booleans only and default every missing or invalid value', () => {
  for (const raw of [null, '', 'invalid JSON', 'null', 'false', '42', '[]', '"text"', '{}']) {
    assert.strictEqual(parseDeviceDashboard(raw), defaults);
  }
  assert.deepEqual(parseDeviceDashboard('{"showElectricity":false}'), { showElectricity: false, showWaste: true });
  assert.deepEqual(parseDeviceDashboard('{"showWaste":false}'), { showElectricity: true, showWaste: false });
  assert.deepEqual(parseDeviceDashboard('{"showElectricity":"false","showWaste":false,"userId":"ignored","householdId":"ignored"}'), { showElectricity: true, showWaste: false });
  assert.strictEqual(parseDeviceDashboard('{"showElectricity":0,"showWaste":null}'), defaults);
  assert.equal(Object.isFrozen(parseDeviceDashboard('{"showWaste":false}')), true);
});

test('Subscription loads local preferences and updates are persisted to the device key only', () => {
  const device = browser('{"showElectricity":false,"showWaste":false,"householdId":"old"}');
  const store = createDeviceDashboardStore(device.environment);
  let notifications = 0;
  const release = store.subscribe(() => notifications++);
  assert.equal(store.getInitializationSnapshot(), true);
  assert.equal(store.getServerInitializationSnapshot(), false);
  assert.deepEqual(store.getSnapshot(), { showElectricity: false, showWaste: false });
  const initialSnapshot = store.getSnapshot();
  assert.strictEqual(store.getSnapshot(), initialSnapshot);
  store.setVisibility('showElectricity', true);
  assert.deepEqual(store.getSnapshot(), { showElectricity: true, showWaste: false });
  assert.deepEqual(device.writes, [[key, '{"showElectricity":true,"showWaste":false}']]);
  const updatedSnapshot = store.getSnapshot();
  store.setVisibility('showElectricity', true);
  assert.strictEqual(store.getSnapshot(), updatedSnapshot);
  assert.equal(notifications, 2, 'load and one actual change notify; identical snapshots do not');
  assert.strictEqual(store.getServerSnapshot(), defaults, 'saved device values never leak into SSR');
  release();
  assert.equal(device.listeners.size, 0);
});

test('Other tabs synchronize changes, invalid values and deletion or clearing reset defaults', () => {
  const device = browser();
  const store = createDeviceDashboardStore(device.environment);
  let notifications = 0;
  const release = store.subscribe(() => notifications++);
  assert.equal(store.getInitializationSnapshot(), true, 'a default-valued storage read still marks the store ready');
  assert.equal(store.getServerInitializationSnapshot(), false);
  assert.equal(notifications, 0, 'readiness does not notify settings consumers when values are unchanged');
  device.externalChange('some-other-key', '{"showWaste":false}');
  assert.strictEqual(store.getSnapshot(), defaults);
  assert.equal(notifications, 0);
  device.externalChange(key, '{"showElectricity":false,"showWaste":true}');
  const changed = store.getSnapshot();
  assert.deepEqual(changed, { showElectricity: false, showWaste: true });
  device.externalChange(key, '{"showWaste":true,"showElectricity":false,"ignored":1}');
  assert.strictEqual(store.getSnapshot(), changed);
  assert.equal(notifications, 1);
  device.externalChange(key, null);
  assert.strictEqual(store.getSnapshot(), defaults);
  device.externalChange(key, '{"showWaste":false}');
  device.externalChange(null, null);
  assert.strictEqual(store.getSnapshot(), defaults);
  device.externalChange(key, '{"showElectricity":false}');
  device.externalChange(key, 'bad JSON');
  assert.strictEqual(store.getSnapshot(), defaults);
  assert.equal(device.writes.length, 0, 'storage events must not echo writes back to the other tabs');
  release();
});

test('One browser store shares changes among consumers and releases the listener at the last unsubscribe', () => {
  const device = browser();
  const store = createDeviceDashboardStore(device.environment);
  let first = 0, second = 0;
  const releaseFirst = store.subscribe(() => first++);
  const releaseSecond = store.subscribe(() => second++);
  assert.equal(device.listeners.size, 1);
  store.setVisibility('showWaste', false);
  assert.equal(first, 1);
  assert.equal(second, 1);
  releaseFirst();
  assert.equal(device.listeners.size, 1);
  device.externalChange(key, null);
  assert.equal(first, 1);
  assert.equal(second, 2);
  releaseSecond();
  assert.equal(device.listeners.size, 0);
  device.externalChange(key, '{"showElectricity":false,"showWaste":false}');
  assert.strictEqual(store.getSnapshot(), defaults, 'unmounted stores have no active browser listener');
  const releaseAgain = store.subscribe(() => {});
  assert.deepEqual(store.getSnapshot(), { showElectricity: false, showWaste: false }, 'remount loads a change missed while unsubscribed');
  releaseAgain();
});

test('Blocked localStorage remains usable in memory for the complete browsing session', () => {
  const store = createDeviceDashboardStore({ getStorage: () => { throw new Error('blocked'); }, subscribeStorage: () => { throw new Error('unavailable'); } });
  assert.equal(store.getInitializationSnapshot(), false);
  let notifications = 0;
  let release = store.subscribe(() => notifications++);
  assert.equal(store.getInitializationSnapshot(), true, 'blocked storage also completes the initial read attempt');
  assert.equal(store.getServerInitializationSnapshot(), false);
  assert.equal(notifications, 0);
  store.setVisibility('showWaste', false);
  store.setVisibility('showElectricity', false);
  const savedInMemory = store.getSnapshot();
  assert.deepEqual(savedInMemory, { showElectricity: false, showWaste: false });
  assert.equal(notifications, 2);
  release();
  release = store.subscribe(() => notifications++);
  assert.strictEqual(store.getSnapshot(), savedInMemory);
  assert.strictEqual(store.getServerSnapshot(), defaults);
  store.setVisibility('showWaste', true);
  assert.deepEqual(store.getSnapshot(), { showElectricity: false, showWaste: true });
  release();
});

test('A failed write cannot overwrite session preferences with older persisted settings on remount', () => {
  const device = browser('{"showElectricity":false,"showWaste":false}');
  device.storage.setItem = () => { throw new Error('quota exceeded'); };
  const store = createDeviceDashboardStore(device.environment);
  let release = store.subscribe(() => {});
  store.setVisibility('showElectricity', true);
  assert.deepEqual(store.getSnapshot(), { showElectricity: true, showWaste: false });
  assert.equal(device.values.get(key), '{"showElectricity":false,"showWaste":false}');
  release();
  release = store.subscribe(() => {});
  assert.deepEqual(store.getSnapshot(), { showElectricity: true, showWaste: false });
  device.externalChange(key, null);
  assert.strictEqual(store.getSnapshot(), defaults, 'an explicit deletion from another tab still resets the local store');
  release();
});

test('Separate devices and storage-free stores keep independent preferences', () => {
  const phone = browser();
  const tablet = browser();
  const phoneStore = createDeviceDashboardStore(phone.environment);
  const tabletStore = createDeviceDashboardStore(tablet.environment);
  phoneStore.setVisibility('showElectricity', false);
  tabletStore.setVisibility('showWaste', false);
  assert.deepEqual(phoneStore.getSnapshot(), { showElectricity: false, showWaste: true });
  assert.deepEqual(tabletStore.getSnapshot(), { showElectricity: true, showWaste: false });
  const reloadedPhone = createDeviceDashboardStore(phone.environment);
  const release = reloadedPhone.subscribe(() => {});
  assert.deepEqual(reloadedPhone.getSnapshot(), phoneStore.getSnapshot());
  release();
  const transient = createDeviceDashboardStore({ getStorage: () => null });
  transient.setVisibility('showWaste', false);
  assert.deepEqual(transient.getSnapshot(), { showElectricity: true, showWaste: false });
  assert.strictEqual(createDeviceDashboardStore({ getStorage: () => null }).getSnapshot(), defaults);
});
