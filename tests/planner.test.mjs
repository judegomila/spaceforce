import test from 'node:test';
import assert from 'node:assert/strict';
import { KlusterWorld, v } from '../js/physics.js';
import { chooseCandidate, computeRiskGrid, findRiskAwarePath, gridPoint } from '../js/pathfinding.js';

test('empty-board risk map admits a low-risk central placement', () => {
  const world = new KlusterWorld();
  const hand = { active: true, pos: v(-3.5, -2.2), angle: 0, posture: 'flat', moment: 1, collisionRadius: 0.27, footprintRadius: 0.42 };
  const grid = computeRiskGrid(world, hand, { cols: 31, rows: 23 });
  const candidate = chooseCandidate(grid, 'safe');
  assert.ok(candidate >= 0);
  const goal = gridPoint(grid, candidate);
  assert.ok(Math.abs(goal.x) < world.cord.rx);
  assert.ok(Math.abs(goal.y) < world.cord.ry);
  assert.ok(grid.values[candidate] < 0.1);
});

test('A* planner avoids a high-risk wall through its available gap', () => {
  const cols = 15, rows = 11;
  const values = new Float32Array(cols * rows);
  const clearance = new Float32Array(cols * rows).fill(1);
  const valid = new Uint8Array(cols * rows).fill(1);
  for (let row = 0; row < rows; row += 1) {
    if (row === 7) continue;
    values[row * cols + 7] = 2;
  }
  const grid = { cols, rows, minX: 0, maxX: 14, minY: 0, maxY: 10, dx: 1, dy: 1, values, clearance, valid };
  const path = findRiskAwarePath(grid, v(1, 2), v(13, 2), { maxRisk: 1.1, riskWeight: 8 });
  assert.ok(path.length >= 3, 'path should bend around the wall');
  assert.ok(path.some((point) => point.y >= 6.5), 'path should pass through the wall gap');
});

test('planner returns no route when the valid state space is disconnected', () => {
  const cols = 9, rows = 7;
  const values = new Float32Array(cols * rows);
  const clearance = new Float32Array(cols * rows).fill(1);
  const valid = new Uint8Array(cols * rows).fill(1);
  for (let row = 0; row < rows; row += 1) values[row * cols + 4] = 3;
  const grid = { cols, rows, minX: 0, maxX: 8, minY: 0, maxY: 6, dx: 1, dy: 1, values, clearance, valid };
  const path = findRiskAwarePath(grid, v(1, 3), v(7, 3), { maxRisk: 1.1 });
  assert.deepEqual(path, []);
});
