// SPACEFORCE — telemetry HUD: readouts, admissibility guards (Eq. 5.4–5.7, 8.3),
// phase portrait with target capture corridor, release predictor strip.

import { P, pHit } from './physics.js';

const $ = (id) => document.getElementById(id);
const fmt = (v, d = 3) => (isFinite(v) ? v.toFixed(d) : '—');

export class Hud {
  constructor(sim) {
    this.sim = sim;
    this.lastBannerKey = '';
    this.phase = $('phase');
    this.strip = $('strip');
    this.pctx = this.phase.getContext('2d');
    this.sctx = this.strip.getContext('2d');
    this.setupCanvas(this.phase);
    this.setupCanvas(this.strip);
    this.buildTargets();
    this._acc = 0;
  }

  setupCanvas(c) {
    const dpr = Math.min(window.devicePixelRatio, 2);
    const r = c.getBoundingClientRect();
    c.width = r.width * dpr;
    c.height = r.height * dpr;
    c.getContext('2d').scale(dpr, dpr);
    c._w = r.width; c._h = r.height;
  }

  buildTargets() {
    const wrap = $('targets');
    P.holes.forEach((h, i) => {
      const b = document.createElement('button');
      b.className = 'chip' + (i === this.sim.targetIndex ? ' on' : '');
      b.textContent = h.score === 1000 ? '1K' : h.score;
      b.title = h.label;
      b.addEventListener('click', () => {
        this.sim.targetIndex = i;
        wrap.querySelectorAll('.chip').forEach(el => el.classList.remove('on'));
        b.classList.add('on');
      });
      wrap.appendChild(b);
    });
  }

  update(sim, dt) {
    this._acc += dt;
    if (this._acc < 1 / 30) return;
    this._acc = 0;

    const rolling = sim.mode === 'ROLL';
    const v = rolling ? sim.v : (sim.flight ? sim.flight.vx : 0);
    const x = rolling ? sim.x : (sim.flight ? sim.flight.x : sim.x);

    $('r-x').textContent = fmt(x * 1000, 1) + ' mm';
    $('r-v').textContent = fmt(v, 3) + ' m/s';
    $('r-eta').textContent = fmt(sim.eta, 4);
    $('r-delta').textContent = fmt(sim.delta, 4);
    $('r-alpha').textContent = fmt(sim.alpha * 180 / Math.PI, 2) + '°';
    $('r-omega').textContent = fmt(sim.omega * 60 / (2 * Math.PI), 0) + ' rpm';
    $('r-mass').textContent = fmt(1 + P.kappa / (sim.delta * sim.delta), 2) + ' ×m';
    $('r-gamma').textContent = (sim.Gamma >= 0 ? '+' : '') + fmt(sim.Gamma, 4);
    const ph = pHit(Math.abs(v), 2 * sim.selectedHole().cap);
    $('r-phit').textContent = fmt(ph * 100, 1) + ' %';
    $('r-phit').className = 'val ' + (ph > 0.8 ? 'ok' : ph > 0.5 ? 'warn' : 'bad');

    // guards
    this.bar('g-geom', (1 - sim.eta) / 0.45);
    this.bar('g-fold', (Math.pow(sim.delta, 3) - P.Lambda) / (1 - P.Lambda));
    this.bar('g-mu', 1 - Math.abs(sim.FtReq) / Math.max(sim.FtCap, 1e-9));
    this.bar('g-n', 1 - sim.N / (P.NmaxFactor * P.m * P.g));
    this.bar('g-omega', 1 - sim.omega / P.omegaMax);

    // mode chip
    const chip = $('mode');
    chip.textContent = sim.mode === 'ROLL'
      ? (sim.pulse ? 'M1 · PULSE' : sim.slip ? 'M2 · MICROSLIP' : sim.autopilot ? 'M1 · AUTOPILOT' : 'M1 · ROLLING')
      : sim.mode === 'FLIGHT' ? 'M4 · FREE FLIGHT'
      : sim.mode === 'SINK' ? 'M5 · CAPTURE'
      : 'STANDBY';
    chip.className = 'mode ' + (sim.mode === 'ROLL' ? (sim.slip ? 'warn' : 'ok') : 'hot');

    $('cause').textContent = sim.cause || '';

    // score panel
    $('score').textContent = sim.result ? sim.result.score : '—';
    $('best').textContent = sim.best;
    $('attempts').textContent = String(sim.attempts).padStart(2, '0');
    $('log').innerHTML = sim.log.map(l =>
      `<div class="logline"><span>#${String(l.n).padStart(2, '0')}</span>` +
      `<b class="${l.score > 0 ? 'ok' : 'bad'}">${l.score > 0 ? l.score + ' PTS' : l.label}</b>` +
      `<span>${l.cause.split('·')[0].trim()}</span></div>`
    ).join('');

    this.banner(sim);
    this.drawPhase(sim);
    this.drawStrip(sim);
  }

  bar(id, frac) {
    const el = $(id);
    const f = Math.min(Math.max(frac, 0), 1);
    el.style.width = (f * 100).toFixed(1) + '%';
    el.className = 'fill ' + (f < 0.18 ? 'bad' : f < 0.4 ? 'warn' : '');
  }

  banner(sim) {
    if (sim.mode === 'DONE' && sim.result) {
      const key = sim.attempts + ':' + sim.result.score;
      if (key !== this.lastBannerKey) {
        this.lastBannerKey = key;
        const el = $('banner');
        const s = sim.result.score;
        el.innerHTML = s > 0
          ? `<em>${s === 1000 ? '★ ' : ''}${s} PTS${s === 1000 ? ' ★' : ''}</em><span>${sim.result.label === 'SPACE FORCE' ? 'SPACE FORCE — MAXIMUM TARGET' : 'TARGET ' + sim.result.label + ' CAPTURED'}</span>`
          : `<em class="bad">NO SCORE</em><span>${sim.cause || sim.result.label}</span>`;
        el.classList.remove('show');
        void el.offsetWidth;
        el.classList.add('show');
      }
    }
  }

