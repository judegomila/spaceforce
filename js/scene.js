// SPACEFORCE — Three.js apparatus, independently twisting rods, scoring deck,
// ball, predicted-release ring and star field.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { P } from './physics.js';

const AMBER = 0xffb454;
const CYAN = 0x4fd8cf;

export class Stage {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x04060b);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.01, 40);
    this.camera.position.set(0.56, 0.30, 0.50);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0.21, -0.01, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.12;
    this.controls.maxDistance = 2.2;
    this.controls.maxPolarAngle = 1.48;

    this.buildLights();
    this.buildStars();
    this.buildFloor();
    this.buildRig();

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  buildLights() {
    const key = new THREE.DirectionalLight(0xfff2df, 2.6);
    key.position.set(0.7, 1.1, 0.8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const c = key.shadow.camera;
    c.left = -0.5; c.right = 0.8; c.top = 0.5; c.bottom = -0.5;
    c.near = 0.2; c.far = 4;
    key.shadow.bias = -0.0004;
    this.scene.add(key);

    const rim = new THREE.PointLight(CYAN, 1.4, 3);
    rim.position.set(-0.5, 0.25, -0.55);
    this.scene.add(rim);
    this.scene.add(new THREE.HemisphereLight(0x27384d, 0x0a0705, 0.65));
  }

  buildStars() {
    const N = 1400;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const rad = 5 + 6 * Math.random();
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      pos[3 * i] = rad * Math.sin(ph) * Math.cos(th);
      pos[3 * i + 1] = Math.abs(rad * Math.cos(ph)) - 1.2;
      pos[3 * i + 2] = rad * Math.sin(ph) * Math.sin(th);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x9dbdd8, size: 0.014, sizeAttenuation: true,
      transparent: true, opacity: 0.75, depthWrite: false,
    });
    this.scene.add(new THREE.Points(geo, mat));
  }

  buildFloor() {
    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(3.2, 64),
      new THREE.MeshStandardMaterial({ color: 0x090c12, roughness: 0.95, metalness: 0.05 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.155;
    floor.receiveShadow = true;
    this.scene.add(floor);
  }

  makeRod(railLen, chrome, markerColor) {
    // Outer group handles yaw/opening; inner group rotates about local x.
    const outer = new THREE.Group();
    const spin = new THREE.Group();
    outer.add(spin);

    const rodGeo = new THREE.CylinderGeometry(P.r, P.r, railLen, 32);
    rodGeo.rotateZ(-Math.PI / 2);
    rodGeo.translate(railLen / 2, 0, 0);
    const rod = new THREE.Mesh(rodGeo, chrome);
    rod.castShadow = true;
    spin.add(rod);

    // A long colored witness line makes an otherwise axisymmetric twist visible.
    const stripeGeo = new THREE.BoxGeometry(railLen * 0.96, 0.00115, 0.00115);
    stripeGeo.translate(railLen * 0.50, 0, 0);
    const stripe = new THREE.Mesh(
      stripeGeo,
      new THREE.MeshBasicMaterial({ color: markerColor, toneMapped: false })
    );
    stripe.position.set(0, P.r * 0.72, P.r * 0.72);
    spin.add(stripe);

    // End knob and radial witness pin rotate with the rod.
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.0075, 24, 16), chrome);
    knob.position.set(railLen, 0, 0);
    knob.castShadow = true;
    spin.add(knob);

    const pin = new THREE.Mesh(
      new THREE.BoxGeometry(0.003, 0.0015, 0.011),
      new THREE.MeshBasicMaterial({ color: markerColor, toneMapped: false })
    );
    pin.position.set(railLen + 0.0005, 0, 0.006);
    spin.add(pin);

    // Thin witness rings show the local rod axis.
    for (const f of [0.22, 0.48, 0.74]) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(P.r * 1.015, 0.00035, 6, 32),
        new THREE.MeshBasicMaterial({ color: markerColor, transparent: true, opacity: 0.42 })
      );
      ring.rotation.y = Math.PI / 2;
      ring.position.x = railLen * f;
      spin.add(ring);
    }

    return { outer, spin };
  }

  buildRig() {
    // Rail frame: x along rails, y normal to rail-center plane, z transverse.
    this.rig = new THREE.Group();
    this.rig.rotation.z = P.beta;
    this.scene.add(this.rig);

    const chrome = new THREE.MeshStandardMaterial({
      color: 0xd9dee4, metalness: 1.0, roughness: 0.14, envMapIntensity: 1.25,
    });

    this.arms = new THREE.Group();
    this.rig.add(this.arms);

    const railLen = P.L + 0.02;
    const plus = this.makeRod(railLen, chrome, AMBER);
    const minus = this.makeRod(railLen, chrome, CYAN);
    this.rodP = plus.outer;
    this.rodPSpin = plus.spin;
    this.rodM = minus.outer;
    this.rodMSpin = minus.spin;
    this.rodP.position.z = +P.d0 / 2;
    this.rodM.position.z = -P.d0 / 2;
    this.arms.add(this.rodP, this.rodM);

    const hingeMat = new THREE.MeshStandardMaterial({ color: 0x2a313c, metalness: 0.7, roughness: 0.45 });
    const hinge = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.013, 0.036, 24), hingeMat);
    hinge.position.set(-0.004, -0.012, 0);
    hinge.castShadow = true;
    this.arms.add(hinge);

    this.buildBoard();

    const ballTex = this.makeBallTexture();
    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(P.R, 48, 32),
      new THREE.MeshStandardMaterial({
        map: ballTex, metalness: 1.0, roughness: 0.09, envMapIntensity: 1.4,
      })
    );
    this.ball.rotation.order = 'XYZ';
    this.ball.castShadow = true;
    this.rig.add(this.ball);

    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(P.a * 1.55, 0.0011, 8, 48),
      new THREE.MeshBasicMaterial({ color: AMBER, transparent: true, opacity: 0.45 })
    );
    this.ring.rotation.y = Math.PI / 2;
    this.rig.add(this.ring);
  }

  buildBoard() {
    this.boardCanvas = document.createElement('canvas');
    this.boardCanvas.width = 2048;
    this.boardCanvas.height = Math.round(2048 * P.boardW / P.boardLen);
    this.boardTex = new THREE.CanvasTexture(this.boardCanvas);
    this.boardTex.anisotropy = 8;
    this.boardTex.colorSpace = THREE.SRGBColorSpace;
    this.drawBoard();
    if (document.fonts?.ready) document.fonts.ready.then(() => this.drawBoard());

    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(P.boardLen, P.boardW),
      new THREE.MeshStandardMaterial({ map: this.boardTex, roughness: 0.85, metalness: 0.15 })
    );
    board.rotation.x = -Math.PI / 2;
    board.position.set(P.boardLen / 2 - 0.05, -P.dropH, 0);
    board.receiveShadow = true;
    this.rig.add(board);

    const rimMat = new THREE.MeshStandardMaterial({ color: AMBER, metalness: 0.85, roughness: 0.35 });
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x05070a, roughness: 0.95, side: THREE.DoubleSide });
    for (const h of P.holes) {
      const rim = new THREE.Mesh(new THREE.TorusGeometry(h.r, 0.0012, 12, 48), rimMat);
      rim.rotation.x = Math.PI / 2;
      rim.position.set(h.x, -P.dropH + 0.0008, 0);
      this.rig.add(rim);

      const wall = new THREE.Mesh(new THREE.CylinderGeometry(h.r, h.r, 0.05, 32, 1, true), wallMat);
      wall.position.set(h.x, -P.dropH - 0.025, 0);
      this.rig.add(wall);

      const base = new THREE.Mesh(new THREE.CircleGeometry(h.r, 32), wallMat);
      base.rotation.x = -Math.PI / 2;
      base.position.set(h.x, -P.dropH - 0.049, 0);
      this.rig.add(base);
    }

    const cab = new THREE.Mesh(
      new THREE.BoxGeometry(P.boardLen + 0.05, 0.06, P.boardW + 0.045),
      new THREE.MeshStandardMaterial({ color: 0x0e131b, roughness: 0.8, metalness: 0.25 })
    );
    cab.position.set(P.boardLen / 2 - 0.05, -P.dropH - 0.032, 0);
    cab.castShadow = true;
    cab.receiveShadow = true;
    this.rig.add(cab);

    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(cab.geometry),
      new THREE.LineBasicMaterial({ color: 0x33415a, transparent: true, opacity: 0.6 })
    );
    edges.position.copy(cab.position);
    this.rig.add(edges);
  }

  makeBallTexture() {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#eef1f4';
    g.fillRect(0, 0, 512, 256);
    g.fillStyle = 'rgba(70,84,98,0.55)';
    for (let i = 0; i < 4; i++) g.fillRect(i * 128, 0, 26, 256);
    g.fillStyle = 'rgba(255,180,84,0.6)';
    g.fillRect(64, 0, 8, 256);
    g.fillStyle = 'rgba(79,216,207,0.55)';
    g.fillRect(320, 0, 7, 256);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  drawBoard() {
    const c = this.boardCanvas, g = c.getContext('2d');
    const W = c.width, H = c.height;
    const sx = W / P.boardLen;
    const px = (x) => (x + 0.05) * sx;

    const grad = g.createLinearGradient(0, 0, W, 0);
    grad.addColorStop(0, '#0a0f16');
    grad.addColorStop(1, '#0c1420');
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);

    g.strokeStyle = 'rgba(50,86,120,0.18)';
    g.lineWidth = 2;
    for (let x = 0; x <= P.boardLen; x += 0.02) {
      g.beginPath(); g.moveTo(px(x - 0.05), 0); g.lineTo(px(x - 0.05), H); g.stroke();
    }
    for (let y = 0; y < H; y += H / 8) {
      g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
    }

    g.strokeStyle = 'rgba(255,180,84,0.3)';
    g.setLineDash([18, 14]);
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
    g.setLineDash([]);

    for (const h of P.holes) {
      const cx = px(h.x), rad = h.r * sx;
      g.fillStyle = '#020305';
      g.beginPath(); g.arc(cx, H / 2, rad, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(255,180,84,0.85)';
      g.lineWidth = 4;
      g.beginPath(); g.arc(cx, H / 2, rad + 8, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = 'rgba(255,180,84,0.28)';
      g.beginPath(); g.arc(cx, H / 2, rad + 22, 0, Math.PI * 2); g.stroke();

      g.fillStyle = h.score === 1000 ? '#ffb454' : 'rgba(215,224,232,0.9)';
      g.font = `600 ${h.score === 1000 ? 40 : 46}px Michroma, monospace`;
      g.textAlign = 'center';
      g.fillText(h.score === 1000 ? '1000' : h.label, cx, H / 2 - rad - 34);
      if (h.score === 1000) {
        g.font = '600 26px Michroma, monospace';
        g.fillText('SPACE FORCE', cx, H / 2 + rad + 52);
      }
    }

    g.fillStyle = 'rgba(120,140,160,0.55)';
    g.font = '500 22px "IBM Plex Mono", monospace';
    g.textAlign = 'left';
    g.fillText('COMPLIANT HYBRID MECHANICS · INDEPENDENT ROD TWIST · J. GOMILA 2026', 24, H - 20);
    this.boardTex.needsUpdate = true;
  }

  update(sim, time) {
    this.rodP.rotation.y = -sim.alpha;
    this.rodM.rotation.y = +sim.alpha;
    this.rodPSpin.rotation.x = sim.phiPlus;
    this.rodMSpin.rotation.x = sim.phiMinus;

    if (sim.mode === 'ROLL') {
      this.ball.position.set(sim.x, P.a * sim.delta, sim.zRel);
    } else if (sim.flight) {
      this.ball.position.set(sim.flight.x, sim.flight.y, sim.flight.z);
    }
    this.ball.rotation.x = sim.spinXAngle;
    this.ball.rotation.z = -sim.spinAngle;

    const xPred = sim.predictReleaseX();
    const showRing = sim.mode === 'ROLL' && xPred < P.L;
    this.ring.visible = showRing;
    if (showRing) {
      this.ring.position.set(xPred, 0.002, sim.zRel);
      this.ring.material.opacity = 0.3 + 0.25 * Math.sin(time * 5);
    }

    this.controls.update();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
