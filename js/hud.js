// SPACEFORCE — telemetry, guards, phase portrait and release predictor.

import { P, pHit } from './physics.js';

const $ = (id) => document.getElementById(id);
const fmt = (v, d = 3) => (isFinite(v) ? v.toFixed(d) : '—');
const deg = (v) => v * 180 / Math.PI;
const rpm = (v) => v * 60 / (2 * Math.PI);

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
    window.addEventListener('resize', () => {
      this.setupCanvas(this.phase);
      this.setupCanvas(this.strip);
    });
  }

  setupCanvas(c) {
    const dpr = Math.min(window.devicePixelRatio, 2);
    const r = c.getBoundingClientRect();
    if (!r.width || !r.height) return;
    c.width = Math.round(r.width * dpr);
    c.height = Math.round(r.height * dpr);
    c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    c._w = r.width;
    c._h = r.height;
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
    const zNow = rolling ? sim.z + sim.zRel : (sim.flight ? sim.flight.z : sim.z + sim.zRel);

    $('r-x').textContent = fmt(x * 1000, 1) + ' mm';
    $('r-v').textContent = fmt(v, 3) + ' m/s';
    $('r-eta').textContent = fmt(sim.eta, 4);
    $('r-delta').textContent = fmt(sim.delta, 4);
    $('r-alpha').textContent = fmt(deg(sim.alpha), 2) + '°';
    $('r-z').textContent = (zNow >= 0 ? '+' : '') + fmt(zNow * 1000, 1) + ' mm';
    $('r-omega').textContent = fmt(rpm(sim.omega), 0) + ' rpm';
    $('r-omega-x').textContent = (sim.omegaX >= 0 ? '+' : '') + fmt(rpm(sim.omegaX), 0) + ' rpm';
    $('r-phi-m').textContent = (sim.phiMinus >= 0 ? '+' : '') + fmt(deg(sim.phiMinus), 2) + '°';
    $('r-phi-p').textContent = (sim.phiPlus >= 0 ? '+' : '') + fmt(deg(sim.phiPlus), 2) + '°';
    $('r-phi-c').textContent = (sim.phiC >= 0 ? '+' : '') + fmt(deg(sim.phiC), 2) + '°';
    $('r-phi-d').textContent = (sim.phiDelta >= 0 ? '+' : '') + fmt(deg(sim.phiDelta), 2) + '°';
    $('r-mass').textContent = fmt(1 + P.kappa / (sim.delta * sim.delta), 2) + ' ×m';
    $('r-gamma').textContent = (sim.Gamma >= 0 ? '+' : '') + fmt(sim.Gamma, 4);

    const ph = pHit(Math.abs(v), 2 * sim.selectedHole().cap);
    $('r-phit').textContent = fmt(ph * 100, 1) + ' %';
    $('r-phit').className = 'val ' + (ph > 0.8 ? 'ok' : ph > 0.5 ? 'warn' : 'bad');

    $('phi-c-v').textContent = (sim.phiC >= 0 ? '+' : '') + fmt(deg(sim.phiC), 2) + '°';
    $('phi-d-v').textContent = (sim.phiDelta >= 0 ? '+' : '') + fmt(deg(sim.phiDelta), 2) + '°';
    $('slip-v').textContent = fmt(sim.sDelta * 1000, 3) + ' mm/s';
    $('slip-v').className = sim.twistSlip ? 'bad' : '';

    // Admissibility guards.
    this.bar('g-geom', (1 - sim.eta) / 0.45);
    this.bar('g-fold', (Math.pow(sim.delta, 3) - P.Lambda) / (1 - P.Lambda));
    this.bar('g-mu', 1 - Math.abs(sim.FtReq) / Math.max(sim.FtCap, 1e-9));
    this.bar('g-phi', 1 - Math.max(Math.abs(sim.phiMinus), Math.abs(sim.phiPlus)) / P.phiMax);
    this.bar('g-twist', 1 - Math.abs(sim.sDelta) / P.twistSlipScale);
    this.bar('g-n', 1 - sim.N / (P.NmaxFactor * P.m * P.g));
    this.bar('g-omega', Math.min(
      1 - sim.omega / P.omegaMax,
      1 - Math.abs(sim.omegaX) / P.omegaXMax
    ));

    // Hybrid mode chip.
    const chip = $('mode');
    const twistMoving = Math.abs(sim.phiMinusDot) + Math.abs(sim.phiPlusDot) > 0.02;
    if (sim.mode === 'ROLL') {
      if (sim.pulse?.twistMode && sim.pulse.twistMode !== 'none') chip.textContent = 'M1 · COMPOUND PULSE';
      else if (sim.pulse) chip.textContent = 'M1 · OPEN PULSE';
      else if (sim.slip || sim.twistSlip) chip.textContent = 'M2 · MICROSLIP';
      else if (twistMoving) chip.textContent = 'M1 · ROD TWIST';
      else if (sim.autopilot) chip.textContent = 'M1 · AUTOPILOT';
      else chip.textContent = 'M1 · ROLLING';
    } else if (sim.mode === 'FLIGHT') chip.textContent = 'M4 · FREE FLIGHT';
    else if (sim.mode === 'BOARD') chip.textContent = 'M5 · DECK ROLL';
    else if (sim.mode === 'SINK') chip.textContent = 'M5 · CAPTURE';
    else chip.textContent = 'STANDBY';
    chip.className = 'mode ' + (sim.mode === 'ROLL'
      ? ((sim.slip || sim.twistSlip) ? 'warn' : 'ok')
      : 'hot');

    $('cause').textContent = sim.cause || '';
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
    if (sim.mode !== 'DONE' || !sim.result) return;
    const key = sim.attempts + ':' + sim.result.score;
    if (key === this.lastBannerKey) return;
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

  drawPhase(sim) {
    const g = this.pctx, W = this.phase._w, H = this.phase._h;
    if (!W || !H) return;
    const XMAX = 1.18, VMAX = 0.62;
    const X = (x) => 34 + (x / P.L / XMAX) * (W - 42);
    const Y = (v) => H - 18 - (v / VMAX) * (H - 30);
    g.clearRect(0, 0, W, H);

    g.strokeStyle = 'rgba(120,140,160,0.35)';
    g.lineWidth = 1;
    g.strokeRect(34, 8, W - 42, H - 26);

    P.holes.forEach((h, i) => {
      const sel = i === sim.targetIndex;
      g.fillStyle = sel ? 'rgba(255,180,84,0.20)' : 'rgba(255,180,84,0.07)';
      g.fillRect(X(h.x - h.cap), 8, X(h.x + h.cap) - X(h.x - h.cap), H - 26);
    });

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

    const xPred = sim.predictReleaseX();
    if (isFinite(xPred) && xPred < P.L * XMAX) {
      g.strokeStyle = 'rgba(255,180,84,0.65)';
      g.setLineDash([2, 5]);
      g.beginPath(); g.moveTo(X(xPred), 8); g.lineTo(X(xPred), H - 18); g.stroke();
      g.setLineDash([]);
    }

    if (sim.trace.length > 1) {
      g.strokeStyle = 'rgba(79,216,207,0.95)';
      g.lineWidth = 1.6;
      g.beginPath();
      sim.trace.forEach(([tx, tv], i) => {
        const px = X(tx), py = Y(Math.max(tv, 0));
        if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
      });
      g.stroke();
    }

    const cx = sim.mode === 'ROLL' ? sim.x : (sim.flight ? sim.flight.x : sim.x);
    const cv = sim.mode === 'ROLL' ? sim.v : (sim.flight ? sim.flight.vx : 0);
    g.fillStyle = '#ffb454';
    g.beginPath(); g.arc(X(cx), Y(Math.max(cv, 0)), 3.2, 0, Math.PI * 2); g.fill();

    g.fillStyle = 'rgba(120,140,160,0.8)';
    g.font = '9px "IBM Plex Mono", monospace';
    g.fillText('v [m/s]', 4, 14);
    g.fillText('0', 24, H - 14);
    g.fillText('x/L', W - 26, H - 4);
    g.fillText('1', X(P.L) - 2, H - 4);
  }

  drawStrip(sim) {
    const g = this.sctx, W = this.strip._w, H = this.strip._h;
    if (!W || !H) return;
    const X = (x) => 34 + (x / P.L) * (W - 42);
    const Y = (eta) => H - 14 - ((eta - 0.2) / 0.85) * (H - 24);
    g.clearRect(0, 0, W, H);

    g.strokeStyle = 'rgba(120,140,160,0.35)';
    g.strokeRect(34, 6, W - 42, H - 20);

    g.strokeStyle = 'rgba(255,79,94,0.8)';
    g.setLineDash([4, 3]);
    g.beginPath(); g.moveTo(34, Y(P.etaFold)); g.lineTo(W - 8, Y(P.etaFold)); g.stroke();
    g.setLineDash([]);
    g.fillStyle = 'rgba(255,79,94,0.10)';
    g.fillRect(34, 6, W - 42, Y(P.etaFold) - 6);

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

    g.fillStyle = '#4fd8cf';
    g.beginPath(); g.arc(X(Math.min(sim.x, P.L)), Y(Math.min(sim.eta, 1.04)), 3, 0, Math.PI * 2); g.fill();

    g.fillStyle = 'rgba(120,140,160,0.8)';
    g.font = '9px "IBM Plex Mono", monospace';
    g.fillText('η(x)', 4, 14);
    g.fillStyle = 'rgba(255,79,94,0.9)';
    g.fillText('fold η*', W - 52, Y(P.etaFold) - 3);
  }
}
