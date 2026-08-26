import {
  clamp, createStone, dipoleForce, dipolePotential, dipoleTorque, distance,
  len, momentVector, pointInPolygon, signedBoundaryMargin, v, add
} from './physics.js';

function heatColor(t) {
  t = clamp(t, 0, 1);
  const stops = [
    [7, 19, 34], [14, 74, 93], [22, 139, 121], [151, 190, 92], [239, 160, 56], [218, 70, 64],
  ];
  const x = t * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const a = stops[i], b = stops[i + 1];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

export function computeRiskGrid(world, hand, options = {}) {
  const cols = options.cols ?? 58;
  const rows = options.rows ?? 44;
  const pad = options.pad ?? 1.15;
  // A legal move begins outside the cord. Keep the approach domain large enough
  // to contain the held stone, while reserving a separate mask for legal release.
  const minX = Math.min(-world.cord.rx - pad, hand.pos.x - 0.25);
  const maxX = Math.max(world.cord.rx + pad, hand.pos.x + 0.25);
  const minY = Math.min(-world.cord.ry - pad, hand.pos.y - 0.25);
  const maxY = Math.max(world.cord.ry + pad, hand.pos.y + 0.25);
  const dx = (maxX - minX) / (cols - 1);
  const dy = (maxY - minY) / (rows - 1);
  const values = new Float32Array(cols * rows);
  const clearance = new Float32Array(cols * rows);
  const valid = new Uint8Array(cols * rows);
  const releaseValid = new Uint8Array(cols * rows);
  const stones = world.activeStones();
  const opts = world.magneticOpts();
  const base = world.computeBackgroundLoads(null).loads;
  const mh = momentVector(hand.angle, (hand.moment ?? 1) * world.params.momentScale);
  const handProxy = createStone({ posture: hand.posture ?? 'flat', moment: hand.moment ?? 1 });

  let minValue = Infinity;
  let bestIndex = -1;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const idx = row * cols + col;
      const pos = { x: minX + col * dx, y: minY + row * dy };
      const margin = signedBoundaryMargin(pos, world.cordPolygon) - (hand.footprintRadius ?? 0.42);
      const legalRelease = margin >= 0 && pointInPolygon(pos, world.cordPolygon);
      let minGap = Infinity;
      let maxRisk = 0;
      let handForce = v(), handTorque = 0;
      for (const s of stones) {
        const ms = world.momentOf(s);
        const fOnStone = dipoleForce(pos, mh, s.pos, ms, opts);
        const tOnStone = dipoleTorque(pos, mh, s.pos, ms, opts);
        const b = base.get(s.id);
        const util = world.utilizationFor(s, add(b.force, fOnStone), b.torque + tOnStone);
        const tip = world.tipUtilizationFor(s, add(b.force, fOnStone));
        maxRisk = Math.max(maxRisk, util.combined, tip);
        handForce = add(handForce, dipoleForce(s.pos, ms, pos, mh, opts));
        handTorque += dipoleTorque(s.pos, ms, pos, mh, opts);
        minGap = Math.min(minGap, distance(pos, s.pos) - (hand.collisionRadius ?? 0.27) - s.collisionRadius);
      }
      const handUtil = world.utilizationFor(handProxy, handForce, handTorque);
      const handTip = world.tipUtilizationFor(handProxy, handForce);
      maxRisk = Math.max(maxRisk, handUtil.combined, handTip);
      if (minGap < 0.08) maxRisk = Math.max(maxRisk, 1.4 + Math.max(0, -minGap) * 4);
      if (legalRelease && margin < 0.12) maxRisk = Math.max(maxRisk, 1.15 + (0.12 - margin) * 2);
      values[idx] = maxRisk;
      clearance[idx] = legalRelease ? Math.min(minGap, margin) : minGap;
      valid[idx] = minGap > 0.015 ? 1 : 0;
      releaseValid[idx] = valid[idx] && legalRelease ? 1 : 0;
      if (releaseValid[idx] && maxRisk < minValue) { minValue = maxRisk; bestIndex = idx; }
    }
  }

  return { cols, rows, minX, maxX, minY, maxY, dx, dy, values, clearance, valid, releaseValid, minValue, bestIndex };
}

