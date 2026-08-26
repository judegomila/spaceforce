import {
  KlusterWorld, clamp, distance, len, pointInPolygon,
  signedBoundaryMargin, sub, unit, add, mul, wrapAngle
} from './physics.js';
import { CanvasRenderer } from './renderer.js';
import { UI } from './ui.js';
import { getPreset } from './presets.js';
import { chooseCandidate, computeRiskGrid, findRiskAwarePath, gridPoint } from './pathfinding.js';

export const PHASE_NOTES = {
  aiming: 'Move the held stone through the field. Release with Space.',
  settling: 'The stone is released; the board must settle without a capture or boundary exit.',
  failure: 'A rule event occurred. The affected connected component is being resolved.',
  won: 'The active player emptied their inventory with a stable placement.',
};

export const EVENT_LABELS = {
  capture: ['CAPTURE', 'magnetic contact graph gained an edge', 'capture'],
  contact: ['CONTACT', 'collision without persistent magnetic capture', ''],
  handCapture: ['HAND JOIN', 'held magnet joined an existing stone', 'failure'],
  handContact: ['HAND CONTACT', 'held stone reached the contact surface', 'failure'],
  tip: ['TIP', 'support-moment threshold crossed', 'tip'],
  land: ['LAND', 'edge-supported stone returned to the table', ''],
  boundaryExit: ['EXIT', 'stone footprint left the cord region', 'failure'],
  boundaryReentry: ['REENTRY', 'stone returned inside the cord', ''],
};

