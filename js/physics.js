// SPACEFORCE — complete reduced hybrid model of the two-rail ball game.
//
// Rigid-body foundation: Xu, Groff & Burg (2010–2012).
// Extended here with rolling loss, compliance, hybrid release, score risk,
// independent axial rod rotation and compound opening–twist control.
//
// Symmetric geometry:
//   d = d0 + 2x tan(alpha)       eta = d / [2(R+r)]
//   delta = sqrt(1-eta^2)       M = m(1+kappa/delta^2)
//
// Reduced longitudinal equation:
//   M vdot = -Vx - 1/2 Mx v^2 - M_alpha alphadot v - Fd + F_phi
//
// Twist modes (local parallel circular limit):
//   phi_c = (phi_plus + phi_minus)/2
//   phi_D = (phi_minus - phi_plus)/2
//   omega_x = -(r/R) phidot_c
//   eta zdot = r phidot_D
//
// In divergent/skewed/deformed geometry, rod-surface twist can also produce
// a weak longitudinal contact velocity.  The F_phi term below is an explicit,
// tunable reduced-order coupling, not a calibrated claim about one machine.

const DEG = Math.PI / 180;
const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
const approach = (x, target, maxStep) => x + clamp(target - x, -maxStep, maxStep);

export const P = {
  // ball & rods
  R: 0.0127,
  r: 0.004,
  m: 0.032,
  kappa: 2 / 5,
  g: 9.81,

  // rail geometry
  L: 0.42,
  beta: 2.0 * DEG,
  d0: 0.018,
  x0: 0.025,

  // opening actuator
  alphaMin: 0.25 * DEG,
  alphaMax: 3.4 * DEG,
  alpha0: 0.6 * DEG,
  alphaRateMax: 4.5 * DEG,
  alphaPulseRateMax: 12.0 * DEG,

  // independent axial rod rotation — nominal observed range, to be measured
  phiMax: 5.0 * DEG,
  phiRateMax: 85 * DEG,
  phiPulseRateMax: 170 * DEG,
  omegaXRelax: 0.040,
  omegaXFlightHalfLife: 0.75,
  zRelMax: 0.007,
  zRelRelax: 0.060,
  zRelCenterTau: 1.20,
  twistSlipScale: 0.0035,
  twistContactDamping: 0.22,
  twistLongitudinalGain: 22.0,
  twistTractionK: 0.70,
  twistForceShare: 0.45,

  // No whole-rig lateral translation: the physical apparatus only opens and twists.

  // deck rolling
  mu_wood: 0.02,

  // dissipation & contact
  mu_r: 0.002,
  c1: 0.01,
  c2: 0.06,
  mu_s: 0.35,

  // compliance closure eta = eta_c + Lambda eta/delta
  Lambda: 0.008,

  // display guards
  omegaMax: 260,
  omegaXMax: 30,
  NmaxFactor: 4,

  // release timing uncertainty
  sigma_x: 0.0035,
  sigma_t: 0.03,

  // scoring deck
  dropH: 0.055,
  boardLen: 0.56,
  boardW: 0.16,
  holes: [
    { x: 0.130, r: 0.0165, cap: 0.0135, score: 100,  label: '100' },
    { x: 0.190, r: 0.0165, cap: 0.0135, score: 200,  label: '200' },
    { x: 0.250, r: 0.0165, cap: 0.0135, score: 300,  label: '300' },
    { x: 0.310, r: 0.0165, cap: 0.0135, score: 400,  label: '400' },
    { x: 0.370, r: 0.0165, cap: 0.0135, score: 500,  label: '500' },
    { x: 0.457, r: 0.0180, cap: 0.0150, score: 1000, label: 'SPACE FORCE' },
  ],
};

P.a = P.R + P.r;
P.deltaFold = Math.cbrt(P.Lambda);
P.etaFold = Math.sqrt(1 - Math.pow(P.Lambda, 2 / 3));
P.etaCmdFold = Math.pow(1 - Math.pow(P.Lambda, 2 / 3), 1.5);
P.tFall = Math.sqrt(2 * (P.dropH - P.R) / (P.g * Math.cos(P.beta)));

