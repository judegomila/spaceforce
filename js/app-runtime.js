import { KlusterAppBase, PHASE_NOTES, EVENT_LABELS } from './app-base.js';
import { clamp, distance, len, sub, unit, add, mul } from './physics.js';

export class KlusterApp extends KlusterAppBase {
  updateHandMotion(dt) {
    if (!this.hand.active || this.phase !== 'aiming') return;
    const move = { x: 0, y: 0 };
    if (this.keys.has('arrowleft') || this.keys.has('a')) move.x -= 1;
    if (this.keys.has('arrowright') || this.keys.has('d')) move.x += 1;
    if (this.keys.has('arrowup') || this.keys.has('w')) move.y += 1;
    if (this.keys.has('arrowdown') || this.keys.has('s')) move.y -= 1;
    if (move.x || move.y) {
      this.routeRunning = false;
      this.pointerControlling = false;
      const d = unit(move);
      this.handTarget = add(this.hand.pos, mul(d, 3.1 * dt));
    }

    if (this.routeRunning && this.route.length) {
      const waypoint = this.route[Math.min(this.routeIndex, this.route.length - 1)];
      this.handTarget = { ...waypoint };
    }

    const delta = sub(this.handTarget, this.hand.pos);
    const d = len(delta);
    const maxStep = (this.routeRunning ? 1.35 : 5.8) * dt;
    if (d > 1e-5) this.hand.pos = add(this.hand.pos, mul(delta, Math.min(1, maxStep / d)));

    if (this.routeRunning && d < 0.055) {
      this.routeIndex += 1;
      if (this.routeIndex >= this.route.length) {
        this.routeRunning = false;
        this.handTarget = { ...this.route[this.route.length - 1] };
        this.statusNote = 'Route endpoint reached. Inspect the stability guards, then release manually.';
        this.ui.showBanner('ROUTE COMPLETE', 'Endpoint reached · release remains under player control', 'safe', 1200);
      }
    }

    const last = this.trail[this.trail.length - 1];
    if (!last || distance(last.pos, this.hand.pos) > 0.045) {
      const evalNow = this.world.evaluateHand(this.hand);
      this.trail.push({ pos: { ...this.hand.pos }, risk: evalNow.utilization });
      if (this.trail.length > 480) this.trail.shift();
    }
    this.riskDirty = this.riskDirty || d > 0.025;
  }

  processEvents(events) {
    for (const event of events) {
      const descriptor = EVENT_LABELS[event.type];
      if (descriptor && event.type !== 'contact' && event.type !== 'boundaryReentry') {
        let detail = descriptor[1];
        if (event.a && event.b) detail = `${event.a.toUpperCase()} ↔ ${event.b.toUpperCase()}`;
        else if (event.stoneId) detail = event.stoneId.toUpperCase();
        this.addLog(descriptor[0], detail, descriptor[2]);
      }
      const pos = event.stoneId ? this.world.getStone(event.stoneId)?.pos
        : event.a ? this.world.getStone(event.a)?.pos : null;
      if (pos && ['capture', 'tip', 'boundaryExit', 'handCapture'].includes(event.type)) {
        this.renderer.addEffect(event.type, pos, {
          color: event.type === 'capture' || event.type === 'handCapture' ? '255,90,66' : event.type === 'tip' ? '255,193,76' : '255,110,84',
          text: EVENT_LABELS[event.type]?.[0],
        });
      }
      if (this.mode === 'game' && ['capture', 'handCapture', 'handContact', 'boundaryExit'].includes(event.type)) {
        this.triggerFailure(event);
      }
    }
    if (events.length) {
      this.riskDirty = true;
      this.ui.setLogs(this.logs);
    }
  }

  triggerFailure(event) {
    if (this.phase === 'won') return;
    if (event.a) this.failureSeeds.add(event.a);
    if (event.b) this.failureSeeds.add(event.b);
    if (event.stoneId) this.failureSeeds.add(event.stoneId);
    if (this.phase === 'failure') return;
    this.phase = 'failure';
    this.failureStartedAt = this.world.time;
    this.hand.active = false;
    this.routeRunning = false;
    this.statusNote = PHASE_NOTES.failure;
    this.addLog('TURN FAILED', `P${this.currentPlayer + 1} triggered ${event.type}`, 'failure');
    this.ui.showBanner('MAGNETIC FAILURE', `${event.type.toUpperCase()} · resolving affected component`, 'danger', 1800);
  }

  resolveFailure() {
    const collected = new Set();
    for (const stone of this.world.activeStones()) if (stone.outside) collected.add(stone.id);
    for (const joint of this.world.joints.values()) {
      if (joint.turnId === this.world.turnId) { collected.add(joint.a); collected.add(joint.b); }
    }
    for (const seed of this.failureSeeds) {
      if (!this.world.getStone(seed)) continue;
      for (const id of this.world.clusterMembers(seed)) collected.add(id);
    }
    const ids = [...collected].filter((id) => this.world.getStone(id));
    this.world.removeStones(ids);
    if (this.mode === 'game') this.inventories[this.currentPlayer] += ids.length;
    this.addLog('PICK UP', `${ids.length} stone${ids.length === 1 ? '' : 's'} returned to P${this.currentPlayer + 1}`, 'failure');
    this.ui.showBanner('TURN ENDS', `${ids.length} affected stone${ids.length === 1 ? '' : 's'} collected`, 'danger', 1400);
    this.advanceTurn();
  }

