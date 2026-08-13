// SPACEFORCE — entry point: sim loop, input bindings, auto-reset.

import { Sim } from './physics.js';
import { Stage } from './scene.js';
import { Hud } from './hud.js';

const DEG = Math.PI / 180;
const sim = new Sim();
const stage = new Stage(document.getElementById('gl'));
const hud = new Hud(sim);

const $ = (id) => document.getElementById(id);

// ---- input ----------------------------------------------------------------
const pulseAmp = $('pulse-amp');
const pulseTau = $('pulse-tau');
const etaRef = $('eta-ref');

function syncSliders() {
  $('pulse-amp-v').textContent = (+pulseAmp.value).toFixed(2) + '°';
  $('pulse-tau-v').textContent = (+pulseTau.value).toFixed(2) + ' s';
  $('eta-ref-v').textContent = (+etaRef.value).toFixed(3);
  sim.etaRef = +etaRef.value;
}
[pulseAmp, pulseTau, etaRef].forEach(el => el.addEventListener('input', syncSliders));
syncSliders();

function firePulse() {
  sim.triggerPulse(+pulseAmp.value * DEG, +pulseTau.value);
}
function toggleAutopilot(force) {
  sim.autopilot = force !== undefined ? force : !sim.autopilot;
  $('ap-toggle').classList.toggle('on', sim.autopilot);
}
function toggleNoise() {
  sim.noise = !sim.noise;
  $('noise-toggle').classList.toggle('on', sim.noise);
}
function reset() {
  sim.reset();
  $('banner').classList.remove('show');
}

const keys = new Set();
window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  if (k === 'd' || k === 'arrowright') { keys.add('open'); e.preventDefault(); }
  if (k === 'a' || k === 'arrowleft') { keys.add('close'); e.preventDefault(); }
  if (k === ' ') { firePulse(); e.preventDefault(); }
  if (k === 't') toggleAutopilot();
  if (k === 'n') toggleNoise();
  if (k === 'r') reset();
  updateRate();
});
window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'd' || k === 'arrowright') keys.delete('open');
  if (k === 'a' || k === 'arrowleft') keys.delete('close');
  updateRate();
});
function updateRate() {
  sim.setManualRate((keys.has('open') ? 1 : 0) - (keys.has('close') ? 1 : 0));
}

// touch / click buttons
function holdButton(id, dir) {
  const el = $(id);
  const on = (e) => { e.preventDefault(); keys.add(dir); updateRate(); el.classList.add('held'); };
  const off = () => { keys.delete(dir); updateRate(); el.classList.remove('held'); };
  el.addEventListener('pointerdown', on);
  el.addEventListener('pointerup', off);
  el.addEventListener('pointerleave', off);
  el.addEventListener('pointercancel', off);
}
holdButton('btn-close', 'close');
holdButton('btn-open', 'open');
$('btn-pulse').addEventListener('click', firePulse);
$('ap-toggle').addEventListener('click', () => toggleAutopilot());
$('noise-toggle').addEventListener('click', toggleNoise);
$('btn-reset').addEventListener('click', reset);

// ---- loop -------------------------------------------------------------------
let last = performance.now();
let resetTimer = null;

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  sim.step(dt);
  stage.update(sim, now / 1000);
  hud.update(sim, dt);
  stage.render();

  if (sim.mode === 'DONE' && resetTimer === null) {
    resetTimer = setTimeout(() => { reset(); resetTimer = null; }, 2600);
  }
  requestAnimationFrame(frame);
}

document.getElementById('loading').classList.add('done');
requestAnimationFrame(frame);
