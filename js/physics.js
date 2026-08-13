// SPACEFORCE — reduced hybrid model of the two-rail ball game.
//
// Implements the compact simulation model of Appendix B in:
//   J. Gomila, "Risk-Optimal Pulsed Control of a Variable-Separation
//   Two-Rail Ball Game" (2026).
//
//   d = d0 + 2x tanα              η = d / (2(R+r))       δ = sqrt(1 − η²)
//   M = m (1 + κ/δ²)              V = m g (x sinβ + (R+r)δ)
//   M v̇ = −Vx − ½ Mx v² − Mα α̇ v − Fd        ẋ = v
//   Fd = μr m g cosβ/δ · sgn(v) + c1 v + c2 |v| v
//
// with the static compliance closure η = ηc + Λ η/δ (Eq. 7.4), whose fold at
// δ* = Λ^{1/3} (Prop. 7.1) is a snap-through release guard, and the hybrid
// transition to ballistic free flight (Eq. 8.2) at support loss.

const DEG = Math.PI / 180;

export const P = {
  // ball & rods
  R: 0.0127,          // ball radius [m]
  r: 0.004,           // rod radius [m]
  m: 0.032,           // ball mass [kg]
  kappa: 2 / 5,       // I = κ m R², solid sphere
  g: 9.81,

  // rail geometry
  L: 0.42,            // rail length [m]
  beta: 2.0 * DEG,    // mean uphill inclination
  d0: 0.018,          // separation at the hinge [m]
  x0: 0.025,          // start position (hinge stop)

  // actuator (opening control)
  alphaMin: 0.25 * DEG,
  alphaMax: 3.4 * DEG,
  alpha0: 0.6 * DEG,
  alphaRateMax: 4.5 * DEG,   // rad/s rate limit; pulses get extra authority

  // dissipation & contact
  mu_r: 0.002,        // rolling resistance coefficient
  c1: 0.01, c2: 0.06,
  mu_s: 0.35,         // static friction (traction guard)

  // compliance (Λ = Cb m g cosβ / 2a, Eq. 7.4)
  Lambda: 0.008,

  // display guards
  omegaMax: 260,      // rad/s spin guard G_ω
  NmaxFactor: 4,      // N_max = 4 mg, guard G_N

  // release-timing uncertainty (Eq. 9.4–9.6)
  sigma_x: 0.0035,    // residual position error [m]
  sigma_t: 0.03,      // motor timing error [s]

  // scoring deck
  dropH: 0.055,       // rod-center plane to deck [m]
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
// fold point of the compliance closure (Prop. 7.1): δ* = Λ^{1/3}
P.deltaFold = Math.cbrt(P.Lambda);
P.etaFold = Math.sqrt(1 - Math.pow(P.Lambda, 2 / 3));
P.etaCmdFold = Math.pow(1 - Math.pow(P.Lambda, 2 / 3), 1.5); // η_{c,*}
// nominal free-fall time from the rail plane to the deck surface
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

// hit probability at release speed v for a window of full width dx (Eq. 9.6)
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

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

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
    this.FtReq = 0;
    this.FtCap = 1;
    this.Gamma = 0;
  }

  etaCmd(x, alpha) {
    return (P.d0 + 2 * x * Math.tan(alpha)) / (2 * P.a);
  }

  // Solve the compliance closure η(1 − Λ/δ(η)) = ηc on the stable branch.
  // Fixed-point iteration diverges upward past the fold — that IS the snap.
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

  // Predicted release position at a given opening (fold-aware, Eq. 7.6)
  predictReleaseX(alpha = this.alpha) {
    const tanA = Math.tan(alpha);
    if (tanA <= 1e-7) return Infinity;
    return (2 * P.a * P.etaCmdFold - P.d0) / (2 * tanA);
  }

  triggerPulse(ampRad, tau) {
    if (this.mode !== 'ROLL') return;
    const delay = this.noise ? Math.max(0, 0.02 + P.sigma_t * randn()) : 0;
    this.pulsePending = { at: this.t + delay, A: ampRad, tau };
  }

  setManualRate(r) { this.manualRate = r; }

  selectedHole() { return P.holes[this.targetIndex]; }

  pHitNow() {
    const h = this.selectedHole();
    const v = this.mode === 'ROLL' ? Math.abs(this.v) : Math.hypot(this.flight?.vx ?? 0, 0);
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

  updateControl(dt) {
    if (this.pulsePending && this.t >= this.pulsePending.at) {
      this.pulse = { t0: this.t, A: this.pulsePending.A, tau: this.pulsePending.tau };
      this.pulsePending = null;
    }

    // baseline command: manual rate integration, autopilot regulation, or hold
    let base;
    if (this.manualRate !== 0) {
      base = this.alpha + this.manualRate * P.alphaRateMax * dt;
    } else if (this.autopilot) {
      // boundary-riding: hold η(x) at η_ref (kept below the commanded fold)
      const ref = Math.min(this.etaRef, P.etaCmdFold - 0.004);
      const tanT = (2 * P.a * ref - P.d0) / (2 * Math.max(this.x, 0.02));
      base = Math.atan(clamp(tanT, Math.tan(P.alphaMin), Math.tan(P.alphaMax)));
    } else {
      base = this.alpha; // hold
    }

    // finite open–close pulse α(t) = α_base + A f((t−tp)/τp), Eq. 6.4 —
    // superposed on the baseline controller with extra authority (Prop. 10.1)
    let target = base;
    let authority = P.alphaRateMax;
    if (this.pulse) {
      const s = (this.t - this.pulse.t0) / this.pulse.tau;
      if (s > 3.6) {
        this.pulse = null;
      } else {
        target = base + this.pulse.A * Math.exp(-(s - 1.6) * (s - 1.6));
        authority = P.alphaRateMax * 2.4;
      }
    }

    const rate = clamp((target - this.alpha) / dt, -authority, authority);
    this.alphaDot = rate;
    const next = clamp(this.alpha + rate * dt, P.alphaMin, P.alphaMax);
    if (next === P.alphaMin || next === P.alphaMax) this.alphaDot = 0;
    this.alpha = next;
  }

  stepRoll(dt) {
    const { m, g, kappa, a } = P;
    const cosB = Math.cos(P.beta), sinB = Math.sin(P.beta);
    const tanA = Math.tan(this.alpha), sec2 = 1 + tanA * tanA;

    const etaC = this.etaCmd(this.x, this.alpha);
    const sol = this.solveEta(etaC);
    this.eta = sol.eta;
    if (sol.fold) return this.release('COMPLIANCE FOLD · SNAP-THROUGH');
    if (this.eta >= 0.999) return this.release('SUPPORT LIMIT · η → 1');

    const eta = this.eta;
    const delta = Math.sqrt(Math.max(1 - eta * eta, 1e-9));
    this.delta = delta;
    const d2 = delta * delta, d4 = d2 * d2;

    const M = m * (1 + kappa / d2);
    const Vx = m * g * (sinB - eta * tanA / delta);        // Eq. 3.10 (negated)
    const Mx = 2 * m * kappa * eta * tanA / (a * d4);      // Eq. 3.11
    const Ma = 2 * m * kappa * eta * this.x * sec2 / (a * d4);
    const Fd = P.mu_r * m * g * cosB / delta * Math.tanh(this.v / 0.005)
      + P.c1 * this.v + P.c2 * Math.abs(this.v) * this.v;  // Eq. 5.2

    let vdot = (-Vx - 0.5 * Mx * this.v * this.v - Ma * this.alphaDot * this.v - Fd) / M;

    // no-slip feasibility (Eq. 5.3): F_t = κ m (v̇/δ − v δ̇/δ²), cap at μs·ΣN
    const etaDot = (tanA * this.v + this.x * sec2 * this.alphaDot) / a;
    const deltaDot = -eta * etaDot / delta;
    this.FtReq = kappa * m * (vdot / delta - this.v * deltaDot / d2);
    this.FtCap = P.mu_s * m * g * cosB / delta;
    this.slip = Math.abs(this.FtReq) > this.FtCap;
    if (this.slip) {
      const s = Math.sign(this.FtReq);
      vdot = s * this.FtCap * delta / (kappa * m) + this.v * deltaDot / delta;
    }

    this.vdot = vdot;
    this.v += vdot * dt;
    this.x += this.v * dt;

    this.omega = Math.abs(this.v) / (P.R * delta);
    this.spinAngle += (this.v / (P.R * delta)) * dt;
    this.N = m * g * cosB / (2 * delta);                   // Eq. 5.1
    this.Gamma = eta * tanA / delta - sinB;                // Eq. 4.1

    if (this.x <= P.x0 && this.v < 0) { this.x = P.x0; this.v = 0; }
    if (this.x >= P.L) return this.release('END OF RAILS');
  }

  release(cause) {
    this.cause = cause;
    this.mode = 'FLIGHT';
    this.flight = {
      x: this.x, y: P.a * this.delta, z: 0,
      vx: this.v, vy: 0,
      spin: this.omega,
    };
  }

  stepFlight(dt) {
    const f = this.flight;
    const cosB = Math.cos(P.beta), sinB = Math.sin(P.beta);
    f.vx += -P.g * sinB * dt;      // free flight, Eq. 8.2 (rail frame)
    f.vy += -P.g * cosB * dt;
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    f.spin *= Math.pow(0.5, dt / 0.8);
    this.spinAngle += f.spin * dt;

    if (this.mode === 'SINK') {
      if (f.y <= -P.dropH - 2.2 * P.R) this.finish(this.result.score, this.result.label);
      return;
    }

    const yRest = -P.dropH + P.R;
    if (f.vy < 0 && f.y <= yRest) {
      const h = P.holes.find(h => Math.abs(f.x - h.x) < h.cap);
      if (h) {
        this.mode = 'SINK';
        this.result = { score: h.score, label: h.label };
        f.x = h.x; f.vx = 0; // captured by the cup
        return;
      }
      if (f.x > P.boardLen - 0.06 || f.x < 0) return this.finish(0, 'TRAY');
      f.y = yRest;
      f.vy = -f.vy * 0.32;
      f.vx *= 0.55;
      if (Math.abs(f.vy) < 0.06) { f.vy = 0; this.finish(0, 'MISS'); }
    }
  }

  finish(score, label) {
    this.mode = 'DONE';
    this.attempts++;
    this.result = { score, label };
    if (score > this.best) this.best = score;
    this.log.unshift({
      n: this.attempts, score, label,
      cause: this.cause || '—',
      x: this.flight ? this.flight.x : this.x,
    });
    if (this.log.length > 6) this.log.pop();
  }
}
