import {
  EPS, add, clamp, createStone, defaultParams, dipoleForce, dipolePotential,
  dipoleTorque, distance, dot, generateCordPolygon, len, len2, momentVector,
  mul, nearestPointOnPolygon, pairKey, pointInPolygon, signedBoundaryMargin,
  sub, unit, v, wrapAngle
} from './physics-core.js';

export class KlusterWorld {
  constructor(options = {}) {
    this.params = { ...defaultParams(), ...(options.params ?? {}) };
    this.cord = {
      rx: 4.2,
      ry: 3.05,
      pinch: 0.08,
      wobble: 0.035,
      skew: 0,
      rotation: 0,
      center: v(),
      ...(options.cord ?? {}),
    };
    this.cordPolygon = generateCordPolygon(this.cord);
    this.stones = [];
    this.joints = new Map();
    this.time = 0;
    this.eventCounter = 0;
    this.events = [];
    this.lastStepEvents = [];
    this.totalPotential = 0;
    this.totalKinetic = 0;
    this.maxUtilization = 0;
    this.minGap = Infinity;
    this.minBoundaryMargin = Infinity;
    this.handLoads = new Map();
    this.turnId = 0;
  }

  setCord(patch) {
    Object.assign(this.cord, patch);
    this.cordPolygon = generateCordPolygon(this.cord);
  }

  setParams(patch) { Object.assign(this.params, patch); }

  clear() {
    this.stones.length = 0;
    this.joints.clear();
    this.time = 0;
    this.events.length = 0;
    this.lastStepEvents.length = 0;
    this.totalPotential = 0;
    this.totalKinetic = 0;
    this.maxUtilization = 0;
    this.minGap = Infinity;
    this.minBoundaryMargin = Infinity;
    this.handLoads.clear();
  }

  addStone(options = {}) {
    const stone = createStone({ id: options.id ?? `s${++this.eventCounter}`, ...options });
    this.stones.push(stone);
    return stone;
  }

  getStone(id) { return this.stones.find((s) => s.id === id && !s.removed); }

  removeStones(ids) {
    const set = new Set(ids);
    for (const s of this.stones) if (set.has(s.id)) s.removed = true;
    for (const [key, joint] of this.joints) {
      if (set.has(joint.a) || set.has(joint.b)) this.joints.delete(key);
    }
    this.stones = this.stones.filter((s) => !s.removed);
  }

  emit(type, payload = {}) {
    const event = { id: ++this.eventCounter, time: this.time, turnId: this.turnId, type, ...payload };
    this.events.push(event);
    this.lastStepEvents.push(event);
    return event;
  }

  activeStones() { return this.stones.filter((s) => !s.removed); }

  isJoined(a, b) { return this.joints.has(pairKey(a, b)); }

  addJoint(a, b, options = {}) {
    const key = pairKey(a, b);
    if (this.joints.has(key)) return this.joints.get(key);
    const sa = this.getStone(a), sb = this.getStone(b);
    if (!sa || !sb) return null;
    const joint = {
      a, b,
      rest: options.rest ?? Math.max(0.33, sa.collisionRadius + sb.collisionRadius - 0.045),
      createdAt: this.time,
      turnId: this.turnId,
    };
    this.joints.set(key, joint);
    this.emit('capture', { a, b, jointKey: key });
    return joint;
  }

  clusterMembers(seedId) {
    const seen = new Set([seedId]);
    const stack = [seedId];
    while (stack.length) {
      const id = stack.pop();
      for (const joint of this.joints.values()) {
        const other = joint.a === id ? joint.b : joint.b === id ? joint.a : null;
        if (other && !seen.has(other)) { seen.add(other); stack.push(other); }
      }
    }
    return [...seen];
  }

  allClusters() {
    const seen = new Set();
    const clusters = [];
    for (const s of this.activeStones()) {
      if (seen.has(s.id)) continue;
      const members = this.clusterMembers(s.id);
      members.forEach((id) => seen.add(id));
      if (members.length > 1) clusters.push(members);
    }
    return clusters;
  }

