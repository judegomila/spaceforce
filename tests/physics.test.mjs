import test from 'node:test';
import assert from 'node:assert/strict';
import {
  KlusterWorld, dipoleField, dipoleForce, dipolePotential, dipoleTorque,
  generateCordPolygon, momentVector, pointInPolygon, signedBoundaryMargin, v
} from '../js/physics.js';

const close = (actual, expected, tolerance = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected} ± ${tolerance}`);
};

test('head-to-tail dipoles have the expected energy, field, and attractive force', () => {
  const a = v(0, 0), b = v(2, 0);
  const m = v(1, 0);
  const B = dipoleField(a, m, b, { fieldScale: 1 });
  close(B.x, 2 / 8);
  close(B.y, 0);
  const U = dipolePotential(a, m, b, m, { energyScale: 1 });
  close(U, -2 / 8);
  const F = dipoleForce(a, m, b, m, { forceScale: 1 });
  close(F.x, -6 / 16);
  close(F.y, 0);
});

test('side-by-side parallel dipoles repel and possess a restoring-breaking torque under perturbation', () => {
  const a = v(0, 0), b = v(0, 2);
  const ma = v(1, 0);
  const mb = momentVector(0.08);
  const F = dipoleForce(a, ma, b, mb, { forceScale: 1 });
  assert.ok(F.y > 0, 'parallel side-by-side pair should repel radially');
  const tau = dipoleTorque(a, ma, b, mb, { fieldScale: 1 });
  assert.notEqual(Math.sign(tau), 0, 'angular perturbation should produce nonzero torque');
});

test('cord polygon has positive inside margin and negative outside margin', () => {
  const polygon = generateCordPolygon({ rx: 4, ry: 3, pinch: 0.08, wobble: 0.03, skew: 0, rotation: 0, center: v() });
  assert.equal(pointInPolygon(v(0, 0), polygon), true);
  assert.ok(signedBoundaryMargin(v(0, 0), polygon) > 2.5);
  assert.equal(pointInPolygon(v(6, 0), polygon), false);
  assert.ok(signedBoundaryMargin(v(6, 0), polygon) < 0);
});

test('friction utilization crosses one at the reduced static wrench boundary', () => {
  const world = new KlusterWorld({ params: { muStatic: 0.5, gravity: 1, torsionalRadius: 0.2 } });
  const stone = world.addStone({ id: 's1', mass: 1 });
  const atBoundary = world.utilizationFor(stone, v(0.5, 0), 0);
  close(atBoundary.combined, 1, 1e-12);
  const coupled = world.utilizationFor(stone, v(0.3, 0), 0.08);
  close(coupled.combined, 1, 1e-12);
});

test('sufficiently attractive overlapping contact creates a capture joint', () => {
  const world = new KlusterWorld({
    params: {
      magneticStrength: 0.12,
      softening: 0.05,
      captureEnergy: 0.05,
      captureAttraction: 0.2,
      captureSpeed: 4,
      muStatic: 0.3,
    },
  });
  world.addStone({ id: 'a', pos: v(-0.25, 0), angle: 0 });
  world.addStone({ id: 'b', pos: v(0.25, 0), angle: 0 });
  const events = world.step(1 / 180, null);
  assert.ok(events.some((event) => event.type === 'capture'));
  assert.equal(world.joints.size, 1);
  assert.deepEqual(new Set(world.clusterMembers('a')), new Set(['a', 'b']));
});

test('world serialization and reload preserve physical state and capture graph', () => {
  const world = new KlusterWorld();
  world.addStone({ id: 'a', pos: v(-0.2, 0), angle: 0.1, player: 1 });
  world.addStone({ id: 'b', pos: v(0.4, 0), angle: 2.2, posture: 'edge', tilt: 1 });
  world.addJoint('a', 'b');
  const snapshot = world.serialize();
  const restored = new KlusterWorld();
  restored.load(snapshot);
  assert.equal(restored.activeStones().length, 2);
  assert.equal(restored.joints.size, 1);
  close(restored.getStone('a').angle, 0.1);
  assert.equal(restored.getStone('b').posture, 'edge');
});
