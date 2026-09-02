# Edge Calculator

A bankroll/edge-sizing strategy app grounded in five formulas from quantitative
betting theory: **expectancy**, **volatility**, **risk of ruin**, the **Kelly
criterion**, and **geometric (compounded) growth** vs. naive ensemble-average
growth.

## Core idea

This app does **not** predict outcomes. It doesn't guess who wins.

You (or your own model) supply a win-probability estimate `p` and payout odds
`b` for a bet with positive expected value. The app tells you:

- whether that edge is mathematically real,
- how volatile it is,
- how much of your bankroll it's safe to stake, and
- what actually happens to your bankroll over time if you bet that way.

The central theme, made visible throughout the UI: the **average** outcome
across many hypothetical parallel bettors is not what any single bettor
actually experiences. The real, single-path compounding rate is

```
g = μ - σ²/2
```

always lower than the naive average return — variance is the thing eating the
difference. Kelly-optimal sizing maximizes this long-run geometric growth
rate, not the average.

Because real probability estimates always carry error (a "55% edge" might
actually be 50.5%), and Kelly has no concept of that uncertainty, the app
defaults to **fractional Kelly** (½-Kelly) rather than full Kelly — trading
some growth rate for protection against a wrong `p`.

## Status

| Phase | What | Status |
|---|---|---|
| 1 | Edge calculator: expectancy, volatility, Kelly fraction, growth-rate curve | ✅ Done |
| 2 | Monte Carlo risk-of-ruin simulator (ensemble average vs. median/geometric path) | ✅ Done |
| 3 | Bankroll tracker: log real bets, track realized vs. theoretical growth, drawdown | 🔜 Next |
| 4 | Probability estimation model (calibrated `p`, Brier score, backtesting) | Stretch |
| 5 | Portfolio Kelly for correlated concurrent bets | Stretch |

### Phase 1 — Edge calculator

Inputs: win probability `p`, net payout odds `b` (a win pays `b`× stake),
bankroll size, and a fractional-Kelly toggle (Full / ½ / ¼).

Computes and displays:

- **Expectancy** `E = p·b - q` (expected value per unit staked)
- **Standard deviation** `σ = sqrt(p·q·(b+1)²)` of a single bet's outcome
- **Kelly fraction** `f* = (b·p - q) / b`, clamped to 0 when there's no edge
- **Growth-rate curve** `g(f) = p·ln(1+f·b) + q·ln(1-f)` plotted across stake
  fractions 0–100% of bankroll, with markers at full-Kelly and half-Kelly
- **Recommended stake in dollars** = `f* × fractional multiplier × bankroll`

If expectancy is not positive, the calculator refuses to recommend a stake
and shows a "no edge — do not bet" warning instead.

The formulas live in [`src/lib/edge.ts`](src/lib/edge.ts) as pure, dependency-free
functions, unit-tested in [`src/lib/edge.test.ts`](src/lib/edge.test.ts) against known
values (the textbook 55%-edge coin-flip example: `E = 0.10`, `f* = 10%`,
growth rate ≈ 0.501%/bet at full Kelly).

### Phase 2 — Risk-of-ruin simulator

Simulates `N` independent bettors each making `M` sequential bets under a
chosen sizing rule — either **proportional** (stake resizes with current
bankroll, e.g. Kelly-style) or **flat** (stake stays fixed in dollar terms,
sized as a fraction of the *starting* bankroll). This is a real simulation,
not the closed-form ruin formula, because the closed-form version assumes a
fixed bet size in bankroll units — real bettors re-size every bet.

For each rule it reports:

- the **ruin rate** — % of simulated bettors whose bankroll ever dropped to
  ≤1% of their starting bankroll,
- the **ensemble average** bankroll path over time, and
- the **median** (typical single-path) bankroll over time,

plotted together on a log-scale fan chart alongside a sample of individual
paths. The average and median visibly diverge — on the default 55%-edge,
½-Kelly scenario, the ensemble average overstates the typical bettor's
outcome by roughly 1.4–1.5×. A side-by-side comparison (Full Kelly / ½ Kelly
/ flat betting / 2× Kelly) shows over-betting sharply increasing ruin risk
(2× Kelly runs ~20% ruin vs. ~0% for ½ Kelly in the same scenario).

The simulation engine lives in [`src/lib/simulate.ts`](src/lib/simulate.ts) (a
seeded, reproducible PRNG plus pure simulate functions), unit-tested in
[`src/lib/simulate.test.ts`](src/lib/simulate.test.ts) — including a direct test that
the ensemble mean exceeds the median (the "average is a lie" effect) and that
2× Kelly ruins more often than full Kelly.

## Tech stack

Next.js (App Router) + TypeScript + Tailwind CSS, fully client-side for now —
the formulas and Monte Carlo simulations are cheap enough to run in-browser.
No backend yet; one may be added in Phase 3 for persisting a real bankroll
tracker, and possibly Phase 4 if a Python ML service is needed for the
probability model.

Testing: [Vitest](https://vitest.dev) for the math module.

## Getting started

```bash
npm install
npm run dev      # http://localhost:3000
npm run test     # unit tests for the formula module
npm run build    # production build
npm run lint
```