// Abramowitz–Stegun 7.1.26
export function erf(z) {
  const s = z < 0 ? -1 : 1;
  z = Math.abs(z);
  const t = 1 / (1 + 0.3275911 * z);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return s * y;
}

export function pHit(v, dx) {
  const sEff = Math.sqrt(P.sigma_x * P.sigma_x + v * v * P.sigma_t * P.sigma_t);
  return erf(dx / (2 * Math.SQRT2 * sEff));
}

function randn() {
  let u = 0, w = 0;
  while (u === 0) u = Math.random();
  while (w === 0) w = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * w);
}

function pulseShape(s, duration = 3.2) {
  if (s <= 0 || s >= duration) return 0;
  return Math.sin(Math.PI * s / duration);
}

export class Sim {
  constructor() {
    this.attempts = 0;
    this.best = 0;
    this.log = [];
    this.autopilot = false;
    this.etaRef = 0.86;
    this.noise = false;
    this.targetIndex = P.holes.length - 1;
    this.reset();
  }

  reset() {
    this.mode = 'ROLL';
    this.t = 0;
    this.x = P.x0;
    this.v = 0;
    this.vdot = 0;
    this.alpha = P.alpha0;
    this.alphaDot = 0;
    this.manualRate = 0;

    this.zRel = 0;
    this.zRelDot = 0;

    // phiMinus = left rod, phiPlus = right rod in the UI.
    this.phiMinus = 0;
    this.phiPlus = 0;
    this.phiMinusDot = 0;
    this.phiPlusDot = 0;
    this.manualPhiMinus = 0;
    this.manualPhiPlus = 0;
    this.phiC = 0;
    this.phiDelta = 0;
    this.phiCDot = 0;
    this.phiDeltaDot = 0;
    this.omegaX = 0;
    this.spinXAngle = 0;
    this.sDelta = 0;
    this.twistSlip = false;
    this.Fphi = 0;
    this.vTwist = 0;

    this.pulse = null;
    this.pulsePending = null;
    this.flight = null;
    this.result = null;
    this.cause = '';
    this.slip = false;
    this.omega = 0;
    this.spinAngle = 0;
    this.trace = [];
    this._traceT = 0;

    const sol = this.solveEta(this.etaCmd(this.x, this.alpha));
    this.eta = sol.eta;
    this.delta = Math.sqrt(Math.max(1 - this.eta * this.eta, 1e-9));
    this.N = P.m * P.g * Math.cos(P.beta) / (2 * this.delta);
    this.FtLongReq = 0;
    this.FtTwistReq = 0;
    this.FtReq = 0;
    this.FtCap = 1;
    this.Gamma = 0;
  }

  etaCmd(x, alpha) {
    return (P.d0 + 2 * x * Math.tan(alpha)) / (2 * P.a);
  }

  solveEta(etaC) {
    if (etaC >= P.etaCmdFold) return { eta: P.etaFold, fold: true };
    let eta = clamp(etaC, 0.02, P.etaFold);
    for (let i = 0; i < 14; i++) {
      const d = Math.sqrt(Math.max(1 - eta * eta, 1e-9));
      const next = etaC + P.Lambda * eta / d;
      if (!isFinite(next) || next >= P.etaFold) return { eta: P.etaFold, fold: true };
      if (Math.abs(next - eta) < 1e-8) { eta = next; break; }
      eta = next;
    }
    return { eta, fold: false };
  }

  predictReleaseX(alpha = this.alpha) {
    const tanA = Math.tan(alpha);
    if (tanA <= 1e-7) return Infinity;
    return (2 * P.a * P.etaCmdFold - P.d0) / (2 * tanA);
  }

  triggerPulse(ampRad, tau) {
    if (this.mode !== 'ROLL') return;
    const delay = this.noise ? Math.max(0, 0.02 + P.sigma_t * randn()) : 0;
    this.pulsePending = {
      at: this.t + delay,
      alphaAmp: ampRad,
      twistAmp: 0,
      tau,
      twistMode: 'none',
    };
  }