function deepClone(value) {
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function isTypingTarget(target) {
  return target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
}

export class KlusterAppBase {
  constructor() {
    this.canvas = document.getElementById('sim');
    this.world = new KlusterWorld();
    this.renderer = new CanvasRenderer(this.canvas);
    this.mode = 'lab';
    this.running = true;
    this.timeScale = 1;
    this.players = 2;
    this.inventories = [12, 12];
    this.currentPlayer = 0;
    this.turnNumber = 1;
    this.phase = 'aiming';
    this.statusNote = PHASE_NOTES.aiming;
    this.currentPreset = 'midgame';
    this.hand = this.makeHand();
    this.handTarget = { ...this.hand.pos };
    this.handEval = this.world.evaluateHand(this.hand);
    this.handLegal = false;
    this.route = [];
    this.goal = null;
    this.routeIndex = 0;
    this.routeRunning = false;
    this.trail = [];
    this.riskGrid = null;
    this.riskDirty = true;
    this.lastRiskAt = -Infinity;
    this.history = [];
    this.logs = [];
    this.keys = new Set();
    this.pointerControlling = false;
    this.accumulator = 0;
    this.lastFrame = performance.now();
    this.lastUiAt = 0;
    this.lastHistoryAt = 0;
    this.failureStartedAt = 0;
    this.failureSeeds = new Set();
    this.releaseTime = 0;
    this.settleAccum = 0;
    this.placedStoneId = null;
    this.bannerEventIds = new Set();
    this.ui = new UI(this);
    this.bindInput();
    this.loadPreset('midgame');
    this.ui.ready();
    window.klusterLab = this;
    requestAnimationFrame((time) => this.frame(time));
  }

  makeHand(patch = {}) {
    return {
      id: 'hand', active: true, player: this.currentPlayer,
      pos: { x: -5.0, y: -3.6 }, angle: 0.2, posture: 'flat',
      moment: 1, mass: 1, collisionRadius: 0.27, footprintRadius: 0.42,
      length: 0.76, width: 0.31,
      ...deepClone(patch),
    };
  }

  bindInput() {
    this.canvas.addEventListener('pointermove', (event) => {
      if (!this.hand.active || this.phase !== 'aiming') return;
      this.pointerControlling = true;
      this.routeRunning = false;
      this.handTarget = this.renderer.screenToWorld(event.clientX, event.clientY);
    });
    this.canvas.addEventListener('pointerdown', (event) => {
      if (!this.hand.active || this.phase !== 'aiming') return;
      this.pointerControlling = true;
      this.routeRunning = false;
      this.handTarget = this.renderer.screenToWorld(event.clientX, event.clientY);
      this.canvas.setPointerCapture?.(event.pointerId);
    });
    this.canvas.addEventListener('wheel', (event) => {
      if (!this.hand.active) return;
      event.preventDefault();
      this.rotateHand(Math.sign(event.deltaY) * Math.PI / 36);
    }, { passive: false });

    window.addEventListener('keydown', (event) => {
      if (isTypingTarget(event.target)) return;
      const key = event.key.toLowerCase();
      if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' ', 'w', 'a', 's', 'd'].includes(key)) event.preventDefault();
      if (event.repeat && [' ', 'q', 'e', 'p', 't', 'r', 'g', 'h'].includes(key)) return;
      if (key === ' ') this.releaseHand();
      else if (key === 'q') this.rotateHand(-Math.PI / 18);
      else if (key === 'e') this.rotateHand(Math.PI / 18);
      else if (key === 'p') this.togglePosture();
      else if (key === 't') this.togglePause();
      else if (key === 'r') this.resetCurrent();
      else if (key === 'g') this.planCandidate('safe');
      else if (key === 'h') this.planCandidate('trap');
      else if (key === 'v' && !event.metaKey && !event.ctrlKey) this.toggleRouteRun();
      else if (key === 'escape') this.clearRoute();
      this.keys.add(key);
    });
    window.addEventListener('keyup', (event) => this.keys.delete(event.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  loadPreset(name) {
    const preset = deepClone(getPreset(name));
    this.currentPreset = name;
    this.world = new KlusterWorld({ params: preset.params ?? {}, cord: preset.cord ?? {} });
    for (const stone of preset.stones ?? []) this.world.addStone(stone);
    this.mode = preset.mode ?? 'lab';
    this.players = Number(this.ui?.els.players.value ?? this.players);
    this.inventories = Array.from({ length: this.players }, () => 24 / this.players);
    this.currentPlayer = 0;
    this.turnNumber = 1;
    this.world.turnId = 1;
    this.phase = 'aiming';
    this.statusNote = preset.description ?? PHASE_NOTES.aiming;
    this.hand = this.makeHand({ ...(preset.hand ?? {}), player: this.currentPlayer });
    this.handTarget = { ...this.hand.pos };
    this.placedStoneId = null;
    this.failureSeeds.clear();
    this.route = preset.autoApproach ? [{ ...this.hand.pos }, { ...preset.autoApproach.target }] : [];
    this.goal = preset.autoApproach ? { ...preset.autoApproach.target } : null;
    this.routeIndex = 0;
    this.routeRunning = false;
    this.trail = [];
    this.history = [];
    this.logs = [];
    this.riskGrid = null;
    this.riskDirty = true;
    this.accumulator = 0;
    this.addLog('PRESET', preset.name, 'success');
    if (preset.autoApproach) this.addLog('ROUTE', 'Demonstration approach armed; press A to run.', '');
    this.refreshEvaluation();
    this.computeRisk(true);
    this.ui?.setLogs(this.logs);
    this.ui?.syncControls();
  }

  newGame(players = 2) {
    this.players = clamp(Math.round(players), 1, 4);
    this.mode = 'game';
    const params = { ...this.world.params };
    const cord = deepClone(this.world.cord);
    this.world = new KlusterWorld({ params, cord });
    this.inventories = Array.from({ length: this.players }, () => 24 / this.players);
    this.currentPlayer = 0;
    this.turnNumber = 1;
    this.world.turnId = 1;
    this.phase = 'aiming';
    this.statusNote = 'Player 1 begins. The held stone perturbs the board before release.';
    this.currentPreset = 'empty';
    this.placedStoneId = null;
    this.failureSeeds.clear();
    this.history = [];
    this.logs = [];
    this.clearRoute();
    this.spawnHand();
    this.addLog('NEW GAME', `${this.players} player${this.players === 1 ? '' : 's'} · ${24 / this.players} stones each`, 'success');
    this.computeRisk(true);
    this.ui.setLogs(this.logs);
    this.ui.showBanner('NEW GAME', `${this.players} players · P1 to move`, 'safe', 1400);
  }

  setMode(mode) {
    if (mode === this.mode) return;
    if (mode === 'game') {
      this.newGame(Number(this.ui.els.players.value));
      return;
    }
    this.mode = 'lab';
    this.phase = 'aiming';
    this.currentPlayer = 0;
    this.statusNote = 'Laboratory mode: events remain on the board so cascades can be inspected.';
    if (!this.hand.active) this.spawnHand();
    this.addLog('MODE', 'Laboratory mode enabled', 'success');
    this.ui.setLogs(this.logs);
  }

  resetCurrent() {
    if (this.mode === 'game') this.newGame(this.players);
    else this.loadPreset(this.currentPreset);
  }

  spawnHand(patch = {}) {
    const side = this.turnNumber % 2 ? -1 : 1;
    const start = { x: side * (this.world.cord.rx + 0.82), y: -this.world.cord.ry - 0.52 };
    this.hand = this.makeHand({ pos: start, angle: side < 0 ? 0.18 : Math.PI - 0.18, posture: 'flat', player: this.currentPlayer, ...patch });
    this.handTarget = { ...this.hand.pos };
    this.phase = 'aiming';
    this.statusNote = PHASE_NOTES.aiming;
    this.placedStoneId = null;
    this.failureSeeds.clear();
    this.trail = [];
    this.clearRoute();
    this.refreshEvaluation();
    this.riskDirty = true;
  }

  rotateHand(delta) {
    if (!this.hand.active) return;
    this.hand.angle = wrapAngle(this.hand.angle + delta);
    this.riskDirty = true;
    this.refreshEvaluation();
  }

  togglePosture() {
    if (!this.hand.active) return;
    this.hand.posture = this.hand.posture === 'edge' ? 'flat' : 'edge';
    this.riskDirty = true;
    this.refreshEvaluation();
    this.addLog('POSTURE', this.hand.posture === 'edge' ? 'Edge-supported tripwire geometry' : 'Flat support geometry', '');
    this.ui.setLogs(this.logs);
  }

  togglePause() {
    this.running = !this.running;
    this.statusNote = this.running ? PHASE_NOTES[this.phase] : 'Simulation clock paused; controls and inspection remain available.';
  }

  setPhysics(patch) {
    this.world.setParams(patch);
    this.riskDirty = true;
    this.refreshEvaluation();
  }

  setCord(patch) {
    this.world.setCord(patch);
    this.riskDirty = true;
    this.refreshEvaluation();
  }

  refreshEvaluation() {
    if (!this.hand?.active) {
      this.handEval = { utilization: 0, forceUtilization: 0, torqueUtilization: 0, tip: 0, minGap: Infinity, boundaryMargin: Infinity, force: { x: 0, y: 0 } };
      this.handLegal = false;
      return;
    }
    this.handEval = this.world.evaluateHand(this.hand);
    this.handLegal = this.phase === 'aiming' && this.handEval.boundaryMargin >= 0 && this.handEval.minGap > 0.012 && pointInPolygon(this.hand.pos, this.world.cordPolygon);
  }

  releaseHand() {
    if (!this.hand.active || this.phase !== 'aiming') return;
    this.refreshEvaluation();
    if (!this.handLegal) {
      this.ui.showBanner('ILLEGAL RELEASE', 'The full footprint must be inside the cord and clear of other stones.', 'danger', 1700);
      this.addLog('BLOCKED', 'Release rejected by geometric admissibility guard', 'failure');
      this.ui.setLogs(this.logs);
      return;
    }
    if (this.mode === 'game' && this.inventories[this.currentPlayer] <= 0) return;

    const stone = this.world.addStone({
      player: this.currentPlayer, pos: { ...this.hand.pos }, angle: this.hand.angle,
      posture: this.hand.posture, tilt: this.hand.posture === 'edge' ? 1 : 0,
      moment: this.hand.moment,
    });
    this.placedStoneId = stone.id;
    if (this.mode === 'game') this.inventories[this.currentPlayer] -= 1;
    this.hand.active = false;
    this.routeRunning = false;
    this.phase = 'settling';
    this.releaseTime = this.world.time;
    this.settleAccum = 0;
    this.statusNote = PHASE_NOTES.settling;
    this.addLog('RELEASE', `${stone.id.toUpperCase()} placed by ${this.mode === 'game' ? `P${this.currentPlayer + 1}` : 'LAB'}`, '');
    this.renderer.addEffect('release', stone.pos, { color: '110,235,210', text: 'RELEASE' });
    this.clearRoute(false);
    this.riskDirty = true;
    this.ui.setLogs(this.logs);
  }

  clearRoute(clearGoal = true) {
    this.route = [];
    this.routeIndex = 0;
    this.routeRunning = false;
    if (clearGoal) this.goal = null;
  }

  computeRisk(force = false) {
    if (!this.hand.active) return;
    if (!force && this.world.time - this.lastRiskAt < 0.20) return;
    this.riskGrid = computeRiskGrid(this.world, this.hand, { cols: 58, rows: 44 });
    this.lastRiskAt = this.world.time;
    this.riskDirty = false;
  }

  planCandidate(mode = 'safe') {
    if (!this.hand.active || this.phase !== 'aiming') return;
    this.computeRisk(true);
    const index = chooseCandidate(this.riskGrid, mode);
    if (index < 0) {
      this.ui.showBanner('NO ADMISSIBLE ROUTE', 'The current board has no candidate below the planner threshold.', 'danger');
      return;
    }
    this.planTo(gridPoint(this.riskGrid, index), mode);
  }

  planTo(goal, mode = 'custom') {
    if (!this.hand.active) return;
    this.computeRisk(true);
    const route = findRiskAwarePath(this.riskGrid, this.hand.pos, goal, {
      riskWeight: mode === 'trap' ? 4.8 : 8.2,
      maxRisk: mode === 'trap' ? 1.01 : 1.13,
      clearanceWeight: mode === 'trap' ? 0.10 : 0.28,
    });
    if (!route.length) {
      this.ui.showBanner('ROUTE BLOCKED', 'No connected path satisfies the current risk ceiling.', 'danger');
      this.addLog('PLANNER', 'A* found no route below the risk ceiling', 'failure');
      this.ui.setLogs(this.logs);
      return;
    }
    this.goal = { ...goal };
    this.route = [{ ...this.hand.pos }, ...route.filter((p, i) => i > 0 || distance(p, this.hand.pos) > 0.05)];
    this.routeIndex = 1;
    this.routeRunning = false;
    const evaluation = this.world.evaluateHand({ ...this.hand, pos: goal });
    this.statusNote = `${mode.toUpperCase()} route planned · terminal χ ≈ ${evaluation.utilization.toFixed(2)}.`;
    this.addLog('PLANNER', `${mode.toUpperCase()} route · ${this.route.length} waypoints · χ≈${evaluation.utilization.toFixed(2)}`, 'success');
    this.ui.setLogs(this.logs);
  }

  toggleRouteRun() {
    if (this.routeRunning) {
      this.routeRunning = false;
      this.statusNote = 'Route execution paused.';
      return;
    }
    if (!this.route.length || !this.hand.active) return;
    this.routeRunning = true;
    this.pointerControlling = false;
    if (this.routeIndex <= 0 || this.routeIndex >= this.route.length) this.routeIndex = 1;
    this.statusNote = 'Executing risk-aware approach trajectory; release remains manual.';
  }
}