export function gridPoint(grid, index) {
  const col = index % grid.cols;
  const row = Math.floor(index / grid.cols);
  return { x: grid.minX + col * grid.dx, y: grid.minY + row * grid.dy };
}

export function nearestGridIndex(grid, pos) {
  const col = clamp(Math.round((pos.x - grid.minX) / grid.dx), 0, grid.cols - 1);
  const row = clamp(Math.round((pos.y - grid.minY) / grid.dy), 0, grid.rows - 1);
  return row * grid.cols + col;
}

export function chooseCandidate(grid, mode = 'safe') {
  let best = -1, score = Infinity;
  const candidates = grid.releaseValid ?? grid.valid;
  for (let i = 0; i < grid.values.length; i += 1) {
    if (!candidates[i]) continue;
    const risk = grid.values[i];
    const clear = grid.clearance[i];
    let s;
    if (mode === 'trap') {
      if (risk >= 1.0 || risk < 0.42) continue;
      const col = i % grid.cols, row = Math.floor(i / grid.cols);
      const neighbors = [];
      for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const c = col + dc, r = row + dr;
        if (c >= 0 && c < grid.cols && r >= 0 && r < grid.rows) neighbors.push(grid.values[r * grid.cols + c]);
      }
      const gradient = neighbors.length ? Math.max(...neighbors.map((x) => Math.abs(x - risk))) : 0;
      s = Math.abs(risk - 0.84) * 4 - gradient * 0.7 - Math.min(clear, 0.8) * 0.08;
    } else {
      s = risk * risk * 3.2 - Math.min(clear, 1.2) * 0.18;
    }
    if (s < score) { score = s; best = i; }
  }
  return best >= 0 ? best : grid.bestIndex;
}

class MinHeap {
  constructor() { this.a = []; }
  push(item) {
    this.a.push(item);
    let i = this.a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.a[p].f <= item.f) break;
      this.a[i] = this.a[p]; i = p;
    }
    this.a[i] = item;
  }
  pop() {
    if (!this.a.length) return null;
    const root = this.a[0];
    const last = this.a.pop();
    if (this.a.length && last) {
      let i = 0;
      while (true) {
        const left = i * 2 + 1;
        const right = left + 1;
        if (left >= this.a.length) break;
        let child = left;
        if (right < this.a.length && this.a[right].f < this.a[left].f) child = right;
        if (this.a[child].f >= last.f) break;
        this.a[i] = this.a[child];
        i = child;
      }
      this.a[i] = last;
    }
    return root;
  }
  get length() { return this.a.length; }
}

