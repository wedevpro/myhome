import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../lib/kitchen-rotation.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { createRotationTimer, getSwipeDirection } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));

function fakeClock() {
  let now = 0;
  let nextId = 0;
  let lastCallback;
  const pending = new Map();
  return {
    setTimeout(callback, delayMs) {
      const id = ++nextId;
      lastCallback = callback;
      pending.set(id, { at: now + delayMs, callback });
      return id;
    },
    clearTimeout(id) { pending.delete(id); },
    advance(milliseconds) {
      const target = now + milliseconds;
      let executions = 0;
      while (true) {
        const next = [...pending.entries()].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!next || next[1].at > target) break;
        assert.ok(++executions < 1000, 'The timer must not create a zero-delay loop.');
        now = next[1].at;
        pending.delete(next[0]);
        next[1].callback();
      }
      now = target;
    },
    get pendingCount() { return pending.size; },
    get nextDelay() { return pending.size ? Math.min(...[...pending.values()].map(timer => timer.at - now)) : undefined; },
    get lastCallback() { return lastCallback; },
  };
}

test('Cuisine : un swipe manuel redonne le délai complet avant la prochaine rotation', () => {
  const clock = fakeClock();
  let rotations = 0;
  const timer = createRotationTimer({ delayMs: 1000, onRotate: () => rotations++, isPaused: () => false, clock });
  clock.advance(900);
  timer.reset();
  clock.advance(999);
  assert.equal(rotations, 0);
  clock.advance(1);
  assert.equal(rotations, 1);
  clock.advance(1000);
  assert.equal(rotations, 2);
  assert.equal(clock.pendingCount, 1);
  timer.dispose();
});

test('Cuisine : une action proche de l’échéance et sa fin prolongent la lecture', () => {
  const clock = fakeClock();
  let busy = false, rotations = 0;
  const timer = createRotationTimer({ delayMs: 1000, onRotate: () => rotations++, isPaused: () => busy, clock });
  clock.advance(950);
  busy = true;
  timer.reset();
  clock.advance(1500);
  assert.equal(rotations, 0);
  busy = false;
  timer.reset();
  clock.advance(999);
  assert.equal(rotations, 0);
  clock.advance(1);
  assert.equal(rotations, 1);
  timer.dispose();
});

test('Cuisine : une pause à échéance est surveillée puis suivie d’un délai complet', () => {
  const clock = fakeClock();
  let paused = false, rotations = 0;
  const timer = createRotationTimer({ delayMs: 1000, onRotate: () => rotations++, isPaused: () => paused, clock });
  clock.advance(900);
  paused = true;
  clock.advance(100);
  assert.equal(rotations, 0);
  assert.ok(clock.nextDelay > 0 && clock.nextDelay <= 250);
  clock.advance(750);
  assert.equal(rotations, 0);
  paused = false;
  clock.advance(250);
  assert.equal(rotations, 0, 'The first resumed poll must not rotate immediately.');
  assert.equal(clock.nextDelay, 1000);
  clock.advance(999);
  assert.equal(rotations, 0);
  clock.advance(1);
  assert.equal(rotations, 1);
  timer.dispose();
});

test('Cuisine : reset pendant la pause annule aussi le polling précédent', () => {
  const clock = fakeClock();
  let paused = true, rotations = 0;
  const timer = createRotationTimer({ delayMs: 1000, onRotate: () => rotations++, isPaused: () => paused, clock });
  clock.advance(1100);
  paused = false;
  timer.reset();
  assert.equal(clock.pendingCount, 1);
  clock.advance(999);
  assert.equal(rotations, 0);
  clock.advance(1);
  assert.equal(rotations, 1);
  timer.dispose();
});

test('Cuisine : resets répétés, ancien callback et dispose restent sans doublon', () => {
  const clock = fakeClock();
  let rotations = 0;
  const timer = createRotationTimer({ delayMs: 1000, onRotate: () => rotations++, isPaused: () => false, clock });
  const cancelledCallback = clock.lastCallback;
  for (let i = 0; i < 20; i++) {
    clock.advance(10);
    timer.reset();
    assert.equal(clock.pendingCount, 1);
  }
  cancelledCallback();
  assert.equal(rotations, 0);
  assert.equal(clock.pendingCount, 1);
  timer.dispose();
  timer.dispose();
  timer.reset();
  clock.advance(5000);
  assert.equal(rotations, 0);
  assert.equal(clock.pendingCount, 0);
});

test('Cuisine : reset depuis onRotate ne programme qu’une seule échéance', () => {
  const clock = fakeClock();
  let rotations = 0, timer;
  timer = createRotationTimer({ delayMs: 1000, onRotate: () => { rotations++; timer.reset(); }, isPaused: () => false, clock });
  clock.advance(3000);
  assert.equal(rotations, 3);
  assert.equal(clock.pendingCount, 1);
  clock.advance(999);
  assert.equal(rotations, 3);
  clock.advance(1);
  assert.equal(rotations, 4);
  timer.dispose();
});

test('Cuisine : pause ouverte par onRotate conserve un seul timer et reprend après lecture', () => {
  const clock = fakeClock();
  let paused = false, rotations = 0;
  const timer = createRotationTimer({ delayMs: 1000, onRotate: () => { rotations++; paused = true; }, isPaused: () => paused, clock });
  clock.advance(2500);
  assert.equal(rotations, 1);
  assert.equal(clock.pendingCount, 1);
  paused = false;
  clock.advance(250);
  assert.equal(rotations, 1);
  clock.advance(1000);
  assert.equal(rotations, 2);
  assert.equal(clock.pendingCount, 1);
  timer.dispose();
});

test('Cuisine : dispose depuis onRotate annule toute rotation suivante', () => {
  const clock = fakeClock();
  let rotations = 0, timer;
  timer = createRotationTimer({ delayMs: 1000, onRotate: () => { rotations++; timer.dispose(); }, isPaused: () => false, clock });
  clock.advance(5000);
  assert.equal(rotations, 1);
  assert.equal(clock.pendingCount, 0);
});

test('Cuisine : seuls les swipes horizontaux suffisamment longs et rapides changent la liste', () => {
  assert.equal(getSwipeDirection({ dx: -50, dy: 0, durationMs: 1200 }), 1);
  assert.equal(getSwipeDirection({ dx: 50, dy: 0, durationMs: 1200 }), -1);
  assert.equal(getSwipeDirection({ dx: -100, dy: -50, durationMs: 400 }), 1);
  assert.equal(getSwipeDirection({ dx: 100, dy: 50, durationMs: 400 }), -1);
  for (const swipe of [
    { dx: 0, dy: 0, durationMs: 100 },
    { dx: 49, dy: 0, durationMs: 100 },
    { dx: 50, dy: 100, durationMs: 300 },
    { dx: 100, dy: 100, durationMs: 300 },
    { dx: 70, dy: 50, durationMs: 300 },
    { dx: -70, dy: -50, durationMs: 300 },
    { dx: -100, dy: 0, durationMs: 1201 },
    { dx: 100, dy: 0, durationMs: -1 },
    { dx: Infinity, dy: 0, durationMs: 100 },
    { dx: 100, dy: NaN, durationMs: 100 },
    { dx: 100, dy: 0, durationMs: NaN },
  ]) assert.equal(getSwipeDirection(swipe), 0, JSON.stringify(swipe));
});