  triggerCompoundPulse(alphaAmpRad, tau, twistAmpRad, twistMode = 'common') {
    if (this.mode !== 'ROLL') return;
    const delay = this.noise ? Math.max(0, 0.02 + P.sigma_t * randn()) : 0;
    this.pulsePending = {
      at: this.t + delay,
      alphaAmp: alphaAmpRad,
      twistAmp: clamp(twistAmpRad, 0, P.phiMax),
      tau,
      twistMode,
    };
  }

  setManualRate(r) { this.manualRate = clamp(r, -1, 1); }
  setManualTwist(minusRate, plusRate) {
    this.manualPhiMinus = clamp(minusRate, -1, 1);
    this.manualPhiPlus = clamp(plusRate, -1, 1);
  }

  selectedHole() { return P.holes[this.targetIndex]; }

  pHitNow() {
    const h = this.selectedHole();
    const v = this.mode === 'ROLL' ? Math.abs(this.v) : Math.abs(this.flight?.vx ?? 0);
    return pHit(v, 2 * h.cap);
  }

  step(dtFrame) {
    const n = Math.max(1, Math.ceil(dtFrame / 0.002));
    const dt = dtFrame / n;
    for (let i = 0; i < n; i++) {
      this.t += dt;
      if (this.mode === 'ROLL') {
        this.updateControl(dt);
        this.stepRoll(dt);
      } else if (this.mode === 'FLIGHT' || this.mode === 'SINK') {
        this.stepFlight(dt);
      } else if (this.mode === 'BOARD') {
        this.stepBoard(dt);
      }

      this._traceT += dt;
      if (this._traceT > 0.02) {
        this._traceT = 0;
        const x = this.mode === 'ROLL' ? this.x : (this.flight ? this.flight.x : this.x);
        const v = this.mode === 'ROLL' ? this.v : (this.flight ? this.flight.vx : 0);
        this.trace.push([x, v]);
        if (this.trace.length > 3000) this.trace.shift();
      }
    }
  }

  startPendingPulse() {
    if (!this.pulsePending || this.t < this.pulsePending.at) return;
    this.pulse = {
      t0: this.t,
      alphaAmp: this.pulsePending.alphaAmp,
      twistAmp: this.pulsePending.twistAmp,
      tau: this.pulsePending.tau,
      twistMode: this.pulsePending.twistMode,
      alphaBase: this.alpha,
      phiMinusBase: this.phiMinus,
      phiPlusBase: this.phiPlus,
    };
    this.pulsePending = null;
  }

