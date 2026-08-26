import {
  add, clamp, dipoleField, len, momentVector, mul, nearestPointOnPolygon,
  pointInPolygon, signedBoundaryMargin, sub, unit
} from './physics.js';

const PLAYER_COLORS = ['#72f1c8', '#ff9f5a', '#e780ff', '#ffe074'];

function capsulePath(ctx, length, width) {
  const r = width / 2;
  const h = length / 2;
  ctx.beginPath();
  ctx.moveTo(-h + r, -r);
  ctx.lineTo(h - r, -r);
  ctx.arc(h - r, 0, r, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(-h + r, r);
  ctx.arc(-h + r, 0, r, Math.PI / 2, Math.PI * 1.5);
  ctx.closePath();
}

function roundedRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function colorForRisk(risk, alpha = 1) {
  if (!Number.isFinite(risk)) return `rgba(120,140,160,${alpha})`;
  if (risk < 0.55) return `rgba(80,232,184,${alpha})`;
  if (risk < 0.85) return `rgba(246,205,84,${alpha})`;
  if (risk < 1.0) return `rgba(255,147,70,${alpha})`;
  return `rgba(255,67,78,${alpha})`;
}

export class CanvasRenderer {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.zoom = options.zoom ?? 1;
    this.pan = { x: 0, y: 0 };
    this.view = { scale: 100, cx: 0, cy: 0 };
    this.showField = true;
    this.showForces = true;
    this.showLabels = true;
    this.showGrid = true;
    this.showRiskHalos = true;
    this.effects = [];
    this.fieldCache = [];
    this.fieldFrame = 0;
    this.lastWorldSignature = '';
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.floor(rect.width * this.dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * this.dpr));
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.width = rect.width;
    this.height = rect.height;
  }

  fitWorld(world) {
    const compact = this.width < 900;
    const sideReserve = compact ? 0 : Math.min(330, this.width * 0.22);
    const usableW = Math.max(360, this.width - sideReserve * 2 - 42);
    const usableH = Math.max(320, this.height - (compact ? 275 : 165));
    const sx = usableW / (world.cord.rx * 2 + 1.55);
    const sy = usableH / (world.cord.ry * 2 + 1.45);
    this.view.scale = Math.max(35, Math.min(sx, sy) * this.zoom);
    this.view.cx = this.width / 2 + this.pan.x;
    this.view.cy = compact ? this.height * 0.43 + this.pan.y : this.height * 0.49 + this.pan.y;
  }

  worldToScreen(p) {
    return { x: this.view.cx + p.x * this.view.scale, y: this.view.cy - p.y * this.view.scale };
  }

  screenToWorld(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left, y = clientY - rect.top;
    return { x: (x - this.view.cx) / this.view.scale, y: (this.view.cy - y) / this.view.scale };
  }

  addEffect(type, pos, options = {}) {
    this.effects.push({ type, pos: { ...pos }, age: 0, life: options.life ?? 1.0, color: options.color, text: options.text });
  }

  render(world, app, dt = 1 / 60) {
    this.fitWorld(world);
    const ctx = this.ctx;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawBackground(ctx);
    this.drawBoard(ctx, world);
    if (this.showField) this.drawField(ctx, world, app.hand);
    this.drawRouteAndTrail(ctx, app);
    this.drawJoints(ctx, world);
    const stones = [...world.activeStones()].sort((a, b) => a.pos.y - b.pos.y);
    for (const stone of stones) this.drawStone(ctx, stone, false, app);
    if (app.hand?.active) this.drawHand(ctx, world, app.hand, app);
    this.drawEffects(ctx, dt);
    this.drawCornerReadout(ctx, world, app);
    ctx.restore();
  }

  drawBackground(ctx) {
    const g = ctx.createRadialGradient(this.width * 0.50, this.height * 0.43, 40, this.width * 0.50, this.height * 0.48, Math.max(this.width, this.height) * 0.75);
    g.addColorStop(0, '#101a22');
    g.addColorStop(0.48, '#071017');
    g.addColorStop(1, '#020508');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = '#66c4bd';
    ctx.lineWidth = 0.5;
    const spacing = 34;
    for (let x = (this.view.cx % spacing) - spacing; x < this.width + spacing; x += spacing) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, this.height); ctx.stroke();
    }
    for (let y = (this.view.cy % spacing) - spacing; y < this.height + spacing; y += spacing) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.width, y); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  polygonPath(ctx, polygon) {
    const first = this.worldToScreen(polygon[0]);
    ctx.beginPath(); ctx.moveTo(first.x, first.y);
    for (let i = 1; i < polygon.length; i += 1) {
      const p = this.worldToScreen(polygon[i]); ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
  }

  drawBoard(ctx, world) {
    this.polygonPath(ctx, world.cordPolygon);
    const fill = ctx.createRadialGradient(this.view.cx - 60, this.view.cy - 90, 20, this.view.cx, this.view.cy, this.view.scale * world.cord.rx);
    fill.addColorStop(0, 'rgba(22,45,52,.92)');
    fill.addColorStop(1, 'rgba(5,17,24,.94)');
    ctx.fillStyle = fill; ctx.fill();

    ctx.save();
    this.polygonPath(ctx, world.cordPolygon); ctx.clip();
    if (this.showGrid) {
      ctx.strokeStyle = 'rgba(118,210,198,.12)';
      ctx.lineWidth = 0.7;
      const step = this.view.scale * 0.5;
      for (let x = this.view.cx - world.cord.rx * this.view.scale; x <= this.view.cx + world.cord.rx * this.view.scale; x += step) {
        ctx.beginPath(); ctx.moveTo(x, this.view.cy - world.cord.ry * this.view.scale); ctx.lineTo(x, this.view.cy + world.cord.ry * this.view.scale); ctx.stroke();
      }
      for (let y = this.view.cy - world.cord.ry * this.view.scale; y <= this.view.cy + world.cord.ry * this.view.scale; y += step) {
        ctx.beginPath(); ctx.moveTo(this.view.cx - world.cord.rx * this.view.scale, y); ctx.lineTo(this.view.cx + world.cord.rx * this.view.scale, y); ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(140,245,223,.20)';
      ctx.beginPath(); ctx.moveTo(this.view.cx - 5, this.view.cy); ctx.lineTo(this.view.cx + 5, this.view.cy); ctx.moveTo(this.view.cx, this.view.cy - 5); ctx.lineTo(this.view.cx, this.view.cy + 5); ctx.stroke();
    }
    ctx.restore();

    this.polygonPath(ctx, world.cordPolygon);
    ctx.strokeStyle = 'rgba(0,0,0,.64)'; ctx.lineWidth = 11; ctx.lineJoin = 'round'; ctx.stroke();
    this.polygonPath(ctx, world.cordPolygon);
    ctx.strokeStyle = '#d77831'; ctx.lineWidth = 6.4; ctx.stroke();
    this.polygonPath(ctx, world.cordPolygon);
    ctx.strokeStyle = 'rgba(255,218,164,.60)'; ctx.lineWidth = 1.25; ctx.stroke();
    ctx.setLineDash([4, 8]);
    this.polygonPath(ctx, world.cordPolygon);
    ctx.strokeStyle = 'rgba(79,32,10,.45)'; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.setLineDash([]);
  }

  computeFieldCache(world, hand) {
    const cols = 22, rows = 15;
    const out = [];
    const stones = world.activeStones();
    const opts = world.magneticOpts();
    const sources = stones.map((s) => ({ pos: s.pos, m: world.momentOf(s) }));
    if (hand?.active) sources.push({ pos: hand.pos, m: momentVector(hand.angle, hand.moment ?? 1) });
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const x = -world.cord.rx * 1.02 + (col + 0.5) / cols * world.cord.rx * 2.04;
        const y = -world.cord.ry * 1.02 + (row + 0.5) / rows * world.cord.ry * 2.04;
        const p = { x, y };
        if (!pointInPolygon(p, world.cordPolygon)) continue;
        let B = { x: 0, y: 0 };
        for (const s of sources) {
          if (Math.hypot(p.x - s.pos.x, p.y - s.pos.y) < 0.36) continue;
          B = add(B, dipoleField(s.pos, s.m, p, opts));
        }
        const mag = len(B);
        if (mag > 1e-4) out.push({ p, d: unit(B), mag });
      }
    }
    this.fieldCache = out;
  }

  drawField(ctx, world, hand) {
    if ((this.fieldFrame++ % 7) === 0) this.computeFieldCache(world, hand);
    ctx.save();
    this.polygonPath(ctx, world.cordPolygon); ctx.clip();
    for (const a of this.fieldCache) {
      const p = this.worldToScreen(a.p);
      const l = clamp(5 + Math.log1p(a.mag * 18) * 4.2, 5, 19);
      const dx = a.d.x * l, dy = -a.d.y * l;
      const alpha = clamp(0.10 + Math.log1p(a.mag * 15) * 0.085, 0.10, 0.48);
      ctx.strokeStyle = `rgba(115,225,213,${alpha})`;
      ctx.fillStyle = `rgba(115,225,213,${alpha})`;
      ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(p.x - dx * 0.45, p.y - dy * 0.45); ctx.lineTo(p.x + dx * 0.55, p.y + dy * 0.55); ctx.stroke();
      const ex = p.x + dx * 0.55, ey = p.y + dy * 0.55;
      const n = Math.hypot(dx, dy) || 1;
      const ux = dx / n, uy = dy / n;
      ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex - ux * 3 - uy * 2, ey - uy * 3 + ux * 2); ctx.lineTo(ex - ux * 3 + uy * 2, ey - uy * 3 - ux * 2); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  drawRouteAndTrail(ctx, app) {
    if (app.route?.length) {
      ctx.save();
      ctx.strokeStyle = 'rgba(190,255,238,.22)'; ctx.lineWidth = 7; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      app.route.forEach((p, i) => { const s = this.worldToScreen(p); if (i) ctx.lineTo(s.x, s.y); else ctx.moveTo(s.x, s.y); });
      ctx.stroke();
      ctx.strokeStyle = '#b8ffe9'; ctx.lineWidth = 1.8; ctx.setLineDash([7, 7]); ctx.stroke(); ctx.setLineDash([]);
      ctx.restore();
    }
    if (app.trail?.length > 1) {
      ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (let i = 1; i < app.trail.length; i += 1) {
        const a = this.worldToScreen(app.trail[i - 1].pos), b = this.worldToScreen(app.trail[i].pos);
        ctx.strokeStyle = colorForRisk(app.trail[i].risk, 0.75);
        ctx.lineWidth = 2.1;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.restore();
    }
    if (app.goal) {
      const g = this.worldToScreen(app.goal);
      const pulse = 8 + Math.sin(performance.now() * 0.005) * 2;
      ctx.strokeStyle = 'rgba(255,255,255,.92)'; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.arc(g.x, g.y, pulse, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(g.x - 13, g.y); ctx.lineTo(g.x + 13, g.y); ctx.moveTo(g.x, g.y - 13); ctx.lineTo(g.x, g.y + 13); ctx.stroke();
    }
  }

  drawJoints(ctx, world) {
    for (const joint of world.joints.values()) {
      const a = world.getStone(joint.a), b = world.getStone(joint.b);
      if (!a || !b) continue;
      const sa = this.worldToScreen(a.pos), sb = this.worldToScreen(b.pos);
      ctx.strokeStyle = 'rgba(255,91,65,.22)'; ctx.lineWidth = 9;
      ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke();
      ctx.strokeStyle = '#ff775b'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sb.x, sb.y); ctx.stroke();
    }
  }

  drawStone(ctx, stone, hand = false, app = null) {
    const p = this.worldToScreen(stone.pos);
    const scale = this.view.scale;
    const tilt = clamp(stone.tilt ?? 0, 0, 1);
    const L = stone.length * scale;
    const flatW = stone.width * scale;
    const W = flatW * (1 - 0.56 * tilt);
    const lift = tilt * 0.28 * scale;
    const playerColor = PLAYER_COLORS[(stone.player ?? 0) % PLAYER_COLORS.length];
    const risk = hand ? (app?.handEval?.utilization ?? 0) : stone.utilization;

    if (this.showRiskHalos && risk > 0.35) {
      const radius = (stone.footprintRadius * scale) * (1.15 + 0.18 * Math.sin(performance.now() * 0.006 + stone.angle));
      const halo = ctx.createRadialGradient(p.x, p.y - lift * 0.3, 0, p.x, p.y - lift * 0.3, radius);
      halo.addColorStop(0, colorForRisk(risk, 0.22)); halo.addColorStop(1, colorForRisk(risk, 0));
      ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, Math.PI * 2); ctx.fill();
    }

    ctx.save();
    ctx.translate(p.x, p.y - lift * 0.36);
    ctx.rotate(-stone.angle);

    ctx.save();
    ctx.translate(5 + tilt * 3, 7 + tilt * 8);
    capsulePath(ctx, L, Math.max(W, 8));
    ctx.fillStyle = 'rgba(0,0,0,.48)'; ctx.fill();
    ctx.restore();

    if (tilt > 0.08) {
      ctx.save();
      ctx.translate(0, lift * 0.34);
      capsulePath(ctx, L, Math.max(W, 7));
      ctx.fillStyle = 'rgba(43,50,52,.95)'; ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.restore();
    }

    capsulePath(ctx, L, Math.max(W, 8));
    const body = ctx.createLinearGradient(-L / 2, -W / 2, L / 2, W / 2);
    if (hand) {
      body.addColorStop(0, 'rgba(255,193,105,.78)'); body.addColorStop(0.5, 'rgba(255,242,216,.94)'); body.addColorStop(1, 'rgba(205,111,52,.80)');
    } else {
      body.addColorStop(0, '#2e3538'); body.addColorStop(0.22, '#8a9696'); body.addColorStop(0.48, '#d3d8d4'); body.addColorStop(0.72, '#596264'); body.addColorStop(1, '#22282b');
    }
    ctx.fillStyle = body; ctx.fill();
    ctx.lineWidth = hand ? 2 : 1.25;
    ctx.strokeStyle = hand ? colorForRisk(risk, 0.96) : 'rgba(231,255,248,.72)';
    if (hand) ctx.setLineDash([6, 4]);
    ctx.stroke(); ctx.setLineDash([]);

    ctx.save(); capsulePath(ctx, L * 0.92, Math.max(W * 0.62, 5));
    const gleam = ctx.createLinearGradient(0, -W / 2, 0, W / 2);
    gleam.addColorStop(0, 'rgba(255,255,255,.34)'); gleam.addColorStop(0.55, 'rgba(255,255,255,.04)'); gleam.addColorStop(1, 'rgba(0,0,0,.16)');
    ctx.fillStyle = gleam; ctx.fill(); ctx.restore();

    const poleX = L * 0.34;
    ctx.strokeStyle = 'rgba(10,18,20,.82)'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(-poleX, 0); ctx.lineTo(poleX, 0); ctx.stroke();
    ctx.fillStyle = '#57d9ed'; ctx.beginPath(); ctx.arc(-poleX, 0, Math.max(2.4, W * 0.12), 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ff744f'; ctx.beginPath(); ctx.arc(poleX, 0, Math.max(2.4, W * 0.12), 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(8,17,20,.8)';
    ctx.beginPath(); ctx.moveTo(poleX + 5, 0); ctx.lineTo(poleX - 2, -3); ctx.lineTo(poleX - 2, 3); ctx.closePath(); ctx.fill();

    ctx.strokeStyle = playerColor; ctx.lineWidth = 2.2;
    ctx.globalAlpha = hand ? 0.75 : 0.82;
    capsulePath(ctx, L + 4, Math.max(W + 4, 12)); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.restore();

    if (!hand && this.showForces && len(stone.force) > 0.015) {
      const direction = unit(stone.force);
      const magnitude = clamp(Math.log1p(len(stone.force) * 2.4) * 12, 4, 46);
      this.drawArrow(ctx, p, { x: p.x + direction.x * magnitude, y: p.y - direction.y * magnitude }, colorForRisk(stone.forceUtilization, 0.88), 1.6);
    }

    if (!hand && this.showLabels) {
      ctx.font = '600 9px "IBM Plex Mono", monospace';
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.fillStyle = stone.pinned ? 'rgba(190,230,222,.68)' : '#fff1ba';
      const state = stone.posture === 'edge' ? 'EDGE' : stone.posture === 'falling' ? 'TIP' : stone.pinned ? 'PIN' : 'SLIP';
      ctx.fillText(`${stone.id.toUpperCase()} · ${state} · χ ${stone.utilization.toFixed(2)}`, p.x, p.y + Math.max(W, 12) * 0.62 + 7);
    }
  }

  drawHand(ctx, world, hand, app) {
    const proxy = {
      ...hand,
      length: hand.length ?? 0.76,
      width: hand.width ?? 0.31,
      footprintRadius: hand.footprintRadius ?? 0.42,
      tilt: hand.posture === 'edge' ? 1 : 0,
      utilization: app.handEval?.utilization ?? 0,
    };
    this.drawStone(ctx, proxy, true, app);
    const p = this.worldToScreen(hand.pos);
    ctx.font = '600 10px "IBM Plex Mono", monospace';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    ctx.fillStyle = app.handLegal ? '#baffdc' : '#ff7d72';
    ctx.fillText(app.handLegal ? 'HELD · SPACE TO RELEASE' : 'HELD · ILLEGAL RELEASE', p.x, p.y - 34);
  }

  drawArrow(ctx, a, b, color, width = 1.5) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const n = Math.hypot(dx, dy) || 1, ux = dx / n, uy = dy / n;
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(b.x - ux * 7 - uy * 3.5, b.y - uy * 7 + ux * 3.5); ctx.lineTo(b.x - ux * 7 + uy * 3.5, b.y - uy * 7 - ux * 3.5); ctx.closePath(); ctx.fill();
  }

  drawEffects(ctx, dt) {
    for (const fx of this.effects) fx.age += dt;
    this.effects = this.effects.filter((fx) => fx.age < fx.life);
    for (const fx of this.effects) {
      const t = fx.age / fx.life;
      const p = this.worldToScreen(fx.pos);
      const radius = 8 + t * 58;
      const color = fx.color ?? (fx.type === 'capture' ? '255,90,66' : fx.type === 'tip' ? '255,193,76' : '110,235,210');
      ctx.strokeStyle = `rgba(${color},${(1 - t) * 0.9})`;
      ctx.lineWidth = 2.5 * (1 - t) + 0.5;
      ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, Math.PI * 2); ctx.stroke();
      if (fx.text) {
        ctx.font = '600 10px "IBM Plex Mono", monospace'; ctx.textAlign = 'center';
        ctx.fillStyle = `rgba(${color},${1 - t})`; ctx.fillText(fx.text, p.x, p.y - radius - 5);
      }
    }
  }

  drawCornerReadout(ctx, world, app) {
    if (this.width < 720) return;
    const x = this.view.cx - world.cord.rx * this.view.scale;
    const y = this.view.cy + world.cord.ry * this.view.scale + 28;
    const text = `MODEL D/H · POINT DIPOLES + FRICTION WRENCH + HYBRID CAPTURE · t=${world.time.toFixed(2)}`;
    ctx.font = '500 9px "IBM Plex Mono", monospace'; ctx.textAlign = 'left'; ctx.fillStyle = 'rgba(155,197,194,.48)';
    ctx.fillText(text, x, Math.min(this.height - 18, y));
  }
}
