# Contributing

Contributions should preserve the distinction between a reduced explanatory model and a calibrated physical prediction.

1. Add or update a regression test for any physics or rule change.
2. State the model assumption behind any new force, contact, or capture law.
3. Keep the fixed-step dynamics deterministic for identical inputs.
4. Do not silently fit parameters to a visual outcome; record calibration data and units.
5. Run `npm test` and `npm run check` before opening a pull request.

Useful research extensions include finite-magnet field models, measured contact-wrench surfaces, three-dimensional rocking/rolling, calibrated uncertainty distributions, and policy evaluation across game states.
