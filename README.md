# KLUSTER LAB

An interactive, browser-native simulator for the mechanics and strategy of **Kluster**: friction-pinned magnetic rigid bodies, rotational instability, tipping, magnetic capture, cascades, a movable cord boundary, and turn-based risk transfer.

The implementation accompanies Jude Gomila's 2026 paper, *A Mathematical Framework for Kluster: Friction-Pinned Magnetic Rigid Bodies, Hybrid Instabilities, Moving Boundaries, and Sequential Strategy*.

## Live model

The app is a zero-build static site deployed through Vercel and suitable for any ordinary static web server. It deliberately has no runtime framework or package dependency.

```bash
git clone https://github.com/judegomila/spaceforce.git
cd spaceforce
git switch kluster-lab
python3 -m http.server 4173
```

Open `http://localhost:4173`.

## What is simulated

Each stone is a planar rigid body with position, velocity, body angle, angular velocity, posture, mass, inertia, contact footprint, and a body-fixed magnetic dipole moment. The far-field pair potential is

\[
U_{ij}=\frac{C}{r^3}\left[\mathbf m_i\!\cdot\!\mathbf m_j-3(\mathbf m_i\!\cdot\!\hat{\mathbf r})(\mathbf m_j\!\cdot\!\hat{\mathbf r})\right].
\]

The simulator evaluates the corresponding dipole force and torque. Static pinning uses a reduced ellipsoidal contact-wrench guard,

\[
\chi=\sqrt{\left(\frac{\lVert\mathbf F\rVert}{\mu_sN}\right)^2+\left(\frac{\tau}{\mu_sN\rho}\right)^2}.
\]

A stone remains pinned for \(\chi<1\), subject to a separate tipping guard. Once the threshold is crossed, the model switches to kinetic friction and semi-implicit rigid-body integration. Contact is compliant. Attractive low-energy contacts create persistent capture joints, changing the contact graph and permitting hybrid cascades.

The held magnet is part of the dynamics **before release**, so a move is a trajectory through a time-dependent field rather than a final coordinate.

## Modes

### Laboratory

Load canonical mechanics experiments:

- side-by-side rotational saddle;
- rotation before translation;
- frustrated triangle;
- hand-triggered capture cascade;
- upright tipping tripwire;
- near-critical adversarial trap;
- deterministic seeded midgame.

Events remain visible on the board so the transition sequence can be inspected.

### Game

Play one to four players with 24 stones divided equally. The state transition follows exact inventory bookkeeping:

\[
\Delta n=-I+R,
\]

where \(I\) records whether the held stone was released and \(R\) is the number of affected stones returned to the player's inventory. A capture, contact with the held stone, or boundary exit ends the turn; the affected connected component is collected after the short physical resolution window.

## Risk-aware route planner

The risk map samples candidate held-stone positions and computes the maximum predicted force/torque/tipping utilization across the existing board and held stone. Two planners are provided:

- **Safe route:** minimizes predicted instability and rewards clearance.
- **Trap route:** searches below the threshold for a high-susceptibility terminal placement.

An A* solver finds a trajectory through the sampled reach-avoid state space. Route execution is intentionally separated from release: the user retains control of the terminal decision.

## Controls

| Input | Action |
|---|---|
| Pointer / touch | Move the held stone |
| Arrow keys or WASD | Translate the held stone |
| Mouse wheel, Q / E | Rotate dipole axis |
| P | Toggle flat / edge posture |
| Space | Release |
| G / H | Plan safe / trap route |
| V | Execute or stop planned route |
| T | Pause / resume |
| R | Reset current experiment |

The advanced panel exposes magnetic strength, static friction, damping, time scale, cord dimensions, pinch, and rotation. Field arrows, force vectors, labels, and stability halos can be toggled independently.

## Architecture

```text
index.html
css/style.css
js/
  main.js          browser entry point
  app-base.js      controls, modes, placement and route planning
  app-runtime.js   fixed-step loop, game rules and hybrid event resolution
  physics-core.js  dipole formulas and cord geometry
  world.js         friction, tipping, contact, capture and serialization
  physics.js       public mechanics exports
  pathfinding.js   sampled risk field and A* reach-avoid planner
  presets.js       canonical experiments and deterministic midgame generator
  renderer.js      high-DPI scientific canvas renderer
  ui.js            telemetry, controls, plots, logs, import/export
tests/              mathematical and planner regression tests
.github/workflows/  automated syntax and regression verification
```

The app uses a fixed-step physics clock and a decoupled render loop. State snapshots can be exported and re-imported as JSON. The separately delivered standalone source archive also includes the complete paper PDF, LaTeX, bibliography, figures, and figure-generation code.

## Verification

```bash
npm test
npm run check
```

The same commands run automatically in GitHub Actions for every push and pull request.

The regression suite checks:

- exact head-to-tail dipole energy, field, and force scaling;
- side-by-side radial repulsion and angular torque;
- signed cord margins;
- the reduced friction-wrench threshold;
- capture-joint creation and connected components;
- state serialization;
- safe-candidate construction;
- A* routing through a constrained gap;
- approach from an outside hand state to a legal interior release state;
- rejection of disconnected route spaces.

## Scientific scope and limitations

This is a **dimensionless reduced-order simulator**, not a calibrated prediction of a particular commercial set. Its purpose is to make the paper's mechanics executable and falsifiable.

The point-dipole approximation is reliable only in the far field. Near contact, the implementation softens and caps interactions rather than claiming a finite-magnet solution. The friction-wrench surface is an ellipsoidal approximation; irregular coating, pressure distributions, rolling resistance, and three-dimensional impacts are compressed into effective parameters. Capture is an energy/attraction criterion rather than a full finite-magnet adhesion model. Quantitative comparison with physical Kluster stones requires the measurement program described in the paper.

## Citation

```bibtex
@article{gomila2026kluster,
  author = {Jude Gomila},
  title = {A Mathematical Framework for Kluster: Friction-Pinned Magnetic Rigid Bodies, Hybrid Instabilities, Moving Boundaries, and Sequential Strategy},
  year = {2026},
  note = {Preprint}
}
```

## License

The simulator source is released under the MIT License. The paper remains attributable to Jude Gomila. “Kluster” is used descriptively to identify the game being modeled; this repository is an independent research and educational project.