  updateControl(dt) {
    this.startPendingPulse();

    // Baseline opening command.
    let alphaTarget;
    if (this.manualRate !== 0) {
      alphaTarget = this.alpha + this.manualRate * P.alphaRateMax * dt;
    } else if (this.autopilot) {
      const ref = Math.min(this.etaRef, P.etaCmdFold - 0.004);
      const tanT = (2 * P.a * ref - P.d0) / (2 * Math.max(this.x, 0.02));
      alphaTarget = Math.atan(clamp(tanT, Math.tan(P.alphaMin), Math.tan(P.alphaMax)));
    } else {
      alphaTarget = this.alpha;
    }

    // Manual rod-angle integration.  Releasing the key holds the angle.
    let phiMinusTarget = clamp(
      this.phiMinus + this.manualPhiMinus * P.phiRateMax * dt,
      -P.phiMax, P.phiMax
    );
    let phiPlusTarget = clamp(
      this.phiPlus + this.manualPhiPlus * P.phiRateMax * dt,
      -P.phiMax, P.phiMax
    );

    let alphaAuthority = P.alphaRateMax;
    let phiAuthority = P.phiRateMax;

    if (this.pulse) {
      const s = (this.t - this.pulse.t0) / this.pulse.tau;
      const duration = this.pulse.twistMode === 'phased' ? 3.65 : 3.2;
      const g = pulseShape(s, 3.2);
      alphaTarget = this.pulse.alphaBase + this.pulse.alphaAmp * g;
      alphaAuthority = P.alphaPulseRateMax;
      phiAuthority = P.phiPulseRateMax;

      const A = this.pulse.twistAmp;
      if (this.pulse.twistMode === 'common') {
        phiMinusTarget = this.pulse.phiMinusBase + A * g;
        phiPlusTarget = this.pulse.phiPlusBase + A * g;
      } else if (this.pulse.twistMode === 'differential') {
        phiMinusTarget = this.pulse.phiMinusBase + A * g;
        phiPlusTarget = this.pulse.phiPlusBase - A * g;
      } else if (this.pulse.twistMode === 'phased') {
        const gMinus = pulseShape(s, 3.2);
        const gPlus = pulseShape(s - 0.45, 3.2);
        phiMinusTarget = this.pulse.phiMinusBase + A * gMinus;
        phiPlusTarget = this.pulse.phiPlusBase + A * gPlus;
      }

      if (s >= duration) {
        alphaTarget = this.pulse.alphaBase;
        phiMinusTarget = this.pulse.phiMinusBase;
        phiPlusTarget = this.pulse.phiPlusBase;
        const returned = Math.abs(this.alpha - alphaTarget) < 0.02 * DEG
          && Math.abs(this.phiMinus - phiMinusTarget) < 0.05 * DEG
          && Math.abs(this.phiPlus - phiPlusTarget) < 0.05 * DEG;
        if (returned || s > duration + 0.9) this.pulse = null;
      }
    }

    alphaTarget = clamp(alphaTarget, P.alphaMin, P.alphaMax);
    phiMinusTarget = clamp(phiMinusTarget, -P.phiMax, P.phiMax);
    phiPlusTarget = clamp(phiPlusTarget, -P.phiMax, P.phiMax);

    const oldAlpha = this.alpha;
    this.alpha = approach(this.alpha, alphaTarget, alphaAuthority * dt);
    this.alphaDot = (this.alpha - oldAlpha) / dt;

    const oldMinus = this.phiMinus;
    const oldPlus = this.phiPlus;
    this.phiMinus = approach(this.phiMinus, phiMinusTarget, phiAuthority * dt);
    this.phiPlus = approach(this.phiPlus, phiPlusTarget, phiAuthority * dt);
    this.phiMinusDot = (this.phiMinus - oldMinus) / dt;
    this.phiPlusDot = (this.phiPlus - oldPlus) / dt;

    this.phiC = 0.5 * (this.phiPlus + this.phiMinus);
    this.phiDelta = 0.5 * (this.phiMinus - this.phiPlus);
    this.phiCDot = 0.5 * (this.phiPlusDot + this.phiMinusDot);
    this.phiDeltaDot = 0.5 * (this.phiMinusDot - this.phiPlusDot);

  }

  updateTwistKinematics(dt, eta, tanA) {
    // Common twist commands longitudinal-axis spin in the local parallel limit.
    const omegaXTarget = -(P.r / P.R) * this.phiCDot;
    const kSpin = 1 - Math.exp(-dt / P.omegaXRelax);
    this.omegaX += (omegaXTarget - this.omegaX) * kSpin;
    this.spinXAngle += this.omegaX * dt;

    // Differential twist is conjugate to cross-sectional motion.  A small
    // compliant steering state is retained; centering models finite geometry.
    const idealZDot = P.r * this.phiDeltaDot / Math.max(eta, 0.08);
    const centeredTarget = idealZDot - this.zRel / P.zRelCenterTau;
    const kZ = 1 - Math.exp(-dt / P.zRelRelax);
    this.zRelDot += (centeredTarget - this.zRelDot) * kZ;
    let zNext = this.zRel + this.zRelDot * dt;
    if (zNext <= -P.zRelMax || zNext >= P.zRelMax) {
      zNext = clamp(zNext, -P.zRelMax, P.zRelMax);
      this.zRelDot = 0;
    }
    this.zRel = zNext;

    this.sDelta = P.r * this.phiDeltaDot - eta * this.zRelDot;
    this.twistSlip = Math.abs(this.sDelta) > P.twistSlipScale;
    this.FtTwistReq = P.twistContactDamping * this.sDelta;

    // Reduced direct longitudinal coupling outside the exact parallel limit.
    // It scales with divergence and with a small phased/differential component.
    const phaseTerm = 0.35 * this.phiDeltaDot * (this.zRel / P.zRelMax);
    this.vTwist = P.twistLongitudinalGain * P.r * tanA * (this.phiCDot + phaseTerm);
  }

