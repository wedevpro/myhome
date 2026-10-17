import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../app/src/main/assets/native-scanner.js', import.meta.url), 'utf8');
const origin = 'https://maison.example.test';

function page({ pageOrigin = origin, iframe = false, reply = '{"status":"ok","code":"0012345678905"}', existing } = {}) {
  const calls = [];
  const window = { location: { origin: pageOrigin, protocol: new URL(pageOrigin).protocol } };
  window.top = iframe ? {} : window;
  window.prompt = function (...args) {
    calls.push({ receiver: this, args });
    return typeof reply === 'function' ? reply() : reply;
  };
  if (existing !== undefined) window.myHomeNativeScanner = existing;
  const context = vm.createContext({ window });
  return { window, calls, install: () => vm.runInContext(source + '(' + JSON.stringify(origin) + ');', context) };
}

test('Native scanner installs only in the exact configured HTTPS top-level origin', () => {
  for (const settings of [
    { pageOrigin: 'https://other.example.test' },
    { pageOrigin: 'http://maison.example.test' },
    { pageOrigin: 'https://maison.example.test:8443' },
    { pageOrigin: 'https://maison.example.test.evil.test' },
    { iframe: true },
  ]) {
    const fixture = page(settings);
    fixture.install();
    assert.equal(fixture.window.myHomeNativeScanner, undefined);
    assert.equal(fixture.calls.length, 0);
  }
  const fixture = page();
  fixture.install();
  assert.equal(fixture.window.myHomeNativeScanner.version, 1);
  assert.equal(fixture.calls.length, 0, 'Injection must never open the camera');
});

test('Native scanner capability is frozen, read-only and idempotent', () => {
  const fixture = page();
  fixture.install();
  const scanner = fixture.window.myHomeNativeScanner;
  fixture.install();
  assert.strictEqual(fixture.window.myHomeNativeScanner, scanner);
  assert.ok(Object.isFrozen(scanner));
  const descriptor = Object.getOwnPropertyDescriptor(fixture.window, 'myHomeNativeScanner');
  assert.equal(descriptor.writable, false);
  assert.equal(descriptor.configurable, false);
  const existing = { version: 7 };
  const preinstalled = page({ existing });
  preinstalled.install();
  assert.strictEqual(preinstalled.window.myHomeNativeScanner, existing);
});

test('Both camera choices send only their camera to the reserved native prompt and return synchronously', () => {
  const expected = '{"status":"ok","code":"0012345678905"}';
  const fixture = page({ reply: expected });
  fixture.install();
  for (const camera of ['environment', 'user']) {
    const result = fixture.window.myHomeNativeScanner.scan(camera);
    assert.strictEqual(result, expected);
    assert.deepEqual(fixture.calls.at(-1).args, ['myhome:native-scan:v1', camera]);
    assert.strictEqual(fixture.calls.at(-1).receiver, fixture.window);
  }
  assert.equal(fixture.calls.length, 2);
});

test('Invalid camera values never invoke the native prompt', () => {
  const fixture = page();
  fixture.install();
  for (const camera of [undefined, null, '', 'rear', 'ENVIRONMENT', 'environment\n', {}, 0]) {
    const result = JSON.parse(fixture.window.myHomeNativeScanner.scan(camera));
    assert.equal(result.status, 'error');
    assert.ok(result.message);
    assert.equal(fixture.calls.length, 0);
  }
});

test('Dismissed or interrupted native prompts become cancellation without a code', () => {
  for (const reply of [null, undefined, '']) {
    const fixture = page({ reply: () => reply });
    fixture.install();
    assert.deepEqual(JSON.parse(fixture.window.myHomeNativeScanner.scan('environment')), { status: 'cancelled' });
    assert.equal(fixture.calls.length, 1);
  }
});

test('The original prompt receiver is retained after injection', () => {
  const fixture = page();
  fixture.install();
  fixture.window.prompt = () => { throw new Error('Replaced prompt'); };
  assert.equal(JSON.parse(fixture.window.myHomeNativeScanner.scan('environment')).code, '0012345678905');
  assert.equal(fixture.calls.length, 1);
});

test('Camera errors pass through to the web validator and thrown prompts remain errors', () => {
  const expected = '{"status":"error","message":"Permission caméra refusée."}';
  const fixture = page({ reply: expected });
  fixture.install();
  assert.strictEqual(fixture.window.myHomeNativeScanner.scan('user'), expected);
  const failed = page({ reply() { throw new Error('Document closed'); } });
  failed.install();
  assert.throws(() => failed.window.myHomeNativeScanner.scan('environment'), /Document closed/);
});