  momentOf(stone) {
    const projection = 1 - 0.28 * Math.sin(Math.PI * clamp(stone.tilt, 0, 1));
    return momentVector(stone.angle, stone.moment * this.params.momentScale * projection);
  }

  magneticOpts() {
    return {
      softening: this.params.softening,
      forceScale: this.params.magneticStrength,
      fieldScale: this.params.magneticStrength,
      energyScale: this.params.magneticStrength,
      maxForce: this.params.maxPairForce,
      maxTorque: this.params.maxPairTorque,
    };
  }

  staticThresholds(stone) {
    const normal = stone.mass * this.params.gravity;
    const postureFactor = stone.posture === 'edge' || stone.posture === 'falling' ? 0.82 : 1;
    const force = this.params.muStatic * normal * postureFactor;
    const torque = this.params.muStatic * normal * this.params.torsionalRadius * (stone.posture === 'edge' ? 0.56 : 1);
    return { force, torque, normal };
  }

  utilizationFor(stone, force, torque) {
    const th = this.staticThresholds(stone);
    const f = len(force) / Math.max(th.force, EPS);
    const t = Math.abs(torque) / Math.max(th.torque, EPS);
    return { combined: Math.hypot(f, t), force: f, torque: t };
  }

  tipUtilizationFor(stone, force) {
    const normal = stone.mass * this.params.gravity;
    const edgeLike = stone.posture === 'edge' || stone.posture === 'falling';
    const support = edgeLike ? this.params.edgeSupportHalf : this.params.flatSupportHalf;
    const height = edgeLike ? this.params.edgeHeight : this.params.flatHeight;
    return len(force) * height / Math.max(support * normal, EPS);
  }

  computeBackgroundLoads(hand = null) {
    const stones = this.activeStones();
    const loads = new Map(stones.map((s) => [s.id, { force: v(), torque: 0, energy: 0 }]));
    const opts = this.magneticOpts();
    let potential = 0;

    for (let i = 0; i < stones.length; i += 1) {
      for (let j = i + 1; j < stones.length; j += 1) {
        const a = stones[i], b = stones[j];
        const ma = this.momentOf(a), mb = this.momentOf(b);
        const fOnB = dipoleForce(a.pos, ma, b.pos, mb, opts);
        const ta = dipoleTorque(b.pos, mb, a.pos, ma, opts);
        const tb = dipoleTorque(a.pos, ma, b.pos, mb, opts);
        loads.get(a.id).force = sub(loads.get(a.id).force, fOnB);
        loads.get(b.id).force = add(loads.get(b.id).force, fOnB);
        loads.get(a.id).torque += ta;
        loads.get(b.id).torque += tb;
        const u = dipolePotential(a.pos, ma, b.pos, mb, opts);
        loads.get(a.id).energy += 0.5 * u;
        loads.get(b.id).energy += 0.5 * u;
        potential += u;
      }
    }

    if (hand?.active) {
      const mh = momentVector(hand.angle, (hand.moment ?? 1) * this.params.momentScale);
      for (const s of stones) {
        const ms = this.momentOf(s);
        const f = dipoleForce(hand.pos, mh, s.pos, ms, opts);
        const t = dipoleTorque(hand.pos, mh, s.pos, ms, opts);
        loads.get(s.id).force = add(loads.get(s.id).force, f);
        loads.get(s.id).torque += t;
        const u = dipolePotential(hand.pos, mh, s.pos, ms, opts);
        loads.get(s.id).energy += u;
        potential += u;
      }
    }
    return { loads, potential };
  }

