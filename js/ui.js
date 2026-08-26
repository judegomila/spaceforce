import { clamp } from './physics.js';
import { drawRiskGrid, riskMapToWorld } from './pathfinding.js';

const $ = (id) => document.getElementById(id);
const PLAYER_COLORS = ['#72f1c8', '#ff9f5a', '#e780ff', '#ffe074'];

function formatNumber(x, digits = 3) {
  if (!Number.isFinite(x)) return '∞';
  const ax = Math.abs(x);
  if (ax > 999) return x.toExponential(2);
  return x.toFixed(digits);
}

function guardColor(value, inverse = false) {
  const risk = inverse ? 1 - clamp(value, 0, 1) : value;
  if (risk < 0.55) return '#72f1c8';
  if (risk < 0.85) return '#f2c75c';
  if (risk < 1.0) return '#ff9a57';
  return '#ff5f5b';
}

function setGuard(fill, output, value, label = null, inverse = false) {
  const normalized = inverse ? clamp(value, 0, 1) : clamp(value / 1.5, 0, 1);
  fill.style.width = `${normalized * 100}%`;
  fill.style.background = guardColor(value, inverse);
  output.textContent = label ?? formatNumber(value, 2);
}

export class UI {
  constructor(app) {
    this.app = app;
    this.els = {
      loading: $('loading'),
      statusMode: $('status-mode'), statusPhase: $('status-phase'), statusNote: $('status-note'),
      time: $('m-time'), stones: $('m-stones'), joints: $('m-joints'), util: $('m-util'),
      handUtil: $('m-hand-util'), gap: $('m-gap'), boundary: $('m-boundary'), potential: $('m-potential'),
      kinetic: $('m-kinetic'), angle: $('m-angle'),
      gBoard: $('g-board'), gvBoard: $('gv-board'), gHand: $('g-hand'), gvHand: $('gv-hand'),
      gForce: $('g-force'), gvForce: $('gv-force'), gTorque: $('g-torque'), gvTorque: $('gv-torque'),
      gTip: $('g-tip'), gvTip: $('gv-tip'), gClear: $('g-clear'), gvClear: $('gv-clear'),
      trace: $('trace'), risk: $('risk-map'), log: $('event-log'),
      activePlayer: $('active-player'), turnNumber: $('turn-number'), turnPhase: $('turn-phase'),
      inventories: $('inventories'), modeLabel: $('mode-label'), gameBox: $('game-box'),
      players: $('players-select'), preset: $('preset'), release: $('release'), posture: $('posture'), pause: $('pause'),
      routeRun: $('route-run'), banner: $('banner'),
      magnet: $('magnet'), friction: $('friction'), damping: $('damping'), timeScale: $('time-scale'),
      cordX: $('cord-x'), cordY: $('cord-y'), pinch: $('pinch'), cordRotation: $('cord-rotation'),
      vMagnet: $('v-magnet'), vFriction: $('v-friction'), vDamping: $('v-damping'), vTimeScale: $('v-time-scale'),
      vCordX: $('v-cord-x'), vCordY: $('v-cord-y'), vPinch: $('v-pinch'), vCordRotation: $('v-cord-rotation'),
      science: $('science-modal'), importFile: $('import-file'),
    };
    this.traceCtx = this.els.trace.getContext('2d');
    this.riskCtx = this.els.risk.getContext('2d');
    this.bannerTimer = null;
    this.bind();
  }

