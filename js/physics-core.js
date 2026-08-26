/**
 * Reduced planar hybrid dynamics for Kluster Lab.
 *
 * The simulator is dimensionless. Each stone is a planar rigid body with a
 * body-fixed dipole moment, Coulomb-like force/torque thresholds, optional
 * edge posture, compliant contact, magnetic capture joints, and a movable
 * polygonal cord. The point-dipole model is softened and capped near contact;
 * it is an explanatory model, not a calibrated commercial-set prediction.
 */

export const TAU = Math.PI * 2;
export const EPS = 1e-9;

export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a || 1), 0, 1);
  return t * t * (3 - 2 * t);
};
export const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export function v(x = 0, y = 0) { return { x, y }; }
export function add(a, b) { return { x: a.x + b.x, y: a.y + b.y }; }
export function sub(a, b) { return { x: a.x - b.x, y: a.y - b.y }; }
export function mul(a, s) { return { x: a.x * s, y: a.y * s }; }
export function dot(a, b) { return a.x * b.x + a.y * b.y; }
export function cross(a, b) { return a.x * b.y - a.y * b.x; }
export function len2(a) { return dot(a, a); }
export function len(a) { return Math.hypot(a.x, a.y); }
export function unit(a) {
  const n = len(a);
  return n > EPS ? { x: a.x / n, y: a.y / n } : { x: 1, y: 0 };
}
export function perp(a) { return { x: -a.y, y: a.x }; }
export function rotate(a, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  return { x: c * a.x - s * a.y, y: s * a.x + c * a.y };
}
export function distance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
export function momentVector(angle, magnitude = 1) {
  return { x: magnitude * Math.cos(angle), y: magnitude * Math.sin(angle) };
}

export function seededRng(seed = 1) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** Standard point-dipole field in the board plane, with mu0/(4 pi) absorbed. */
export function dipoleField(sourcePos, sourceMoment, targetPos, opts = {}) {
  const softening = opts.softening ?? 0;
  const fieldScale = opts.fieldScale ?? 1;
  const rvec = sub(targetPos, sourcePos);
  const rawR2 = len2(rvec);
  const r2 = rawR2 + softening * softening;
  const r = Math.sqrt(r2);
  if (r < EPS) return v();
  const rhat = mul(rvec, 1 / Math.sqrt(Math.max(rawR2, EPS)));
  const a = dot(sourceMoment, rhat);
  const factor = fieldScale / (r2 * r);
  return mul(sub(mul(rhat, 3 * a), sourceMoment), factor);
}

/**
 * Force on target dipole due to source dipole.
 * F = 3 C/r^4 [(m1.r)m2 + (m2.r)m1 + (m1.m2)r - 5(m1.r)(m2.r)r].
 */
export function dipoleForce(sourcePos, sourceMoment, targetPos, targetMoment, opts = {}) {
  const softening = opts.softening ?? 0;
  const forceScale = opts.forceScale ?? 1;
  const maxForce = opts.maxForce ?? Infinity;
  const rvec = sub(targetPos, sourcePos);
  const rawR = Math.max(len(rvec), EPS);
  const rhat = mul(rvec, 1 / rawR);
  const r2 = rawR * rawR + softening * softening;
  const r4 = r2 * r2;
  const a = dot(sourceMoment, rhat);
  const b = dot(targetMoment, rhat);
  const d = dot(sourceMoment, targetMoment);
  let out = add(add(mul(targetMoment, a), mul(sourceMoment, b)), mul(rhat, d - 5 * a * b));
  out = mul(out, 3 * forceScale / r4);
  const n = len(out);
  if (n > maxForce) out = mul(out, maxForce / n);
  return out;
}

export function dipoleTorque(sourcePos, sourceMoment, targetPos, targetMoment, opts = {}) {
  const B = dipoleField(sourcePos, sourceMoment, targetPos, opts);
  const maxTorque = opts.maxTorque ?? Infinity;
  return clamp(cross(targetMoment, B), -maxTorque, maxTorque);
}

export function dipolePotential(posA, momentA, posB, momentB, opts = {}) {
  const softening = opts.softening ?? 0;
  const energyScale = opts.energyScale ?? opts.forceScale ?? 1;
  const rvec = sub(posB, posA);
  const rawR = Math.max(len(rvec), EPS);
  const rhat = mul(rvec, 1 / rawR);
  const r2 = rawR * rawR + softening * softening;
  const r3 = r2 * Math.sqrt(r2);
  return energyScale * (dot(momentA, momentB) - 3 * dot(momentA, rhat) * dot(momentB, rhat)) / r3;
}