  // phase portrait: (x/L, v) trace, target bands, capture corridor into the
  // selected aperture, projected release marker
  drawPhase(sim) {
    const g = this.pctx, W = this.phase._w, H = this.phase._h;
    const XMAX = 1.18, VMAX = 0.62;
    const X = (x) => 34 + (x / P.L / XMAX) * (W - 42);
    const Y = (v) => H - 18 - (v / VMAX) * (H - 30);
    g.clearRect(0, 0, W, H);

    // frame
    g.strokeStyle = 'rgba(120,140,160,0.35)';
    g.lineWidth = 1;
    g.strokeRect(34, 8, W - 42, H - 26);

    // target bands
    P.holes.forEach((h, i) => {
      const sel = i === sim.targetIndex;
      g.fillStyle = sel ? 'rgba(255,180,84,0.20)' : 'rgba(255,180,84,0.07)';
      g.fillRect(X(h.x - h.cap), 8, X(h.x + h.cap) - X(h.x - h.cap), H - 26);
    });

    // capture corridor for selected target: release at (x, v) lands in window
    const h = sim.selectedHole();
    g.strokeStyle = 'rgba(79,216,207,0.8)';
    g.setLineDash([4, 4]);
    for (const off of [-h.cap, h.cap]) {
      g.beginPath();
      let started = false;
      for (let x = 0; x <= P.L; x += 0.004) {
        const v = (h.x + off - x) / P.tFall;
        if (v < 0 || v > VMAX) { started = false; continue; }
        if (!started) { g.moveTo(X(x), Y(v)); started = true; }
        else g.lineTo(X(x), Y(v));
      }
      g.stroke();
    }
    g.setLineDash([]);

    // projected release at current opening
    const xPred = sim.predictReleaseX();
    if (isFinite(xPred) && xPred < P.L * XMAX) {
      g.strokeStyle = 'rgba(255,180,84,0.65)';
      g.setLineDash([2, 5]);
      g.beginPath(); g.moveTo(X(xPred), 8); g.lineTo(X(xPred), H - 18); g.stroke();
      g.setLineDash([]);
    }

    // trace
    if (sim.trace.length > 1) {
      g.strokeStyle = 'rgba(79,216,207,0.95)';
      g.lineWidth = 1.6;
      g.beginPath();
      sim.trace.forEach(([x, v], i) => {
        const px = X(x), py = Y(Math.max(v, 0));
        if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
      });
      g.stroke();
    }

    // current point
    const cx = sim.mode === 'ROLL' ? sim.x : (sim.flight ? sim.flight.x : sim.x);
    const cv = sim.mode === 'ROLL' ? sim.v : (sim.flight ? sim.flight.vx : 0);
    g.fillStyle = '#ffb454';
    g.beginPath(); g.arc(X(cx), Y(Math.max(cv, 0)), 3.2, 0, Math.PI * 2); g.fill();

    // labels
    g.fillStyle = 'rgba(120,140,160,0.8)';
    g.font = '9px "IBM Plex Mono", monospace';
    g.fillText('v [m/s]', 4, 14);
    g.fillText('0', 24, H - 14);
    g.fillText('x/L', W - 26, H - 4);
    g.fillText('1', X(P.L) - 2, H - 4);
  }

  // release predictor: η(x) at current α, fold line η*, ball marker
  drawStrip(sim) {
    const g = this.sctx, W = this.strip._w, H = this.strip._h;
    const X = (x) => 34 + (x / P.L) * (W - 42);
    const Y = (eta) => H - 14 - ((eta - 0.2) / 0.85) * (H - 24);
    g.clearRect(0, 0, W, H);

    g.strokeStyle = 'rgba(120,140,160,0.35)';
    g.strokeRect(34, 6, W - 42, H - 20);

    // fold + geometric limits
    g.strokeStyle = 'rgba(255,79,94,0.8)';
    g.setLineDash([4, 3]);
    g.beginPath(); g.moveTo(34, Y(P.etaFold)); g.lineTo(W - 8, Y(P.etaFold)); g.stroke();
    g.setLineDash([]);
    g.fillStyle = 'rgba(255,79,94,0.10)';
    g.fillRect(34, 6, W - 42, Y(P.etaFold) - 6);

    // η(x) with compliance at current α
    g.strokeStyle = '#ffb454';
    g.lineWidth = 1.6;
    g.beginPath();
    let started = false;
    for (let x = 0; x <= P.L; x += P.L / 90) {
      const sol = sim.solveEta(sim.etaCmd(x, sim.alpha));
      const y = Y(Math.min(sol.eta, 1.04));
      if (!started) { g.moveTo(X(x), y); started = true; } else g.lineTo(X(x), y);
      if (sol.fold) break;
    }
    g.stroke();

    // ball marker
    g.fillStyle = '#4fd8cf';
    g.beginPath(); g.arc(X(Math.min(sim.x, P.L)), Y(Math.min(sim.eta, 1.04)), 3, 0, Math.PI * 2); g.fill();

    g.fillStyle = 'rgba(120,140,160,0.8)';
    g.font = '9px "IBM Plex Mono", monospace';
    g.fillText('η(x)', 4, 14);
    g.fillStyle = 'rgba(255,79,94,0.9)';
    g.fillText('fold η*', W - 52, Y(P.etaFold) - 3);
  }
}