  bind() {
    document.querySelectorAll('#mode-tabs button').forEach((button) => {
      button.addEventListener('click', () => this.app.setMode(button.dataset.mode));
    });
    $('new-game').addEventListener('click', () => this.app.newGame(Number(this.els.players.value)));
    this.els.players.addEventListener('change', () => {
      if (this.app.mode === 'game') this.app.newGame(Number(this.els.players.value));
    });
    this.els.preset.addEventListener('change', () => this.app.loadPreset(this.els.preset.value));
    this.els.release.addEventListener('click', () => this.app.releaseHand());
    $('rotate-left').addEventListener('click', () => this.app.rotateHand(-Math.PI / 12));
    $('rotate-right').addEventListener('click', () => this.app.rotateHand(Math.PI / 12));
    this.els.posture.addEventListener('click', () => this.app.togglePosture());
    this.els.pause.addEventListener('click', () => this.app.togglePause());
    $('reset').addEventListener('click', () => this.app.resetCurrent());
    $('route-safe').addEventListener('click', () => this.app.planCandidate('safe'));
    $('route-trap').addEventListener('click', () => this.app.planCandidate('trap'));
    this.els.routeRun.addEventListener('click', () => this.app.toggleRouteRun());
    $('route-clear').addEventListener('click', () => this.app.clearRoute());

    const bindRange = (el, callback) => el.addEventListener('input', () => callback(Number(el.value)));
    bindRange(this.els.magnet, (value) => this.app.setPhysics({ magneticStrength: value }));
    bindRange(this.els.friction, (value) => this.app.setPhysics({ muStatic: value, muKinetic: value * 0.71 }));
    bindRange(this.els.damping, (value) => this.app.setPhysics({ linearDamping: value, angularDamping: value * 1.35 }));
    bindRange(this.els.timeScale, (value) => { this.app.timeScale = value; });
    bindRange(this.els.cordX, (value) => this.app.setCord({ rx: value }));
    bindRange(this.els.cordY, (value) => this.app.setCord({ ry: value }));
    bindRange(this.els.pinch, (value) => this.app.setCord({ pinch: value }));
    bindRange(this.els.cordRotation, (value) => this.app.setCord({ rotation: value * Math.PI / 180 }));

    $('show-field').addEventListener('change', (event) => { this.app.renderer.showField = event.target.checked; });
    $('show-forces').addEventListener('change', (event) => { this.app.renderer.showForces = event.target.checked; });
    $('show-labels').addEventListener('change', (event) => { this.app.renderer.showLabels = event.target.checked; });
    $('show-risk').addEventListener('change', (event) => { this.app.renderer.showRiskHalos = event.target.checked; });

    $('export-state').addEventListener('click', () => this.app.exportState());
    $('import-state').addEventListener('click', () => this.els.importFile.click());
    this.els.importFile.addEventListener('change', (event) => {
      const file = event.target.files?.[0];
      if (file) this.app.importState(file);
      event.target.value = '';
    });

    $('science-open').addEventListener('click', () => this.els.science.showModal());
    this.els.risk.addEventListener('pointerdown', (event) => {
      if (!this.app.riskGrid || !this.app.hand?.active) return;
      const goal = riskMapToWorld(this.app.riskGrid, this.els.risk, event.clientX, event.clientY);
      this.app.planTo(goal);
    });
  }

  ready() {
    requestAnimationFrame(() => this.els.loading.classList.add('hidden'));
  }

  syncControls() {
    const { params, cord } = this.app.world;
    const assign = (el, value) => { el.value = String(value); };
    assign(this.els.magnet, params.magneticStrength);
    assign(this.els.friction, params.muStatic);
    assign(this.els.damping, params.linearDamping);
    assign(this.els.timeScale, this.app.timeScale);
    assign(this.els.cordX, cord.rx);
    assign(this.els.cordY, cord.ry);
    assign(this.els.pinch, cord.pinch);
    assign(this.els.cordRotation, cord.rotation * 180 / Math.PI);
    this.els.vMagnet.textContent = params.magneticStrength.toFixed(3);
    this.els.vFriction.textContent = params.muStatic.toFixed(2);
    this.els.vDamping.textContent = params.linearDamping.toFixed(2);
    this.els.vTimeScale.textContent = `${this.app.timeScale.toFixed(2)}×`;
    this.els.vCordX.textContent = cord.rx.toFixed(2);
    this.els.vCordY.textContent = cord.ry.toFixed(2);
    this.els.vPinch.textContent = cord.pinch.toFixed(2);
    this.els.vCordRotation.textContent = `${Math.round(cord.rotation * 180 / Math.PI)}°`;
  }

