import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../app/src/main/assets/camera-focus.js', import.meta.url), 'utf8');
const origin = 'https://maison.example.test';
const plain = value => JSON.parse(JSON.stringify(value));
const settle = async () => {
  for (let index = 0; index < 12; index++) await Promise.resolve();
};

class Events {
  listeners = new Map();

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event) {
    event.target ||= this;
    event.currentTarget = this;
    for (const listener of this.listeners.get(event.type) || []) {
      if (typeof listener === 'function') listener.call(this, event);
      else listener.handleEvent(event);
    }
    return true;
  }
}

class Video extends Events {
  tagName = 'VIDEO';

  constructor(stream) {
    super();
    this.srcObject = stream;
  }

  closest(selector) {
    return selector === 'video' ? this : null;
  }
}

class Stream {
  constructor(tracks = []) { this.tracks = tracks; }
  getVideoTracks() { return this.tracks.filter(track => track.kind === 'video'); }
  getTracks() { return this.tracks; }
}

function camera(options = {}) {
  const calls = [];
  const constraints = options.constraints || { width: { ideal: 1280 }, height: { ideal: 720 } };
  const track = {
    kind: 'video',
    readyState: 'live',
    getSettings: () => ({ facingMode: 'environment' }),
    getCapabilities: () => ({ focusMode: ['manual', 'single-shot', 'continuous'] }),
    getConstraints: () => constraints,
    applyConstraints(value) {
      calls.push(value);
      return options.applyConstraints ? options.applyConstraints(value) : Promise.resolve();
    },
    ...options.track,
  };
  return { track, constraints, calls, stream: new Stream([track]) };
}

function page({ pageOrigin = origin, iframe = false, getUserMedia } = {}) {
  const window = new Events();
  const document = new Events();
  const calls = [];
  let forbiddenCalls = 0;
  const forbidden = () => {
    forbiddenCalls++;
    throw new Error('The focus helper must not use timers, device enumeration or extra permissions');
  };
  const mediaDevices = {
    getUserMedia: getUserMedia || function (...args) {
      calls.push({ receiver: this, args });
      return Promise.resolve(new Stream());
    },
    enumerateDevices: forbidden,
  };
  const navigator = { mediaDevices, permissions: { query: forbidden } };
  const location = { origin: pageOrigin, protocol: new URL(pageOrigin).protocol };
  Object.assign(window, {
    window, self: window, top: iframe ? {} : window,
    document, navigator, location, HTMLVideoElement: Video, MediaStream: Stream,
    setTimeout: forbidden, setInterval: forbidden, requestAnimationFrame: forbidden,
  });
  const context = vm.createContext({
    window, self: window, top: window.top, document, navigator, location,
    HTMLVideoElement: Video, MediaStream: Stream, console,
    setTimeout: forbidden, setInterval: forbidden, requestAnimationFrame: forbidden,
  });
  const install = () => vm.runInContext(source + '(' + JSON.stringify(origin) + ');', context);
  const click = target => {
    const event = {
      type: 'click', target, isTrusted: true,
      composedPath: () => [target, document, window],
      preventDefault() {}, stopPropagation() {},
    };
    target.dispatchEvent?.(event);
    document.dispatchEvent(event);
    window.dispatchEvent(event);
  };
  return { window, document, navigator, mediaDevices, calls, install, click, forbiddenCalls: () => forbiddenCalls };
}

test('Installs only in the exact HTTPS top-level origin', () => {
  for (const settings of [
    { pageOrigin: 'https://other.example.test' },
    { pageOrigin: 'http://maison.example.test' },
    { pageOrigin: 'https://maison.example.test:8443' },
    { pageOrigin: 'https://maison.example.test.evil.test' },
    { iframe: true },
  ]) {
    const fixture = page(settings);
    const original = fixture.mediaDevices.getUserMedia;
    fixture.install();
    assert.strictEqual(fixture.mediaDevices.getUserMedia, original, JSON.stringify(settings));
    assert.equal(fixture.document.listeners.size + fixture.window.listeners.size, 0);
  }
  const fixture = page();
  const original = fixture.mediaDevices.getUserMedia;
  fixture.install();
  assert.notStrictEqual(fixture.mediaDevices.getUserMedia, original);
});