export function generateCordPolygon(cord, count = 144) {
  const points = [];
  const rx = cord.rx ?? 4.2;
  const ry = cord.ry ?? 3.05;
  const pinch = cord.pinch ?? 0.08;
  const wobble = cord.wobble ?? 0.035;
  const skew = cord.skew ?? 0;
  const rotation = cord.rotation ?? 0;
  const center = cord.center ?? v();
  const c = Math.cos(rotation), s = Math.sin(rotation);

  for (let i = 0; i < count; i += 1) {
    const t = TAU * i / count;
    const harmonic = 1 + wobble * Math.cos(3 * t + 0.4) + 0.35 * wobble * Math.sin(5 * t);
    const waistX = 1 - pinch * Math.cos(2 * t);
    const waistY = 1 + 0.55 * pinch * Math.cos(2 * t);
    let x = rx * Math.cos(t) * harmonic * waistX;
    let y = ry * Math.sin(t) * harmonic * waistY;
    x += skew * (y / Math.max(ry, EPS));
    points.push({ x: center.x + c * x - s * y, y: center.y + s * x + c * y });
  }
  return points;
}

export function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    const crosses = ((a.y > point.y) !== (b.y > point.y)) &&
      (point.x < (b.x - a.x) * (point.y - a.y) / ((b.y - a.y) || EPS) + a.x);
    if (crosses) inside = !inside;
  }
  return inside;
}

export function nearestPointOnSegment(p, a, b) {
  const ab = sub(b, a);
  const t = clamp(dot(sub(p, a), ab) / Math.max(len2(ab), EPS), 0, 1);
  const point = add(a, mul(ab, t));
  return { point, t, distance: distance(p, point) };
}

export function nearestPointOnPolygon(p, polygon) {
  let best = { point: polygon[0], distance: Infinity, segment: 0 };
  for (let i = 0; i < polygon.length; i += 1) {
    const hit = nearestPointOnSegment(p, polygon[i], polygon[(i + 1) % polygon.length]);
    if (hit.distance < best.distance) best = { ...hit, segment: i };
  }
  return best;
}

/** Positive inside, negative outside. */
export function signedBoundaryMargin(p, polygon) {
  const nearest = nearestPointOnPolygon(p, polygon);
  return (pointInPolygon(p, polygon) ? 1 : -1) * nearest.distance;
}

export function defaultParams() {
  return {
    gravity: 1,
    magneticStrength: 0.072,
    momentScale: 1,
    softening: 0.14,
    maxPairForce: 22,
    maxPairTorque: 8,
    muStatic: 0.42,
    muKinetic: 0.30,
    torsionalRadius: 0.19,
    linearDamping: 0.42,
    angularDamping: 0.58,
    restitution: 0.08,
    contactStiffness: 180,
    contactDamping: 11,
    jointStiffness: 230,
    jointDamping: 13,
    captureEnergy: 0.28,
    captureAttraction: 1.1,
    captureSpeed: 2.2,
    cordSolid: true,
    cordStiffness: 90,
    cordDamping: 8,
    maxSpeed: 7.5,
    maxOmega: 14,
    sleepSpeed: 0.018,
    sleepOmega: 0.028,
    settleSpeed: 0.045,
    settleOmega: 0.08,
    edgeSupportHalf: 0.105,
    edgeHeight: 0.37,
    flatSupportHalf: 0.29,
    flatHeight: 0.11,
    tipImpulse: 0.11,
    fixedDt: 1 / 180,
  };
}

export function createStone(options = {}) {
  const id = options.id ?? `s${Math.random().toString(36).slice(2, 9)}`;
  const posture = options.posture ?? 'flat';
  return {
    id,
    player: options.player ?? 0,
    pos: { ...(options.pos ?? v()) },
    vel: { ...(options.vel ?? v()) },
    angle: options.angle ?? 0,
    omega: options.omega ?? 0,
    mass: options.mass ?? 1,
    inertia: options.inertia ?? 0.09,
    moment: options.moment ?? 1,
    collisionRadius: options.collisionRadius ?? 0.27,
    footprintRadius: options.footprintRadius ?? 0.42,
    length: options.length ?? 0.76,
    width: options.width ?? 0.31,
    posture,
    tilt: options.tilt ?? (posture === 'edge' ? 1 : 0),
    tiltVelocity: 0,
    pinned: true,
    sleeping: true,
    outside: false,
    removed: false,
    force: v(),
    torque: 0,
    utilization: 0,
    forceUtilization: 0,
    torqueUtilization: 0,
    tipUtilization: 0,
    boundaryMargin: Infinity,
    minGap: Infinity,
    energy: 0,
    lastMovedAt: 0,
    metadata: { ...(options.metadata ?? {}) },
  };
}

export function pairKey(a, b) { return a < b ? `${a}|${b}` : `${b}|${a}`; }
