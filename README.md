# SPACEFORCE

**A 3D, real-time simulator of the Space Force / Shoot-the-Moon two-rail ball game**, implementing the reduced hybrid model from:

> J. Gomila, *Risk-Optimal Pulsed Control of a Variable-Separation Two-Rail Ball Game — A compliant hybrid model of the Space Force / Shoot-the-Moon mechanism* (2026). [`paper.pdf`](paper.pdf)

A steel ball rides two player-controlled rods that rise uphill. Opening the rods lowers the ball relative to the rails — geometric competition that produces apparent uphill motion. Score by releasing the ball into one of six apertures; the 1000-point **SPACE FORCE** cup demands a high-speed terminal release, where timing risk is greatest.

## Physics (paper → code)

The simulation core (`js/physics.js`) is a direct implementation of the paper's compact reduced model (Appendix B) plus its guards and hybrid transitions:

| Paper | Implementation |
|---|---|
| Eq. B.1 — geometry `d = d0 + 2x·tanα`, `η = d/2(R+r)`, `δ = √(1−η²)` | `etaCmd()`, `stepRoll()` |
| Eq. 3.5 — effective mass `M = m(1 + κ/δ²)` | `stepRoll()` |
| Eq. 3.7 / B.3 — reduced Lagrange equation `Mv̇ + ½Mₓv² + Mₐα̇v + Vₓ = −F_d` | `stepRoll()` |
| Eq. 5.2 — rolling resistance `F_d = μᵣmg·cosβ/δ·sgn(v) + c₁v + c₂|v|v` | `stepRoll()` (regularized `tanh`) |
| Eq. 5.3 — no-slip feasibility `‖F_t‖ ≤ μₛN` | traction cap + microslip mode M2 |
| Eq. 7.4–7.6 — compliance closure `η = η_c + Λη/δ`, fold at `δ* = Λ^{1/3}` | `solveEta()` — fixed-point divergence **is** the snap-through release |
| Eq. 8.2 — free flight after release | `stepFlight()` (modes M4/M5) |
| §8 hybrid modes — a missed drop rolls on the wood deck | `stepBoard()` — incline gravity + rolling resistance; the ball drops into the first hole it rolls over, or rolls back down the incline to the tray |
| Eq. 5.4–5.7, 8.3 — admissibility guards `G_geom, G_fold, G_N, G_μ, G_ω` | live guard bars in the HUD |
| Eq. 6.4 — finite open–close pulse `α(t) = α₀ + A·f((t−t_p)/τ_p)` | `triggerPulse()` (Gaussian, high-authority per Prop. 10.1) |
| Eq. 9.5–9.6 — hit probability `p_hit(v) = erf(Δx / 2√2·√(σₓ²+v²σ_t²))` | `pHit()` — live risk readout |

The **Mₐα̇v** term is what makes pulsing work: closing the rails while the ball moves injects energy (Eq. 6.3, "pulsing the ball"). The **compliance fold** means the rails snap open before the rigid limit η → 1 — the hidden hazard of terminal high-speed play. Watch the ball's spin diverge as δ → 0 (Remark 4.3).

## Controls

| Input | Action |
|---|---|
| `→` / `↑` (hold) | Open rails |
| `←` / `↓` (hold) | Close rails |
| `A` / `D` (hold) | Translate the lever-arm assembly left / right — cups sit on the centerline, so aim laterally before release |
| `SPACE` | Fire an open–close pulse (amplitude & width sliders) |
| `T` | Autopilot: boundary-ride at η_ref — the paper's risk dial. Higher η_ref = faster, closer to release |
| `N` | Timing noise: adds Gaussian actuation jitter (σ_t) |
| `R` | Reset |
| Mouse drag / wheel | Orbit / zoom camera |

The HUD shows a live **phase portrait** (x, v) with the capture corridor into your selected target, a **release predictor** (η(x) at the current opening, with the fold line η*), and all five admissibility guards.

## Strategy notes

- Fully open from the start and the fold releases you at x ≈ 0.11 m → the 100 cup. To go deeper, **close as you climb**, riding η just under the fold.
- The 1000 cup sits past the end of the rails: you must arrive at the rail tips with v ≈ 0.30–0.42 m/s. `p_hit` falls strictly with speed (Prop. 9.2) — the maximum score is a boundary-riding risk problem.
- Try one strong pulse mid-board versus many small ones (Conjecture 10.2).

## Run locally

Static site — any file server works:

```sh
npx serve .
# or: python3 -m http.server
```

## Deploy

Deployed on Vercel as a static site (no build step). Three.js is loaded from CDN via an import map.

## Structure

```
index.html      shell + HUD DOM
css/style.css   mission-control instrument styling
js/physics.js   reduced hybrid model (the paper, in code)
js/scene.js     Three.js apparatus, deck, ball, release ring
js/hud.js       telemetry, guards, phase portrait, predictor
js/main.js      loop + input
paper.pdf       the paper
```