  update() {
    const { app } = this;
    const { world } = app;
    const handEval = app.handEval ?? {};
    const handForce = handEval.force ? Math.hypot(handEval.force.x, handEval.force.y) : 0;
    const minClearance = Math.min(handEval.minGap ?? Infinity, handEval.boundaryMargin ?? Infinity);

    this.els.time.textContent = world.time.toFixed(3);
    this.els.stones.textContent = String(world.activeStones().length).padStart(2, '0');
    this.els.joints.textContent = String(world.joints.size).padStart(2, '0');
    this.els.util.textContent = formatNumber(world.maxUtilization, 3);
    this.els.handUtil.textContent = formatNumber(handEval.utilization ?? 0, 3);
    this.els.gap.textContent = formatNumber(world.minGap, 3);
    this.els.boundary.textContent = formatNumber(world.minBoundaryMargin, 3);
    this.els.potential.textContent = formatNumber(world.totalPotential, 3);
    this.els.kinetic.textContent = formatNumber(world.totalKinetic, 4);
    this.els.angle.textContent = `${(app.hand.angle * 180 / Math.PI).toFixed(1)}°`;
    this.els.util.classList.toggle('hot', world.maxUtilization >= 1);
    this.els.handUtil.classList.toggle('hot', (handEval.utilization ?? 0) >= 1);

    setGuard(this.els.gBoard, this.els.gvBoard, world.maxUtilization);
    setGuard(this.els.gHand, this.els.gvHand, handEval.utilization ?? 0);
    setGuard(this.els.gForce, this.els.gvForce, handEval.forceUtilization ?? handForce);
    setGuard(this.els.gTorque, this.els.gvTorque, handEval.torqueUtilization ?? 0);
    setGuard(this.els.gTip, this.els.gvTip, handEval.tip ?? 0);
    const clearanceScale = clamp((minClearance + 0.06) / 0.9, 0, 1);
    setGuard(this.els.gClear, this.els.gvClear, clearanceScale, formatNumber(minClearance, 2), true);

    this.updateStatus();
    this.updateGame();
    this.updateButtons();
    this.drawTrace();
    this.drawRisk();
    this.syncControls();
  }

  updateStatus() {
    const { app } = this;
    const util = Math.max(app.world.maxUtilization, app.handEval?.utilization ?? 0);
    let label = 'PINNED', klass = 'safe';
    if (app.phase === 'failure') { label = 'CASCADE'; klass = 'danger'; }
    else if (!app.running) { label = 'PAUSED'; klass = 'warn'; }
    else if (app.world.totalKinetic > 0.004) { label = 'DYNAMIC'; klass = util >= 1 ? 'danger' : 'warn'; }
    else if (util >= 1) { label = 'THRESHOLD'; klass = 'danger'; }
    else if (util >= 0.78) { label = 'NEAR-CRITICAL'; klass = 'warn'; }
    this.els.statusMode.textContent = label;
    this.els.statusMode.className = `status-chip ${klass}`;
    this.els.statusPhase.textContent = `${app.mode.toUpperCase()} · ${app.phase.toUpperCase()}`;
    this.els.statusNote.textContent = app.statusNote;
  }

  updateGame() {
    const { app } = this;
    document.querySelectorAll('#mode-tabs button').forEach((button) => button.classList.toggle('active', button.dataset.mode === app.mode));
    this.els.modeLabel.textContent = `${app.mode.toUpperCase()} MODE`;
    this.els.gameBox.style.opacity = app.mode === 'game' ? '1' : '.56';
    this.els.activePlayer.textContent = app.mode === 'game' ? `P${app.currentPlayer + 1}` : 'LAB';
    this.els.activePlayer.style.color = PLAYER_COLORS[app.currentPlayer % PLAYER_COLORS.length];
    this.els.turnNumber.textContent = String(app.turnNumber).padStart(2, '0');
    this.els.turnPhase.textContent = app.phase.slice(0, 5).toUpperCase();
    this.els.inventories.replaceChildren();
    const inventories = app.mode === 'game' ? app.inventories : [24 - app.world.activeStones().length];
    inventories.forEach((count, i) => {
      const item = document.createElement('div');
      item.className = `inventory ${i === app.currentPlayer ? 'active' : ''}`;
      item.style.setProperty('--player', PLAYER_COLORS[i % PLAYER_COLORS.length]);
      item.innerHTML = `<span>${app.mode === 'game' ? `PLAYER ${i + 1}` : 'LAB SUPPLY'}</span><b>${Math.max(0, count)}</b>`;
      this.els.inventories.append(item);
    });
    this.els.inventories.style.gridTemplateColumns = `repeat(${Math.min(4, inventories.length)},1fr)`;
  }