  stepRoll(dt) {
    const { m, g, kappa, a } = P;
    const cosB = Math.cos(P.beta), sinB = Math.sin(P.beta);
    const tanA = Math.tan(this.alpha), sec2 = 1 + tanA * tanA;

    const etaC = this.etaCmd(this.x, this.alpha);
    const sol = this.solveEta(etaC);
    this.eta = sol.eta;
    if (sol.fold) return this.release('COMPLIANCE FOLD · SNAP-THROUGH');
    if (this.eta >= 0.999) return this.release('SUPPORT LIMIT · eta → 1');

    const eta = this.eta;
    const delta = Math.sqrt(Math.max(1 - eta * eta, 1e-9));
    this.delta = delta;
    const d2 = delta * delta, d4 = d2 * d2;

    this.updateTwistKinematics(dt, eta, tanA);

    const M = m * (1 + kappa / d2);
    const Vx = m * g * (sinB - eta * tanA / delta);
    const Mx = 2 * m * kappa * eta * tanA / (a * d4);
    const Ma = 2 * m * kappa * eta * this.x * sec2 / (a * d4);
    const Fd = P.mu_r * m * g * cosB / delta * Math.tanh(this.v / 0.005)
      + P.c1 * this.v + P.c2 * Math.abs(this.v) * this.v;

    this.N = m * g * cosB / (2 * delta);
    this.FtCap = P.mu_s * m * g * cosB / delta;
    const rawFphi = P.twistTractionK * this.vTwist;
    this.Fphi = clamp(rawFphi, -P.twistForceShare * this.FtCap, P.twistForceShare * this.FtCap);

    let vdot = (-Vx - 0.5 * Mx * this.v * this.v - Ma * this.alphaDot * this.v - Fd + this.Fphi) / M;

    const etaDot = (tanA * this.v + this.x * sec2 * this.alphaDot) / a;
    const deltaDot = -eta * etaDot / delta;
    this.FtLongReq = kappa * m * (vdot / delta - this.v * deltaDot / d2);
    this.FtReq = Math.hypot(this.FtLongReq, this.FtTwistReq, this.Fphi);
    this.slip = this.FtReq > this.FtCap;

    if (this.slip) {
      const scale = this.FtCap / Math.max(this.FtReq, 1e-12);
      const oldFphi = this.Fphi;
      this.Fphi *= scale;
      this.zRelDot *= scale;
      this.sDelta = P.r * this.phiDeltaDot - eta * this.zRelDot;
      this.FtTwistReq = P.twistContactDamping * this.sDelta;
      vdot += (this.Fphi - oldFphi) / M;

      // Limit the longitudinal rolling demand to its remaining friction share.
      const remaining = Math.sqrt(Math.max(this.FtCap * this.FtCap
        - this.FtTwistReq * this.FtTwistReq - this.Fphi * this.Fphi, 0));
      if (Math.abs(this.FtLongReq) > remaining) {
        const s = Math.sign(this.FtLongReq || 1);
        vdot = s * remaining * delta / (kappa * m) + this.v * deltaDot / delta;
      }
    }

    this.vdot = vdot;
    this.v += vdot * dt;
    this.x += this.v * dt;

    this.omega = Math.abs(this.v) / (P.R * delta);
    this.spinAngle += (this.v / (P.R * delta)) * dt;
    this.Gamma = eta * tanA / delta - sinB;

    if (this.x <= P.x0 && this.v < 0) { this.x = P.x0; this.v = 0; }
    if (this.x >= P.L) return this.release('END OF RAILS');
  }

