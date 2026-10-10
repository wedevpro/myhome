import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';

const source = fs.readFileSync(new URL('../lib/menu-gesture.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { TouchMenuGesture } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
const touch = (overrides = {}) => ({ pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: 100, clientY: 200, ...overrides });

test('Touch menu opens only after release and a click, once per tap', () => {
  const gesture = new TouchMenuGesture();
  assert.equal(gesture.start(touch()), true);
  assert.equal(gesture.consumeClick(1, 'touch'), false);
  assert.equal(gesture.start(touch()), true);
  assert.equal(gesture.end(touch()), true);
  assert.equal(gesture.consumeClick(1, 'touch'), true);
  assert.equal(gesture.consumeClick(1, 'touch'), false);
});

test('Touch tolerance includes eight pixels and rejects diagonal scroll beyond it', () => {
  const gesture = new TouchMenuGesture();
  gesture.start(touch());
  gesture.move(touch({ clientX: 108 }));
  gesture.end(touch({ clientX: 108 }));
  assert.equal(gesture.consumeClick(1, 'touch'), true);
  gesture.start(touch());
  gesture.move(touch({ clientX: 106, clientY: 206 }));
  gesture.end(touch({ clientX: 100, clientY: 200 }));
  assert.equal(gesture.consumeClick(1, 'touch'), false, 'returning to the start cannot turn a scroll into a tap');
});

test('Final release position is checked even without intermediate movement events', () => {
  const gesture = new TouchMenuGesture();
  gesture.start(touch());
  gesture.end(touch({ clientY: 209 }));
  assert.equal(gesture.consumeClick(1, 'touch'), false);
});

test('Pointer cancellation rejects compatibility clicks and allows the next real tap', () => {
  const gesture = new TouchMenuGesture();
  gesture.start(touch());
  gesture.cancel();
  assert.equal(gesture.end(touch()), false);
  assert.equal(gesture.consumeClick(1), false);
  gesture.start(touch());
  gesture.end(touch());
  assert.equal(gesture.consumeClick(1), true);
});

test('A second touch cancels the original tap and nonprimary touches cannot activate', () => {
  const gesture = new TouchMenuGesture();
  gesture.start(touch());
  assert.equal(gesture.start(touch({ pointerId: 2, isPrimary: false })), false);
  assert.equal(gesture.end(touch()), false);
  assert.equal(gesture.end(touch({ pointerId: 2 })), false);
  assert.equal(gesture.consumeClick(1, 'touch'), false);
  assert.equal(gesture.start(touch({ isPrimary: false })), false);
  assert.equal(gesture.consumeClick(1, 'touch'), false);
});

test('Unrelated pointer movement and release cannot complete the active touch', () => {
  const gesture = new TouchMenuGesture();
  gesture.start(touch());
  gesture.move(touch({ pointerId: 2, clientY: 500 }));
  assert.equal(gesture.end(touch({ pointerId: 2 })), false);
  assert.equal(gesture.end(touch()), true);
  assert.equal(gesture.consumeClick(1, 'touch'), true);
});

test('Mouse and pen clicks do not toggle twice; pointerless keyboard clicks still work', () => {
  const gesture = new TouchMenuGesture();
  for (const pointerType of ['mouse', 'pen']) {
    assert.equal(gesture.start(touch({ pointerType })), false);
    assert.equal(gesture.consumeClick(1, pointerType), false);
  }
  gesture.start(touch());
  gesture.cancel();
  assert.equal(gesture.consumeClick(0), true);
  assert.equal(gesture.consumeClick(0, 'touch'), false, 'a touch click with detail zero still needs a valid tap');
});

test('Repeated taps each activate once and reset does not retain an old release', () => {
  const gesture = new TouchMenuGesture();
  for (let pointerId = 1; pointerId <= 4; pointerId++) {
    assert.equal(gesture.start(touch({ pointerId })), true);
    assert.equal(gesture.end(touch({ pointerId })), true);
    assert.equal(gesture.consumeClick(1, 'touch'), true);
    assert.equal(gesture.consumeClick(1, 'touch'), false);
  }
  gesture.start(touch());
  gesture.end(touch());
  gesture.reset();
  assert.equal(gesture.consumeClick(1, 'touch'), false);
});