  updateButtons() {
    const canRelease = this.app.hand?.active && this.app.phase === 'aiming';
    this.els.release.disabled = !canRelease;
    this.els.release.classList.toggle('danger', canRelease && !this.app.handLegal);
    this.els.release.textContent = this.app.handLegal ? 'RELEASE  SPACE' : 'ILLEGAL  SPACE';
    this.els.posture.innerHTML = `POSTURE: <b>${this.app.hand.posture.toUpperCase()}</b> <kbd>P</kbd>`;
    this.els.pause.textContent = this.app.running ? 'PAUSE  T' : 'RUN  T';
    this.els.routeRun.textContent = this.app.routeRunning ? 'STOP ROUTE' : 'RUN ROUTE  V';
    this.els.routeRun.disabled = !this.app.route?.length && !this.app.routeRunning;
  }

  setLogs(logs) {
    this.els.log.replaceChildren();
    for (const event of logs.slice(-18).reverse()) {
      const row = document.createElement('div');
      row.className = `log-row ${event.kind ?? ''}`;
      row.innerHTML = `<time>${event.time.toFixed(2)}</time><b>${event.label}</b><span>${event.detail}</span>`;
      this.els.log.append(row);
    }
  }

  drawRisk() {
    if (!this.app.riskGrid) {
      const ctx = this.riskCtx;
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.fillStyle = '#061017'; ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
      ctx.fillStyle = '#56756f'; ctx.font = '18px monospace'; ctx.textAlign = 'center';
      ctx.fillText('RISK FIELD INITIALIZING', ctx.canvas.width / 2, ctx.canvas.height / 2);
      return;
    }
    drawRiskGrid(this.riskCtx, this.app.riskGrid, { route: this.app.route, goal: this.app.goal });
  }

  drawTrace() {
    const canvas = this.els.trace;
    const ctx = this.traceCtx;
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#040b10'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(130,205,194,.10)'; ctx.lineWidth = 1;
    for (let i = 1; i < 4; i += 1) { const y = i * h / 4; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    const history = this.app.history;
    if (history.length < 2) return;
    const draw = (key, color, transform) => {
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.beginPath();
      history.forEach((sample, i) => {
        const x = i / Math.max(1, history.length - 1) * w;
        const y = h - clamp(transform(sample[key]), 0, 1) * h;
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      });
      ctx.stroke();
    };
    draw('util', '#72f1c8', (v) => v / 1.5);
    draw('hand', '#f2c75c', (v) => v / 1.5);
    draw('kinetic', '#ff756a', (v) => Math.log10(1 + v * 80) / Math.log10(81));
    ctx.fillStyle = 'rgba(255,255,255,.42)'; ctx.font = '15px monospace'; ctx.textAlign = 'left';
    ctx.fillText('χ board', 10, 18); ctx.fillStyle = '#f2c75c'; ctx.fillText('χ hand', 95, 18); ctx.fillStyle = '#ff756a'; ctx.fillText('K', 175, 18);
  }

  showBanner(title, detail = '', kind = 'safe', duration = 1700) {
    clearTimeout(this.bannerTimer);
    this.els.banner.className = `${kind} show`;
    this.els.banner.innerHTML = `${title}${detail ? `<small>${detail}</small>` : ''}`;
    this.bannerTimer = setTimeout(() => this.els.banner.classList.remove('show'), duration);
  }
}
