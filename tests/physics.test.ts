import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  freshBall,
  step,
  metrics,
  PRESETS,
  height,
  poseInput,
} from '../lib/physics.ts';
void test('stationary ball stays stationary on a flat track', () => {
  let b = freshBall();
  for (let i = 0; i < 1200; i++) b = step(b, [50, 50, 50, 50], 1 / 120, 0);
  assert.equal(b.v, 0);
  assert.equal(b.x, 32);
});
void test('downhill reaches goal without artificial launch velocity', () => {
  let b = freshBall();
  for (let i = 0; i < 6000 && !b.won; i++)
    b = step(b, PRESETS.slope, 1 / 120, 0);
  assert.ok(b.won);
  assert.ok(b.time < 20);
});
void test('fixed frictionless terrain approximately conserves mechanical energy', () => {
  let b = freshBall();
  const m = metrics(b, PRESETS.slope),
    initial = m.kinetic + m.potential;
  let maxError = 0;
  for (let i = 0; i < 3000 && !b.won; i++) {
    b = step(b, PRESETS.slope, 1 / 120, 0);
    const n = metrics(b, PRESETS.slope);
    maxError = Math.max(
      maxError,
      Math.abs(n.potential + n.kinetic - initial) / initial,
    );
  }
  assert.ok(maxError < 0.025, `relative drift ${maxError}`);
});
void test('friction dissipates energy with fixed terrain', () => {
  let b = freshBall();
  const first = metrics(b, PRESETS.slope);
  for (let i = 0; i < 200; i++) b = step(b, PRESETS.slope, 1 / 120, 0.35);
  const last = metrics(b, PRESETS.slope);
  assert.ok(last.kinetic + last.potential < first.kinetic + first.potential);
});
void test('completed runs freeze and all preset trajectories remain bounded', () => {
  for (const levels of Object.values(PRESETS)) {
    let b = freshBall();
    for (let i = 0; i < 5000; i++) {
      b = step(b, levels, 1 / 120, 0.2);
      assert.ok(Number.isFinite(b.v) && Number.isFinite(b.x));
      assert.ok(b.x >= 3 && b.x <= 990);
    }
    if (b.won) assert.deepEqual(step(b, levels, 0.01, 0), b);
  }
  assert.equal(height(900, [0, 50, 50, 100]), height(1000, [0, 50, 50, 100]));
});
void test('unreliable pose does not change controls, mirrored position is bounded', () => {
  assert.equal(poseInput([]), null);
  const p = Array.from({ length: 33 }, () => ({
    x: 0.2,
    y: 0.4,
    visibility: 0.99,
  }));
  const input = poseInput(p);
  assert.ok(input);
  assert.equal(input.x, 0.8);
  assert.ok(input.level >= 5 && input.level <= 95);
  p[11].visibility = 0.1;
  assert.equal(poseInput(p), null);
});