test('Repeated injection keeps one wrapper and preserves the original receiver and arguments', async () => {
  const rear = camera();
  const received = [];
  const fixture = page({ getUserMedia: function (...args) {
    received.push({ receiver: this, args });
    return Promise.resolve(rear.stream);
  } });
  fixture.install();
  const wrapped = fixture.mediaDevices.getUserMedia;
  fixture.install();
  assert.strictEqual(fixture.mediaDevices.getUserMedia, wrapped);
  const receiver = {};
  const constraints = { video: { facingMode: 'environment' }, audio: false };
  const extra = {};
  assert.strictEqual(await wrapped.call(receiver, constraints, extra), rear.stream);
  await settle();
  assert.equal(received.length, 1);
  assert.strictEqual(received[0].receiver, receiver);
  assert.strictEqual(received[0].args[0], constraints);
  assert.strictEqual(received[0].args[1], extra);
  assert.equal(rear.calls.length, 1, 'Repeated injection must not duplicate focus requests');
});

test('Returns the acquired stream without awaiting a blocked focus request', async () => {
  const rear = camera({ applyConstraints: () => new Promise(() => {}) });
  const fixture = page({ getUserMedia: () => Promise.resolve(rear.stream) });
  fixture.install();
  let returned;
  fixture.mediaDevices.getUserMedia({ video: true }).then(stream => { returned = stream; });
  await settle();
  assert.strictEqual(returned, rear.stream);
  assert.equal(rear.calls.length, 1);
});

test('Preserves camera permission/device failures from the original getUserMedia', async () => {
  const refusal = new Error('NotAllowedError');
  const fixture = page({ getUserMedia: () => Promise.reject(refusal) });
  fixture.install();
  await assert.rejects(fixture.mediaDevices.getUserMedia({ video: true }), error => error === refusal);
});

test('Continuous autofocus preserves the existing resolution and advanced camera constraints', async () => {
  const originalConstraints = {
    width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { max: 30 },
    facingMode: { ideal: 'environment' }, advanced: [{ zoom: 1.5 }, { torch: true }],
  };
  const snapshot = structuredClone(originalConstraints);
  const rear = camera({ constraints: originalConstraints });
  const fixture = page({ getUserMedia: () => Promise.resolve(rear.stream) });
  fixture.install();
  assert.strictEqual(await fixture.mediaDevices.getUserMedia({ video: true }), rear.stream);
  await settle();
  assert.equal(rear.calls.length, 1);
  const applied = plain(rear.calls[0]);
  for (const key of ['width', 'height', 'frameRate', 'facingMode']) {
    assert.deepEqual(applied[key], snapshot[key], key);
  }
  assert.deepEqual(applied.advanced.slice(0, 2), snapshot.advanced);
  assert.ok(applied.advanced.some(constraint => constraint.focusMode === 'continuous'));
  assert.deepEqual(originalConstraints, snapshot, 'The browser-owned constraint object remains unchanged');
});

test('Uses actual rear-camera settings even when no rear camera was requested', async () => {
  const rear = camera();
  const fixture = page({ getUserMedia: () => Promise.resolve(rear.stream) });
  fixture.install();
  await fixture.mediaDevices.getUserMedia({ video: true });
  await settle();
  assert.equal(rear.calls.length, 1);
});

test('Falls back to requested facingMode only when the track does not expose its facingMode', async () => {
  for (const facingMode of ['environment', { ideal: 'environment' }, { exact: 'environment' }]) {
    const rear = camera({ track: { getSettings: () => ({}) } });
    const fixture = page({ getUserMedia: () => Promise.resolve(rear.stream) });
    fixture.install();
    await fixture.mediaDevices.getUserMedia({ video: { facingMode } });
    await settle();
    assert.equal(rear.calls.length, 1, JSON.stringify(facingMode));
  }
});

test('Never applies rear-camera autofocus to a front camera, unidentified camera, or ended track', async () => {
  for (const settings of [
    { track: { getSettings: () => ({ facingMode: 'user' }) }, requested: 'environment' },
    { track: { getSettings: () => ({ facingMode: 'left' }) }, requested: 'environment' },
    { track: { getSettings: () => ({}) }, requested: 'user' },
    { track: { getSettings: () => ({}) }, requested: undefined },
    { track: { readyState: 'ended' }, requested: 'environment' },
  ]) {
    const rear = camera({ track: settings.track });
    const fixture = page({ getUserMedia: () => Promise.resolve(rear.stream) });
    fixture.install();
    assert.strictEqual(await fixture.mediaDevices.getUserMedia({ video: { facingMode: settings.requested } }), rear.stream);
    fixture.click(new Video(rear.stream));
    await settle();
    assert.equal(rear.calls.length, 0, JSON.stringify(settings));
  }
});