  evaluateHand(hand) {
    const stones = this.activeStones();
    const opts = this.magneticOpts();
    const mh = momentVector(hand.angle, (hand.moment ?? 1) * this.params.momentScale);
    let force = v(), torque = 0, energy = 0, minGap = Infinity;
    for (const s of stones) {
      const ms = this.momentOf(s);
      force = add(force, dipoleForce(s.pos, ms, hand.pos, mh, opts));
      torque += dipoleTorque(s.pos, ms, hand.pos, mh, opts);
      energy += dipolePotential(s.pos, ms, hand.pos, mh, opts);
      minGap = Math.min(minGap, distance(hand.pos, s.pos) - (hand.collisionRadius ?? 0.27) - s.collisionRadius);
    }
    const proxy = createStone({
      pos: hand.pos,
      angle: hand.angle,
      moment: hand.moment,
      posture: hand.posture,
      mass: hand.mass ?? 1,
    });
    const util = this.utilizationFor(proxy, force, torque);
    const tip = this.tipUtilizationFor(proxy, force);
    const boundaryMargin = signedBoundaryMargin(hand.pos, this.cordPolygon) - (hand.footprintRadius ?? 0.42);
    return { force, torque, energy, minGap, boundaryMargin, utilization: Math.max(util.combined, tip), ...util, tip };
  }

  applyJointForces(loads) {
    for (const joint of this.joints.values()) {
      const a = this.getStone(joint.a), b = this.getStone(joint.b);
      if (!a || !b) continue;
      const d = sub(b.pos, a.pos);
      const dist = Math.max(len(d), EPS);
      const n = mul(d, 1 / dist);
      const rel = dot(sub(b.vel, a.vel), n);
      const stretch = dist - joint.rest;
      const magnitude = this.params.jointStiffness * stretch + this.params.jointDamping * rel;
      const f = mul(n, magnitude);
      loads.get(a.id).force = add(loads.get(a.id).force, f);
      loads.get(b.id).force = sub(loads.get(b.id).force, f);
    }
  }

  applyCordForces(stone, load) {
    stone.boundaryMargin = signedBoundaryMargin(stone.pos, this.cordPolygon) - stone.footprintRadius;
    const centerMargin = signedBoundaryMargin(stone.pos, this.cordPolygon);
    if (!this.params.cordSolid || centerMargin >= stone.collisionRadius) return;
    const nearest = nearestPointOnPolygon(stone.pos, this.cordPolygon);
    const inside = pointInPolygon(stone.pos, this.cordPolygon);
    let inward = inside ? unit(sub(stone.pos, nearest.point)) : unit(sub(nearest.point, stone.pos));
    if (len2(inward) < EPS) inward = v(0, 1);
    const penetration = stone.collisionRadius - centerMargin;
    const vn = dot(stone.vel, inward);
    const magnitude = this.params.cordStiffness * penetration - this.params.cordDamping * Math.min(vn, 0);
    load.force = add(load.force, mul(inward, Math.max(0, magnitude)));
  }

