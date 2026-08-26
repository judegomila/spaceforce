# SPACEFORCE

**A real-time 3D mechanics and control simulator for the Space Force / Shoot-the-Moon two-rail ball game.**

The app implements the reduced model and experimental program developed in:

> Jude Gomila, *Complete Mechanics and Risk-Optimal Control of a Variable-Separation Two-Rail Ball Game: Independent Rod Attitude, Axial Twist, Compliance, Hybrid Release, and Maximum-Score Strategy* (2026).  
> [`paper.pdf`](paper.pdf) · [`paper.tex`](paper.tex)

Live app: **https://spaceforce-chi.vercel.app/**

A steel ball rides two player-controlled rods that rise along the board. Opening the rods lowers the ball relative to their centerlines, creating the geometric drive that permits apparent uphill motion. The player can also rotate each rod independently through a nominal range of about **±5°**, creating common and differential twist modes, moving contact surfaces, axial ball spin, steering, traction demand, and—outside the exact parallel circular limit—weak propulsion or braking.

## Prior work and attribution

The rigid-body foundation is due to **Peng Xu, Richard E. Groff, and Timothy C. Burg**.

- Peng Xu's 2011 Clemson thesis, [*Dynamics and Control of the Shoot-the-Moon Tabletop Game*](https://open.clemson.edu/all_theses/1209/), developed the kinematics, derived the equations of motion using Lagrangian and Newtonian approaches, identified the system as underactuated, nonlinear, and nonholonomic, designed linearized and nonlinear position controllers, constructed an automated apparatus, compared experiment with simulation, and demonstrated the nonholonomic translation–rotation constraint.
- Xu, Groff, and Burg's 2012 ASME article, [*Dynamics and Control of the Shoot-the-Moon Tabletop Game*](https://doi.org/10.1115/1.4006223), presented the rigid dynamics and experimental nonlinear position control in journal form.
- Xu also explicitly identified the rapid **shoot** mechanism as an interaction between ball rotation and translation.

This repository does **not** claim the first model or controller for the game. It uses that validated rigid-body program as its foundation and extends the game in a different direction: rolling loss, friction guards, flexible rods, torsional phase lag, moving rod surfaces, independent axial twist, hybrid contact loss, ballistic scoring, viability boundaries, timing risk, and maximum-score optimal control.

## What is new in this simulator

The current app adds the following mechanics to the earlier version:

1. **Independent rod angles** `phiMinus` and `phiPlus`, each bounded by the nominal range `|phi_i| <= 5°`.
2. **Common twist**

   ```text
   phi_c = (phiPlus + phiMinus)/2
   omega_x = -(r/R) phi_c_dot
   ```

   which commands ball spin about the longitudinal rail direction in the local parallel circular limit.

3. **Differential twist**

   ```text
   phi_Delta = (phiMinus - phiPlus)/2
   eta z_dot = r phi_Delta_dot
   ```

   represented in the app by a small compliant cross-sectional steering state and a live twist-compatibility residual.

4. **Full-geometry longitudinal coupling**

   ```text
   v_x_twist = r phi_i_dot (t_i x n_i) . e_x
   ```

   represented by a deliberately weak, tunable reduced-order force. It vanishes in the exact parallel circular idealization and is not presented as a calibrated coefficient for a particular commercial machine.

5. **Compound opening–twist pulses** with common, differential, or phased twist modes.
6. **Visible rod rotation** using witness stripes and end markers on both rods.
7. **Additional guards** for axial-angle range and differential-twist compatibility.
8. **An in-app model note** explaining the provenance and the twist equations.

## Physics: paper to code

The simulation core is in [`js/physics.js`](js/physics.js).

| Paper/model element | Implementation |
|---|---|
| `d = d0 + 2x tan(alpha)`, `eta = d/[2(R+r)]`, `delta = sqrt(1-eta^2)` | `etaCmd()`, `solveEta()`, `stepRoll()` |
| `M = m(1 + kappa/delta^2)` | `stepRoll()` |
| `M vdot = -Vx - 1/2 Mx v^2 - M_alpha alphaDot v - Fd + F_phi` | `stepRoll()` |
| Rolling resistance and aerodynamic/viscous losses | `Fd` in `stepRoll()` |
| Static-friction feasibility and microslip | `FtReq`, `FtCap`, `slip` |
| Compliance closure and fold release | `solveEta()` and `etaCmdFold` |
| Hybrid free flight, capture, deck roll, and miss | `release()`, `stepFlight()`, `stepBoard()` |
| `omega_x = -(r/R) phi_c_dot` | `updateTwistKinematics()` |
| `eta z_dot = r phi_Delta_dot` | `zRel`, `zRelDot`, `sDelta` |
| Divergence-mediated twist coupling | `vTwist`, `Fphi` |
| Finite opening pulse | `triggerPulse()` |
| Vector opening–twist pulse | `triggerCompoundPulse()` |
| Timing-risk hit probability | `pHit()` and HUD readout |
| Target-specific capture corridor | `Hud.drawPhase()` |

The compliant support fold means the rails can lose the stable support branch before the rigid limit `eta -> 1`. The app treats this as a snap-through release event. The phase portrait shows the current trajectory and target capture corridor; the release predictor shows the current `eta(x)` curve and fold line.

## Controls

| Input | Action |
|---|---|
| `Right` / `Up` | Open rods |
| `Left` / `Down` | Close rods |
| `A` / `D` | Translate the complete rod assembly laterally |
| `Q` / `E` | Rotate the left rod negative / positive |
| `U` / `O` | Rotate the right rod negative / positive |
| `Space` | Opening pulse |
| `C` | Compound opening–twist pulse |
| `T` | Boundary-riding autopilot |
| `N` | Gaussian timing noise |
| `R` | Reset |
| Mouse drag / wheel | Orbit / zoom camera |

The compound-pulse selector offers:

- **Common**: both rods rotate together, primarily generating axial ball spin.
- **Differential**: rods rotate oppositely, producing cross-sectional steering demand.
- **Phased**: one rod leads the other, mixing common/differential twist and the reduced full-geometry propulsion/slip channel.

## Strategy experiment

The central falsifiable question is whether an unconstrained maximum-score controller discovers:

```text
capture -> accelerate -> one dominant intermediate compound pulse
        -> high-speed viability-boundary ride -> terminal release
```

The app is an exploratory reduced-order simulator, not yet a calibrated digital twin. The nominal ±5° axial-angle range, twist coupling, friction, compliance, and target geometry should all be measured on a physical unit before quantitative optimality claims are made.

## Run locally

```sh
npx serve .
# or
python3 -m http.server
```

Then open the local URL in a browser. Three.js is loaded from a CDN through the import map in `index.html`.

## Deploy

The repository is configured as a static Vercel site with no build step. A push to `main` triggers the connected Vercel deployment.

## Structure

```text
index.html          app shell, HUD, controls and model modal
css/style.css       mission-control presentation
js/physics.js       compliant hybrid opening–twist mechanics
js/scene.js         Three.js apparatus and visible rod rotation
js/hud.js           telemetry, guards and phase diagrams
js/main.js          simulation loop and input bindings
paper.pdf           complete paper
paper.tex           LaTeX source
README.md           model, attribution and usage guide
```
