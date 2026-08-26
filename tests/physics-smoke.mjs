import assert from 'node:assert/strict';
import { P, Sim, pHit } from '../js/physics.js';

function advance(sim, seconds, dt = 1 / 240, hook = null) {
  let maxOmegaX = 0;
  let maxZRel = 0;
  let maxPhi = 0;
  const n = Math.ceil(seconds / dt);
  for (let i = 0; i < n; i++) {
    sim.step(dt);
    maxOmegaX = Math.max(maxOmegaX, Math.abs(sim.omegaX));
    maxZRel = Math.max(maxZRel, Math.abs(sim.zRel));
    maxPhi = Math.max(maxPhi, Math.abs(sim.phiMinus), Math.abs(sim.phiPlus));
    hook?.(sim, i * dt);
    for (const key of ['x', 'v', 'alpha', 'eta', 'delta', 'phiMinus', 'phiPlus', 'omegaX', 'zRel']) {
      assert.ok(Number.isFinite(sim[key]), `${key} became non-finite`);
    }
  }
  return { maxOmegaX, maxZRel, maxPhi };
}

// Timing-risk formula must fall with speed.
assert.ok(pHit(0.10, 0.027) > pHit(0.30, 0.027));
assert.ok(pHit(0.30, 0.027) > pHit(0.55, 0.027));

// Common twist should remain within ±5° and generate axial ball spin.
{
  const sim = new Sim();
  sim.setManualTwist(1, 1);
  const a = advance(sim, 0.045);
  sim.setManualTwist(0, 0);
  advance(sim, 0.08);
  assert.ok(a.maxOmegaX > 0.05, 'common twist did not generate axial spin');
  assert.ok(a.maxPhi <= P.phiMax + 1e-10, 'rod angle exceeded nominal bound');
}

// Differential twist should create a cross-sectional response or residual.
{
  const sim = new Sim();
  sim.setManualTwist(1, -1);
  const a = advance(sim, 0.07);
  sim.setManualTwist(0, 0);
  assert.ok(a.maxZRel > 1e-6 || Math.abs(sim.sDelta) > 1e-6,
    'differential twist produced no cross-sectional response');
  assert.ok(a.maxPhi <= P.phiMax + 1e-10);
}

// A compound pulse must be finite, bounded and return close to baseline.
{
  const sim = new Sim();
  sim.triggerCompoundPulse(0.10 * Math.PI / 180, 0.10, 3.0 * Math.PI / 180, 'phased');
  const a = advance(sim, 0.75);
  assert.ok(a.maxPhi > 0.25 * Math.PI / 180, 'compound pulse did not move rods');
  assert.ok(a.maxPhi <= P.phiMax + 1e-10, 'compound pulse exceeded angle limit');
  assert.ok(sim.pulse === null || sim.mode !== 'ROLL', 'compound pulse failed to terminate');
}

// Long run smoke test under boundary-riding control and intermittent pulses.
{
  const sim = new Sim();
  sim.autopilot = true;
  sim.etaRef = 0.84;
  let fired = false;
  advance(sim, 4.0, 1 / 240, (s, t) => {
    if (!fired && t > 0.65 && s.mode === 'ROLL') {
      s.triggerCompoundPulse(0.18 * Math.PI / 180, 0.14, 2.2 * Math.PI / 180, 'common');
      fired = true;
    }
  });
  assert.ok(['ROLL', 'FLIGHT', 'BOARD', 'SINK', 'DONE'].includes(sim.mode));
}

console.log('physics smoke tests passed');