  completeSuccess() {
    if (this.mode === 'game') {
      this.addLog('STABLE', `P${this.currentPlayer + 1} completed a legal placement`, 'success');
      if (this.inventories[this.currentPlayer] === 0) {
        this.phase = 'won';
        this.hand.active = false;
        this.statusNote = PHASE_NOTES.won;
        this.ui.showBanner(`PLAYER ${this.currentPlayer + 1} WINS`, `${this.turnNumber} turns · stable final placement`, 'safe', 5000);
        this.addLog('WIN', `Player ${this.currentPlayer + 1} emptied their inventory`, 'success');
        this.ui.setLogs(this.logs);
        return;
      }
      this.ui.showBanner('STABLE PLACEMENT', `P${this.currentPlayer + 1} transfers the field to the next player`, 'safe', 1100);
      this.advanceTurn();
    } else {
      this.addLog('SETTLED', 'Laboratory placement reached a low-velocity state', 'success');
      this.spawnHand({ pos: { x: -this.world.cord.rx - 0.75, y: -this.world.cord.ry - 0.5 } });
      this.ui.setLogs(this.logs);
    }
  }

  advanceTurn() {
    this.currentPlayer = (this.currentPlayer + 1) % this.players;
    this.turnNumber += 1;
    this.world.turnId += 1;
    this.failureSeeds.clear();
    this.placedStoneId = null;
    this.spawnHand();
    this.addLog('NEXT TURN', `P${this.currentPlayer + 1} · ${this.inventories[this.currentPlayer]} stones remaining`, '');
    this.ui.setLogs(this.logs);
  }

  updatePhase(dt) {
    if (this.phase === 'failure') {
      if (this.world.time - this.failureStartedAt > 0.88 || (this.world.time - this.failureStartedAt > 0.35 && this.world.isSettled())) this.resolveFailure();
      return;
    }
    if (this.phase !== 'settling') return;
    if (this.world.time - this.releaseTime < 0.16) return;
    if (this.world.isSettled()) this.settleAccum += dt;
    else this.settleAccum = 0;
    if (this.settleAccum > 0.28) this.completeSuccess();
  }

  addLog(label, detail, kind = '') {
    const last = this.logs[this.logs.length - 1];
    if (last && last.label === label && last.detail === detail && this.world.time - last.time < 0.12) return;
    this.logs.push({ time: this.world.time, label, detail, kind });
    if (this.logs.length > 120) this.logs.shift();
  }

  recordHistory() {
    this.history.push({
      time: this.world.time,
      util: this.world.maxUtilization,
      hand: this.handEval?.utilization ?? 0,
      kinetic: this.world.totalKinetic,
    });
    if (this.history.length > 240) this.history.shift();
  }

  exportState() {
    const data = {
      app: {
        version: 1, mode: this.mode, players: this.players, inventories: this.inventories,
        currentPlayer: this.currentPlayer, turnNumber: this.turnNumber, phase: this.phase,
        hand: this.hand, timeScale: this.timeScale,
      },
      world: this.world.serialize(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `kluster-state-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click(); URL.revokeObjectURL(url);
    this.addLog('EXPORT', 'State snapshot written as JSON', 'success');
    this.ui.setLogs(this.logs);
  }

  async importState(file) {
    try {
      const data = JSON.parse(await file.text());
      if (!data.world) throw new Error('Missing world state');
      this.world.load(data.world);
      const app = data.app ?? {};
      this.mode = app.mode ?? 'lab';
      this.players = app.players ?? 2;
      this.inventories = app.inventories ?? Array.from({ length: this.players }, () => 24 / this.players);
      this.currentPlayer = app.currentPlayer ?? 0;
      this.turnNumber = app.turnNumber ?? 1;
      this.phase = app.phase === 'won' ? 'won' : 'aiming';
      this.timeScale = app.timeScale ?? 1;
      this.hand = this.makeHand({ ...(app.hand ?? {}), active: this.phase !== 'won' });
      this.handTarget = { ...this.hand.pos };
      this.route = []; this.goal = null; this.trail = []; this.history = [];
      this.riskDirty = true;
      this.refreshEvaluation();
      this.computeRisk(true);
      this.addLog('IMPORT', file.name, 'success');
      this.ui.setLogs(this.logs);
      this.ui.showBanner('STATE IMPORTED', file.name, 'safe');
    } catch (error) {
      console.error(error);
      this.ui.showBanner('IMPORT FAILED', error.message, 'danger');
    }
  }

  frame(now) {
    const realDt = clamp((now - this.lastFrame) / 1000, 0, 0.05);
    this.lastFrame = now;

    if (this.running) {
      this.updateHandMotion(realDt * this.timeScale);
      this.accumulator += realDt * this.timeScale;
      const fixedDt = this.world.params.fixedDt;
      let steps = 0;
      while (this.accumulator >= fixedDt && steps++ < 18) {
        const activeHand = this.hand.active && this.phase === 'aiming' ? this.hand : null;
        const events = this.world.step(fixedDt, activeHand);
        this.processEvents(events);
        this.updatePhase(fixedDt);
        this.accumulator -= fixedDt;
      }
      if (steps >= 18) this.accumulator = 0;
    }

    this.refreshEvaluation();
    if (this.running && this.hand.active && (this.riskDirty || this.world.time - this.lastRiskAt > 0.42)) this.computeRisk();
    if (now - this.lastHistoryAt > 85) { this.recordHistory(); this.lastHistoryAt = now; }
    this.renderer.render(this.world, this, realDt);
    if (now - this.lastUiAt > 70) { this.ui.update(); this.lastUiAt = now; }
    requestAnimationFrame((time) => this.frame(time));
  }
}