  applyFrictionAndIntegrate(stone, load, dt) {
    const p = this.params;
    const util = this.utilizationFor(stone, load.force, load.torque);
    const tip = this.tipUtilizationFor(stone, load.force);
    stone.forceUtilization = util.force;
    stone.torqueUtilization = util.torque;
    stone.tipUtilization = tip;
    stone.utilization = Math.max(util.combined, tip);
    stone.force = { ...load.force };
    stone.torque = load.torque;
    stone.energy = load.energy;

    if (stone.posture === 'edge' && tip > 1) {
      stone.posture = 'falling';
      stone.tiltVelocity = -1.8 - 0.7 * Math.min(tip - 1, 2);
      stone.vel = add(stone.vel, mul(unit(load.force), p.tipImpulse));
      stone.omega += ((stone.id.length % 2 ? 1 : -1) * 0.21);
      this.emit('tip', { stoneId: stone.id, utilization: tip });
    }
    if (stone.posture === 'falling') {
      stone.tilt += stone.tiltVelocity * dt;
      stone.tiltVelocity -= 2.8 * dt;
      if (stone.tilt <= 0) {
        stone.tilt = 0;
        stone.tiltVelocity = 0;
        stone.posture = 'flat';
        stone.vel = add(stone.vel, mul(unit(load.force), 0.08));
        this.emit('land', { stoneId: stone.id });
      }
    }

    const speed = len(stone.vel);
    const quasiStatic = speed < p.sleepSpeed && Math.abs(stone.omega) < p.sleepOmega;
    if (quasiStatic && util.combined < 1 && tip < 1 && stone.posture !== 'falling') {
      stone.vel = v();
      stone.omega = 0;
      stone.pinned = true;
      stone.sleeping = true;
      return;
    }

    stone.pinned = false;
    stone.sleeping = false;
    stone.lastMovedAt = this.time;

    const normal = stone.mass * p.gravity;
    const kineticForce = p.muKinetic * normal;
    let friction = v();
    if (speed > 1e-5) friction = mul(stone.vel, -kineticForce / speed);
    else if (len(load.force) > EPS) friction = mul(unit(load.force), -Math.min(kineticForce, len(load.force)));

    const torqueLimit = p.muKinetic * normal * p.torsionalRadius;
    const torqueFriction = Math.abs(stone.omega) > 1e-5
      ? -Math.sign(stone.omega) * torqueLimit
      : -Math.sign(load.torque) * Math.min(torqueLimit, Math.abs(load.torque));

    const acceleration = mul(add(load.force, friction), 1 / stone.mass);
    stone.vel = add(stone.vel, mul(acceleration, dt));
    stone.omega += (load.torque + torqueFriction) / stone.inertia * dt;

    const ld = Math.exp(-p.linearDamping * dt);
    const ad = Math.exp(-p.angularDamping * dt);
    stone.vel = mul(stone.vel, ld);
    stone.omega *= ad;

    const vs = len(stone.vel);
    if (vs > p.maxSpeed) stone.vel = mul(stone.vel, p.maxSpeed / vs);
    stone.omega = clamp(stone.omega, -p.maxOmega, p.maxOmega);
    stone.pos = add(stone.pos, mul(stone.vel, dt));
    stone.angle = wrapAngle(stone.angle + stone.omega * dt);
  }

  resolveContacts(hand = null) {
    const stones = this.activeStones();
    const opts = this.magneticOpts();
    for (const s of stones) s.minGap = Infinity;
    let minGap = Infinity;

    for (let i = 0; i < stones.length; i += 1) {
      for (let j = i + 1; j < stones.length; j += 1) {
        const a = stones[i], b = stones[j];
        const d = sub(b.pos, a.pos);
        const dist = Math.max(len(d), EPS);
        const radius = a.collisionRadius + b.collisionRadius;
        const gap = dist - radius;
        minGap = Math.min(minGap, gap);
        a.minGap = Math.min(a.minGap, gap);
        b.minGap = Math.min(b.minGap, gap);
        if (gap >= 0) continue;

        const n = mul(d, 1 / dist);
        const penetration = -gap;
        const invMass = 1 / a.mass + 1 / b.mass;
        const correction = penetration / Math.max(invMass, EPS) * 0.58;
        a.pos = sub(a.pos, mul(n, correction / a.mass));
        b.pos = add(b.pos, mul(n, correction / b.mass));

        const rel = dot(sub(b.vel, a.vel), n);
        if (rel < 0) {
          const impulse = -(1 + this.params.restitution) * rel / Math.max(invMass, EPS);
          a.vel = sub(a.vel, mul(n, impulse / a.mass));
          b.vel = add(b.vel, mul(n, impulse / b.mass));
        }

        if (!this.isJoined(a.id, b.id)) {
          const ma = this.momentOf(a), mb = this.momentOf(b);
          const fOnB = dipoleForce(a.pos, ma, b.pos, mb, opts);
          const attraction = dot(fOnB, mul(n, -1));
          const potential = dipolePotential(a.pos, ma, b.pos, mb, opts);
          const relSpeed = Math.abs(rel);
          if (potential < -this.params.captureEnergy ||
              (attraction > this.params.captureAttraction && relSpeed < this.params.captureSpeed)) {
            this.addJoint(a.id, b.id, { rest: radius - 0.045 });
          } else {
            this.emit('contact', { a: a.id, b: b.id, potential, attraction });
          }
        }
      }
    }

    if (hand?.active) {
      const mh = momentVector(hand.angle, (hand.moment ?? 1) * this.params.momentScale);
      for (const s of stones) {
        const d = sub(s.pos, hand.pos);
        const dist = Math.max(len(d), EPS);
        const radius = s.collisionRadius + (hand.collisionRadius ?? 0.27);
        const gap = dist - radius;
        minGap = Math.min(minGap, gap);
        if (gap >= 0) continue;
        const n = mul(d, 1 / dist);
        const ms = this.momentOf(s);
        const fOnS = dipoleForce(hand.pos, mh, s.pos, ms, opts);
        const attraction = dot(fOnS, mul(n, -1));
        const potential = dipolePotential(hand.pos, mh, s.pos, ms, opts);
        if (potential < -this.params.captureEnergy || attraction > this.params.captureAttraction) {
          this.emit('handCapture', { stoneId: s.id, potential, attraction });
        } else {
          this.emit('handContact', { stoneId: s.id, potential, attraction });
        }
      }
    }
    this.minGap = minGap;
  }