export function findRiskAwarePath(grid, startPos, goalPos, options = {}) {
  const start = nearestGridIndex(grid, startPos);
  const goal = nearestGridIndex(grid, goalPos);
  const n = grid.values.length;
  const g = new Float64Array(n); g.fill(Infinity);
  const came = new Int32Array(n); came.fill(-1);
  const closed = new Uint8Array(n);
  const heap = new MinHeap();
  const riskWeight = options.riskWeight ?? 7;
  const maxRisk = options.maxRisk ?? 1.12;
  const clearanceWeight = options.clearanceWeight ?? 0.22;
  g[start] = 0;
  heap.push({ i: start, f: 0 });
  const dirs = [[1,0,1],[-1,0,1],[0,1,1],[0,-1,1],[1,1,Math.SQRT2],[-1,1,Math.SQRT2],[1,-1,Math.SQRT2],[-1,-1,Math.SQRT2]];

  const heuristic = (i) => {
    const a = gridPoint(grid, i), b = gridPoint(grid, goal);
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  while (heap.length) {
    const cur = heap.pop();
    if (closed[cur.i]) continue;
    if (cur.i === goal) break;
    closed[cur.i] = 1;
    const col = cur.i % grid.cols, row = Math.floor(cur.i / grid.cols);
    for (const [dc, dr, step] of dirs) {
      const c = col + dc, r = row + dr;
      if (c < 0 || c >= grid.cols || r < 0 || r >= grid.rows) continue;
      const ni = r * grid.cols + c;
      if (!grid.valid[ni] || grid.values[ni] > maxRisk || closed[ni]) continue;
      const risk = Math.max(0, grid.values[ni]);
      const clear = Math.max(0.02, grid.clearance[ni]);
      const cost = step * (1 + riskWeight * Math.pow(risk, 3.2) + clearanceWeight / clear);
      const ng = g[cur.i] + cost;
      if (ng < g[ni]) {
        g[ni] = ng; came[ni] = cur.i;
        heap.push({ i: ni, f: ng + heuristic(ni) });
      }
    }
  }

  if (came[goal] < 0 && goal !== start) return [];
  const indices = [];
  for (let at = goal; at >= 0; at = came[at]) {
    indices.push(at);
    if (at === start) break;
  }
  indices.reverse();
  const raw = indices.map((i) => gridPoint(grid, i));
  if (raw.length < 3) return raw;

  // Line-of-sight simplification on grid cells.
  const out = [raw[0]];
  let anchor = 0;
  for (let i = 2; i < raw.length; i += 1) {
    if (!segmentSafe(grid, raw[anchor], raw[i], maxRisk)) {
      out.push(raw[i - 1]);
      anchor = i - 1;
    }
  }
  out.push(raw[raw.length - 1]);
  return out;
}

function segmentSafe(grid, a, b, maxRisk) {
  const d = distance(a, b);
  const steps = Math.max(2, Math.ceil(d / Math.min(grid.dx, grid.dy) * 1.4));
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    const idx = nearestGridIndex(grid, p);
    if (!grid.valid[idx] || grid.values[idx] > maxRisk) return false;
  }
  return true;
}

export function drawRiskGrid(ctx, grid, options = {}) {
  const w = ctx.canvas.width, h = ctx.canvas.height;
  ctx.clearRect(0, 0, w, h);
  const image = ctx.createImageData(grid.cols, grid.rows);
  for (let row = 0; row < grid.rows; row += 1) {
    for (let col = 0; col < grid.cols; col += 1) {
      const src = row * grid.cols + col;
      const dst = ((grid.rows - 1 - row) * grid.cols + col) * 4;
      const value = grid.values[src];
      const t = clamp(Math.log10(1 + value * 3) / Math.log10(1 + 3.6), 0, 1);
      const [r, g, b] = heatColor(t);
      image.data[dst] = r;
      image.data[dst + 1] = g;
      image.data[dst + 2] = b;
      image.data[dst + 3] = grid.valid[src] ? 235 : 45;
    }
  }
  const temp = document.createElement('canvas');
  temp.width = grid.cols; temp.height = grid.rows;
  temp.getContext('2d').putImageData(image, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(temp, 0, 0, w, h);
  ctx.strokeStyle = 'rgba(255,255,255,.20)';
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);

  if (options.route?.length) {
    ctx.strokeStyle = '#d9fff1'; ctx.lineWidth = 2;
    ctx.beginPath();
    options.route.forEach((p, i) => {
      const x = (p.x - grid.minX) / (grid.maxX - grid.minX) * w;
      const y = h - (p.y - grid.minY) / (grid.maxY - grid.minY) * h;
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    });
    ctx.stroke();
  }
  if (options.goal) {
    const x = (options.goal.x - grid.minX) / (grid.maxX - grid.minX) * w;
    const y = h - (options.goal.y - grid.minY) / (grid.maxY - grid.minY) * h;
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, 5.5, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 9, y); ctx.lineTo(x + 9, y); ctx.moveTo(x, y - 9); ctx.lineTo(x, y + 9); ctx.stroke();
  }
}

export function riskMapToWorld(grid, canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const u = clamp((clientX - rect.left) / rect.width, 0, 1);
  const vv = clamp((clientY - rect.top) / rect.height, 0, 1);
  return { x: grid.minX + u * (grid.maxX - grid.minX), y: grid.maxY - vv * (grid.maxY - grid.minY) };
}