  release(cause) {
    this.cause = cause;
    this.mode = 'FLIGHT';
    this.flight = {
      x: this.x,
      y: P.a * this.delta,
      z: this.zRel,
      vx: this.v,
      vy: 0,
      vz: this.zRelDot,
      spin: this.omega,
      spinX: this.omegaX,
    };
  }

  capturedBy(f) {
    return P.holes.find(h => {
      const dx = f.x - h.x, dz = f.z;
      return dx * dx + dz * dz < h.cap * h.cap;
    });
  }

  capture(h) {
    const f = this.flight;
    this.mode = 'SINK';
    this.result = { score: h.score, label: h.label };
    f.x = h.x; f.z = 0; f.vx = 0; f.vz = 0;
  }

  offDeck(f) {
    return f.x > P.boardLen - 0.06 || f.x < 0 || Math.abs(f.z) > P.boardW / 2 - 0.012;
  }

  stepFlight(dt) {
    const f = this.flight;
    const cosB = Math.cos(P.beta), sinB = Math.sin(P.beta);
    f.vx += -P.g * sinB * dt;
    f.vy += -P.g * cosB * dt;
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    f.z += f.vz * dt;
    f.spin *= Math.pow(0.5, dt / 0.8);
    f.spinX *= Math.pow(0.5, dt / P.omegaXFlightHalfLife);
    this.omega = Math.abs(f.spin);
    this.omegaX = f.spinX;
    this.spinAngle += f.spin * dt;
    this.spinXAngle += f.spinX * dt;

    if (this.mode === 'SINK') {
      if (f.y <= -P.dropH - 2.2 * P.R) this.finish(this.result.score, this.result.label);
      return;
    }

    const yRest = -P.dropH + P.R;
    if (f.vy < 0 && f.y <= yRest) {
      const h = this.capturedBy(f);
      if (h) return this.capture(h);
      if (this.offDeck(f)) return this.finish(0, 'TRAY');
      f.y = yRest;
      f.vy = -f.vy * 0.32;
      f.vx *= 0.55;
      f.vz *= 0.7;
      if (Math.abs(f.vy) < 0.06) { f.vy = 0; this.mode = 'BOARD'; }
    }
  }

  stepBoard(dt) {
    const f = this.flight;
    const cosB = Math.cos(P.beta), sinB = Math.sin(P.beta);
    const sp = Math.hypot(f.vx, f.vz);

    let ax = -P.g * sinB;
    let az = 0;
    if (sp > 1e-4) {
      const fr = P.mu_wood * P.g * cosB;
      ax += -fr * f.vx / sp;
      az += -fr * f.vz / sp;
    }
    f.vx += ax * dt;
    f.vz += az * dt;
    f.x += f.vx * dt;
    f.z += f.vz * dt;
    this.spinAngle += (f.vx / P.R) * dt;
    this.spinXAngle += f.spinX * dt;
    this.omega = Math.abs(f.vx) / P.R;
    f.spinX *= Math.pow(0.5, dt / 0.35);
    this.omegaX = f.spinX;

    const h = this.capturedBy(f);
    if (h) { f.vy = 0; return this.capture(h); }
    if (this.offDeck(f)) return this.finish(0, 'TRAY');
    if (sp < 0.008 && P.mu_wood >= Math.tan(P.beta)) return this.finish(0, 'MISS');
  }

  finish(score, label) {
    this.mode = 'DONE';
    this.attempts++;
    this.result = { score, label };
    if (score > this.best) this.best = score;
    this.log.unshift({
      n: this.attempts,
      score,
      label,
      cause: this.cause || '—',
      x: this.flight ? this.flight.x : this.x,
    });
    if (this.log.length > 6) this.log.pop();
  }
}
