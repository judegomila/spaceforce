// SPACEFORCE — entry point: simulation loop, controls and modal UI.

import { Sim } from './physics.js';
import { Stage } from './scene.js';
import { Hud } from './hud.js';

const DEG = Math.PI / 180;
const sim = new Sim();
const stage = new Stage(document.getElementById('gl'));
const hud = new Hud(sim);
const $ = (id) => document.getElementById(id);

// ---- sliders ---------------------------------------------------------------
const pulseAmp = $('pulse-amp');
const pulseTau = $('pulse-tau');
const twistAmp = $('twist-amp');
const twistMode = $('twist-mode');
const etaRef = $('eta-ref');

function syncControls() {
  $('pulse-amp-v').textContent = (+pulseAmp.value).toFixed(2) + '°';
  $('pulse-tau-v').textContent = (+pulseTau.value).toFixed(2) + ' s';
  $('twist-amp-v').textContent = (+twistAmp.value).toFixed(1) + '°';
  $('eta-ref-v').textContent = (+etaRef.value).toFixed(3);
  sim.etaRef = +etaRef.value;
}
[pulseAmp, pulseTau, twistAmp, twistMode, etaRef]
  .forEach(el => el.addEventListener('input', syncControls));
syncControls();

function firePulse() {
  sim.triggerPulse(+pulseAmp.value * DEG, +pulseTau.value);
}

function fireCompoundPulse() {
  sim.triggerCompoundPulse(
    +pulseAmp.value * DEG,
    +pulseTau.value,
    +twistAmp.value * DEG,
    twistMode.value
  );
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

// ---- keyboard --------------------------------------------------------------
const keys = new Set();

function keyName(e) { return e.key.toLowerCase(); }

window.addEventListener('keydown', (e) => {
  const k = keyName(e);
  if (k === 'escape') { closeTheory(); return; }
  if (e.repeat) return;

  if (k === 'arrowright' || k === 'arrowup') { keys.add('open'); e.preventDefault(); }
  if (k === 'arrowleft' || k === 'arrowdown') { keys.add('close'); e.preventDefault(); }
  if (k === 'd') keys.add('right');
  if (k === 'a') keys.add('left');
  if (k === 'q') keys.add('l-neg');
  if (k === 'e') keys.add('l-pos');
  if (k === 'u') keys.add('r-neg');
  if (k === 'o') keys.add('r-pos');
  if (k === ' ') { firePulse(); e.preventDefault(); }
  if (k === 'c') fireCompoundPulse();
  if (k === 't') toggleAutopilot();
  if (k === 'n') toggleNoise();
  if (k === 'r') reset();
  updateRates();
});

window.addEventListener('keyup', (e) => {
  const k = keyName(e);
  if (k === 'arrowright' || k === 'arrowup') keys.delete('open');
  if (k === 'arrowleft' || k === 'arrowdown') keys.delete('close');
  if (k === 'd') keys.delete('right');
  if (k === 'a') keys.delete('left');
  if (k === 'q') keys.delete('l-neg');
  if (k === 'e') keys.delete('l-pos');
  if (k === 'u') keys.delete('r-neg');
  if (k === 'o') keys.delete('r-pos');
  updateRates();
});

function updateRates() {
  sim.setManualRate((keys.has('open') ? 1 : 0) - (keys.has('close') ? 1 : 0));
  // From the default camera, screen-right is -z in the rail frame.
  sim.setManualShift((keys.has('left') ? 1 : 0) - (keys.has('right') ? 1 : 0));
  const minus = (keys.has('l-pos') ? 1 : 0) - (keys.has('l-neg') ? 1 : 0);
  const plus = (keys.has('r-pos') ? 1 : 0) - (keys.has('r-neg') ? 1 : 0);
  sim.setManualTwist(minus, plus);
}

// ---- pointer controls ------------------------------------------------------
function holdButton(id, action) {
  const el = $(id);
  const on = (e) => {
    e.preventDefault();
    keys.add(action);
    updateRates();
    el.classList.add('held');
  };
  const off = () => {
    keys.delete(action);
    updateRates();
    el.classList.remove('held');
  };
  el.addEventListener('pointerdown', on);
  el.addEventListener('pointerup', off);
  el.addEventListener('pointerleave', off);
  el.addEventListener('pointercancel', off);
}

holdButton('btn-close', 'close');
holdButton('btn-open', 'open');
holdButton('btn-left', 'left');
holdButton('btn-right', 'right');
holdButton('btn-l-neg', 'l-neg');
holdButton('btn-l-pos', 'l-pos');
holdButton('btn-r-neg', 'r-neg');
holdButton('btn-r-pos', 'r-pos');

$('btn-pulse').addEventListener('click', firePulse);
$('btn-compound').addEventListener('click', fireCompoundPulse);
$('ap-toggle').addEventListener('click', () => toggleAutopilot());
$('noise-toggle').addEventListener('click', toggleNoise);
$('btn-reset').addEventListener('click', reset);

// ---- theory modal ----------------------------------------------------------
const modal = $('theory-modal');
function openTheory() {
  modal.classList.add('show');
  modal.setAttribute('aria-hidden', 'false');
}
function closeTheory() {
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
}
$('theory-open').addEventListener('click', openTheory);
$('theory-close').addEventListener('click', closeTheory);
modal.addEventListener('pointerdown', (e) => { if (e.target === modal) closeTheory(); });

// ---- animation loop --------------------------------------------------------
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
    resetTimer = setTimeout(() => {
      reset();
      resetTimer = null;
    }, 2600);
  }
  requestAnimationFrame(frame);
}

document.getElementById('loading').classList.add('done');
requestAnimationFrame(frame);