  checkBoundaryEvents() {
    for (const s of this.activeStones()) {
      const wasOutside = s.outside;
      s.boundaryMargin = signedBoundaryMargin(s.pos, this.cordPolygon) - s.footprintRadius;
      s.outside = s.boundaryMargin < 0;
      if (s.outside && !wasOutside) this.emit('boundaryExit', { stoneId: s.id, margin: s.boundaryMargin });
      if (!s.outside && wasOutside) this.emit('boundaryReentry', { stoneId: s.id, margin: s.boundaryMargin });
    }
  }

  step(dt, hand = null) {
    this.lastStepEvents = [];
    this.time += dt;
    const { loads, potential } = this.computeBackgroundLoads(hand);
    this.applyJointForces(loads);

    for (const s of this.activeStones()) {
      const load = loads.get(s.id);
      this.applyCordForces(s, load);
      this.applyFrictionAndIntegrate(s, load, dt);
    }

    this.resolveContacts(hand);
    this.checkBoundaryEvents();

    let kinetic = 0;
    let maxUtil = 0;
    let minBoundary = Infinity;
    for (const s of this.activeStones()) {
      kinetic += 0.5 * s.mass * len2(s.vel) + 0.5 * s.inertia * s.omega * s.omega;
      maxUtil = Math.max(maxUtil, s.utilization);
      minBoundary = Math.min(minBoundary, s.boundaryMargin);
    }
    this.totalPotential = potential;
    this.totalKinetic = kinetic;
    this.maxUtilization = maxUtil;
    this.minBoundaryMargin = minBoundary;
    return this.lastStepEvents;
  }

  isSettled() {
    return this.activeStones().every((s) => len(s.vel) < this.params.settleSpeed && Math.abs(s.omega) < this.params.settleOmega && s.posture !== 'falling');
  }

  serialize() {
    return {
      version: 1,
      time: this.time,
      params: { ...this.params },
      cord: { ...this.cord, center: { ...this.cord.center } },
      stones: this.activeStones().map((s) => ({
        id: s.id, player: s.player, pos: { ...s.pos }, vel: { ...s.vel }, angle: s.angle,
        omega: s.omega, moment: s.moment, posture: s.posture, tilt: s.tilt,
        mass: s.mass, inertia: s.inertia, collisionRadius: s.collisionRadius,
        footprintRadius: s.footprintRadius, length: s.length, width: s.width,
      })),
      joints: [...this.joints.values()].map((j) => ({ ...j })),
    };
  }

  load(data) {
    this.clear();
    this.params = { ...defaultParams(), ...(data.params ?? {}) };
    this.cord = { ...this.cord, ...(data.cord ?? {}) };
    this.cord.center = { ...(data.cord?.center ?? v()) };
    this.cordPolygon = generateCordPolygon(this.cord);
    this.time = data.time ?? 0;
    for (const s of data.stones ?? []) this.addStone(s);
    for (const j of data.joints ?? []) {
      const key = pairKey(j.a, j.b);
      this.joints.set(key, { ...j });
    }
  }
}