test('Unsupported continuous focus and missing capability APIs leave scanning available', async () => {
  for (const track of [
    { getCapabilities: undefined },
    { applyConstraints: undefined },
    { getCapabilities: () => ({}) },
    { getCapabilities: () => ({ focusMode: ['manual', 'single-shot'] }) },
  ]) {
    const rear = camera({ track });
    const fixture = page({ getUserMedia: () => Promise.resolve(rear.stream) });
    fixture.install();
    assert.strictEqual(await fixture.mediaDevices.getUserMedia({ video: true }), rear.stream);
    fixture.click(new Video(rear.stream));
    await settle();
    assert.equal(rear.calls.length, 0);
  }
});

test('Capability and constraint errors never replace or reject a successfully acquired stream', async () => {
  for (const track of [
    { getCapabilities: () => { throw new Error('Capabilities unavailable'); } },
    { getSettings: () => { throw new Error('Settings unavailable'); } },
    { getConstraints: () => { throw new Error('Constraints unavailable'); } },
    { applyConstraints: () => { throw new Error('Synchronous constraint failure'); } },
    { applyConstraints: () => Promise.reject(new Error('OverconstrainedError')) },
  ]) {
    const rear = camera({ track });
    const fixture = page({ getUserMedia: () => Promise.resolve(rear.stream) });
    fixture.install();
    assert.strictEqual(await fixture.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }), rear.stream);
    fixture.click(new Video(rear.stream));
    await settle();
  }
});

test('Tapping an acquired rear-camera video retries focus without reopening the camera', async () => {
  const originalConstraints = {
    width: { ideal: 1280 }, height: { ideal: 720 },
    advanced: [{ zoom: 1.5 }, { torch: true, focusMode: 'continuous' }],
  };
  const originalSnapshot = structuredClone(originalConstraints);
  let currentConstraints = originalConstraints;
  const rear = camera({
    constraints: originalConstraints,
    track: { getConstraints: () => currentConstraints },
    applyConstraints(value) {
      // Browsers report the latest applied constraints on the next tap.
      currentConstraints = value;
      return Promise.resolve();
    },
  });
  let acquisitions = 0;
  const fixture = page({ getUserMedia: () => {
    acquisitions++;
    return Promise.resolve(rear.stream);
  } });
  fixture.install();
  await fixture.mediaDevices.getUserMedia({ video: true });
  await settle();
  const beforeTap = rear.calls.length;
  assert.equal(beforeTap, 1);
  const expectedConstraints = {
    ...originalSnapshot,
    advanced: [...originalSnapshot.advanced, { focusMode: 'continuous' }],
  };
  for (let tap = 1; tap <= 3; tap++) {
    const previousConstraints = currentConstraints;
    const previousSnapshot = plain(previousConstraints);
    fixture.click(new Video(rear.stream));
    await settle();
    assert.equal(rear.calls.length, beforeTap + tap);
    assert.deepEqual(plain(currentConstraints), expectedConstraints, 'Repeated taps must not accumulate focus constraints');
    assert.deepEqual(plain(previousConstraints), previousSnapshot, 'A tap must not mutate the last reported constraints');
    assert.deepEqual(originalConstraints, originalSnapshot, 'Original resolution and advanced constraints remain unchanged');
  }
  assert.equal(acquisitions, 1);
  assert.equal(fixture.forbiddenCalls(), 0);
});

test('A click never changes unrelated videos, unacquired streams, non-video targets or ended tracks', async () => {
  const acquired = camera();
  const unrelated = camera();
  const fixture = page({ getUserMedia: () => Promise.resolve(acquired.stream) });
  fixture.install();
  await fixture.mediaDevices.getUserMedia({ video: true });
  await settle();
  const beforeClicks = acquired.calls.length;
  fixture.click(new Video(unrelated.stream));
  fixture.click(new Video(null));
  fixture.click({ tagName: 'BUTTON', srcObject: acquired.stream });
  acquired.track.readyState = 'ended';
  fixture.click(new Video(acquired.stream));
  await settle();
  assert.equal(acquired.calls.length, beforeClicks);
  assert.equal(unrelated.calls.length, 0);
  assert.equal(fixture.forbiddenCalls(), 0);
});

test('An audio-only stream is returned unchanged and never receives camera constraints', async () => {
  let applied = 0;
  const stream = new Stream([{ kind: 'audio', readyState: 'live', applyConstraints: () => { applied++; } }]);
  const fixture = page({ getUserMedia: () => Promise.resolve(stream) });
  fixture.install();
  assert.strictEqual(await fixture.mediaDevices.getUserMedia({ audio: true }), stream);
  fixture.click(new Video(stream));
  await settle();
  assert.equal(applied, 0);
});
