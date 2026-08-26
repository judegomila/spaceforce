import { seededRng, v } from './physics.js';

const stone = (x, y, angle, extras = {}) => ({ pos: v(x, y), angle, ...extras });

export const PRESETS = {
  empty: {
    name: 'EMPTY BOARD',
    description: 'Start a full turn-based game from an empty cord.',
    mode: 'game',
    cord: { rx: 4.2, ry: 3.05, pinch: 0.08, wobble: 0.035, skew: 0, rotation: 0 },
    stones: [],
    hand: { pos: v(-5.0, -3.7), angle: 0.2, posture: 'flat' },
  },
  saddle: {
    name: 'SIDE-BY-SIDE SADDLE',
    description: 'Parallel side-by-side dipoles repel radially but are rotationally unstable.',
    mode: 'lab',
    cord: { rx: 4.1, ry: 3.0, pinch: 0.04 },
    stones: [
      stone(-0.72, 0, Math.PI / 2),
      stone(0.72, 0, Math.PI / 2),
    ],
    hand: { pos: v(-4.8, -3.4), angle: 0, posture: 'flat' },
  },
  rotation: {
    name: 'ROTATION BEFORE SLIDE',
    description: 'Torque saturation rotates a pinned stone into a stronger attractive channel.',
    mode: 'lab',
    params: { muStatic: 0.48, torsionalRadius: 0.12 },
    stones: [
      stone(-0.58, 0.1, 0),
      stone(0.72, 0.1, 1.18),
    ],
    hand: { pos: v(2.35, -2.2), angle: Math.PI, posture: 'flat' },
  },
  triangle: {
    name: 'FRUSTRATED TRIANGLE',
    description: 'A closed non-collinear interaction graph with incompatible preferred alignments.',
    mode: 'lab',
    stones: [
      stone(-0.82, -0.55, 0.25),
      stone(0.82, -0.55, Math.PI - 0.25),
      stone(0, 0.90, -Math.PI / 2),
    ],
    hand: { pos: v(-4.7, -3.5), angle: 0.2, posture: 'flat' },
  },
  cascade: {
    name: 'HYBRID CASCADE',
    description: 'A hand dipole loads a three-stone chain; first capture changes the field and triggers a second.',
    mode: 'lab',
    params: { magneticStrength: 0.082, muStatic: 0.38 },
    cord: { rx: 4.7, ry: 2.65, pinch: 0.02 },
    stones: [
      stone(-1.05, 0, 0),
      stone(0, 0, 0),
      stone(1.18, 0, 0),
    ],
    hand: { pos: v(-4.25, 0), angle: Math.PI, posture: 'flat' },
    autoApproach: { target: v(-1.78, 0), speed: 0.38 },
  },
  tripwire: {
    name: 'UPRIGHT TRIPWIRE',
    description: 'An edge-supported stone has a low tipping margin and can amplify a weak approach.',
    mode: 'lab',
    params: { magneticStrength: 0.068, muStatic: 0.44 },
    stones: [
      stone(-0.35, 0.15, 0.1, { posture: 'edge', tilt: 1 }),
      stone(0.95, 0.38, -0.4),
      stone(0.70, -0.80, 1.0),
    ],
    hand: { pos: v(-3.5, -1.6), angle: 0.5, posture: 'flat' },
  },
  trap: {
    name: 'NEAR-CRITICAL TRAP',
    description: 'A baseline-stable board with high susceptibility to the next hand trajectory.',
    mode: 'lab',
    params: { magneticStrength: 0.070, muStatic: 0.43 },
    stones: [
      stone(-1.20, 0.05, 0.05),
      stone(-0.10, 0.12, 0.07),
      stone(1.15, 0.18, Math.PI - 0.06),
      stone(0.25, 1.12, -1.35),
      stone(0.15, -1.16, 1.40),
    ],
    hand: { pos: v(-4.5, -3.25), angle: 0.25, posture: 'flat' },
  },
};

export function generatedMidgame(seed = 20260824, count = 12) {
  const rng = seededRng(seed);
  const stones = [];
  let attempts = 0;
  while (stones.length < count && attempts++ < 5000) {
    const x = (rng() * 2 - 1) * 3.2;
    const y = (rng() * 2 - 1) * 2.25;
    if ((x / 3.8) ** 2 + (y / 2.7) ** 2 > 0.82) continue;
    if (stones.some((s) => Math.hypot(s.pos.x - x, s.pos.y - y) < 0.72)) continue;
    stones.push(stone(x, y, rng() * Math.PI * 2, { player: stones.length % 3, posture: rng() < 0.13 ? 'edge' : 'flat' }));
  }
  return {
    name: 'SEEDED MIDGAME',
    description: `Deterministic ${count}-stone board for path planning and strategy tests.`,
    mode: 'lab',
    stones,
    hand: { pos: v(-4.75, -3.4), angle: 0.3, posture: 'flat' },
  };
}

export function getPreset(name) {
  if (name === 'midgame') return generatedMidgame();
  return PRESETS[name] ?? PRESETS.empty;
}
