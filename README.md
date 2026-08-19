# TSP Fund Rotation Dashboard

A **read-only** monitoring and decision-support dashboard for Thrift Savings Plan (TSP) fund
allocation. It tracks a *weighted blend* across the C, S, I, F, and G funds (real TSP accounts
are a mix, not 100% in one fund), ranks the five funds by trailing performance, and surfaces
when rebalancing is worth considering — while respecting TSP's actual transfer rules.

**It does not execute trades.** TSP has no public transaction API. Every real reallocation
still happens manually at [tsp.gov](https://www.tsp.gov). This tool is decision support and
record-keeping only, not investment advice, and not a guarantee of performance.

## Rules this tool encodes

- **Pricing**: TSP funds post one NAV per business day after market close — no intraday
  movement to track.
- **Cutoff**: reallocations submitted before 12:00pm ET execute at that day's close; after
  12:00pm ET, at the next business day's close.
- **Transfer limit**: two unrestricted reallocations per calendar month (any fund
  combination). After that, remaining reallocations that month can only move money **into**
  the G Fund (safe-harbor exception) — not back out into C/S/I/F. Resets on the 1st.
- **Standing defensive rule**: independent of the twice-monthly schedule, if your blended
  allocation draws down more than the configured trigger (default 8%) from its peak *since you
  last set it*, a G Fund safe-harbor signal fires immediately — that move is never capped.

See [`SPEC.md`](./SPEC.md) for the full build spec (v1 and v2, with a running "deviations" log).

## The allocation model

Your holding is a set of percentages across C/S/I/F/G summing to 100 — editable directly in
the "Your allocation" card, structured like TSP's own reallocation screen. Editing it updates
every calculation immediately (chart, ranking, signals) so you can explore "what if" freely.
It's a **snapshot as of your last update**, not auto-adjusted day to day as fund prices move —
nudge it periodically if real-world drift matters to you.

Clicking **"Log as real transfer on tsp.gov"** records that snapshot into the transfer log
(only do this after you've actually made the move) — this is what drives the monthly transfer
count and the audit trail, and it's guarded against two easy mistakes: logging something
identical to your last logged allocation (a no-op), and logging an exact duplicate entry for
the same date.

Rebalance signals propose a **tilt** by default — shifting a configurable slice (10-15pp,
default 12) from your current biggest laggard toward the ranked leader — rather than a full
swap. A **full rotation** mode (move everything to the leader) is selectable in Rules &
Strategy. Alongside a signal, the dashboard shows a **hindsight** comparison (what your blend
would have returned at 100% in the leader) — explicitly labeled as hindsight, not a forecast.

## Data source

Daily closing NAVs come straight from TSP's own published CSV:
`https://www.tsp.gov/data/fund-price-history.csv` — not a third-party proxy. It's fetched
server-side (`scripts/fetch-prices.js`, run from a GitHub Actions runner or locally) to avoid
browser CORS issues; the site itself only ever reads the committed
`public/data/tsp-prices.json`, never the live URL.

```bash
npm run fetch-prices   # re-pull from tsp.gov and rewrite public/data/tsp-prices.json
```

Every pull runs two integrity checks: a compounding self-consistency check per fund (blocks
the write if it fails — guards against a future bug in this script's own math), and a dated
reference-checkpoint comparison (currently: C/S/I YTD return through 2026-07-31, hand-verified
against an independent source when it was added) that warns — non-fatally, written into
`integrityWarnings` in the output — if the computed number drifts from the reference beyond
tolerance. More checkpoints can be appended in `scripts/fetch-prices.js` over time the same way.
This exists because a monthly-table source once under-reported a YTD figure during a strong
run (only current through the last *closed* month) — daily data avoids that by construction,
but a bad pull or broken parse could still slip through quietly without a check.

A scheduled workflow (`.github/workflows/update-prices.yml`) runs this automatically every
evening (~10:30-11:30pm ET) and commits the result. Weekend/holiday runs just re-fetch the
same closing data and no-op — TSP only posts one NAV per business day either way. **For the
bot's commit/push to succeed**, the repo needs *Settings → Actions → General → Workflow
permissions → "Read and write permissions"* enabled (the workflow's own
`permissions: contents: write` block covers the token scope, but the repo-level toggle also
needs to allow it).

## Backtest before trusting any live signal

```bash
npm run backtest -- --save
# or with explicit rules:
npm run backtest -- --window=3 --margin=2 --drawdown=8 --mode=tilt --tilt=12 \
  --alloc=C:50,S:30,I:20,F:0,G:0 --lfund=L2050 --save
```

Replays the full committed price history through the exact same rule engine
(`src/lib/metrics.js`, `src/lib/signals.js`) the live dashboard uses — starting from a real
weighted allocation, tracking per-fund unit holdings day-by-day so the equity curve reflects
actual buy-and-hold drift between rebalances, not just a snapshot. Compares the simulated
strategy's ending value against buy-and-holding the same starting blend, a static 100% C Fund,
and a static L Fund. Reports total return, CAGR, max drawdown, and **win rate** (% of monthly
periods the strategy beat static C) — not just total return, since a strategy that wins big
once and loses small often has an ugly track record that total-return alone hides.

`--save` (default path `public/data/backtest-results.json`) writes a summary the dashboard's
"Backtest results" card reads directly — if that file is missing or stale, the card says so
plainly rather than implying a run happened.

**Known finding, worth reading before tuning parameters**: with the current defaults (2pp
margin, tilt mode, 12pp tilt, ranking across all 5 funds including G), the strategy trades
close to the 2-transfer/month cap almost every month over the full 2003-2026 history (292
trades) and trails both static benchmarks by more than a wider-margin/full-rotation setup
would — a bare 2pp edge among five funds over a 3-month window is a fairly easy bar to clear,
so it fires often. Try a wider `--margin` or `--tilt` and compare before assuming the defaults
are what you want to run with.

Don't treat a live dashboard signal as real until this has been reviewed across multiple
market regimes (2008, 2020, and 2022 are all in the committed history) — and, per the spec,
until the signal has been paper-traded for 30+ days.

## Parameter sweep — does any rule set actually have an edge?

One backtest run only tells you the result for the parameters you typed in, not whether
they're good parameters. The sweep runs every combination of window × margin × drawdown ×
tilt in the grid below against the full history, ranks by win rate vs. static C Fund, then
re-checks the winner on two non-overlapping halves (2003-2018, 2019-2026) it wasn't
specifically picked from:

```bash
npm run sweep -- --save   # ~192 combinations, ~2 minutes; writes public/data/sweep-results.json
```

Grid: window ∈ {1, 3, 6} months, margin ∈ {1, 2, 3, 5} pp, drawdown ∈ {5, 8, 12, 15}%,
tilt ∈ {5, 10, 15, 20} pp (edit `GRID` in `scripts/sweep.js` to change it). Only a combination
that beats static C Fund's total return in the full period **and** both out-of-sample halves
gets treated as validated — the dashboard's "Parameter sweep" card and a caveat banner on the
Current Signal panel both reflect this pass/fail live, reading straight from the saved JSON.

**Actual finding from the committed history, as of this writing: FAIL.** 0 of 192 combinations
beat static C Fund over the full 2003-2026 period — a monster, mostly-uninterrupted C Fund bull
run is a hard benchmark for any strategy that spends time in other funds to clear. The single
best-by-win-rate combination (6mo/3pp/8%/20pp) does beat static C on 2003-2018 but *loses* to it
on 2019-2026, which is exactly the kind of period-dependent result the out-of-sample check
exists to catch. Per the spec: that's a real finding, not a bug — this family of rules
(trailing-return relative strength + a drawdown safety valve) doesn't have a demonstrated edge
over simply holding C Fund across this history. Every live signal should be read as
informational until/unless a future re-run of the sweep (different grid, different history,
different fund universe) finds something that actually passes.

## Local development

```bash
npm install
npm run fetch-prices   # seed public/data/tsp-prices.json if it isn't already committed
npm run backtest -- --save   # optional: populate the Backtest results card
npm run sweep -- --save      # optional: populate the Parameter sweep card
npm test                     # runs the blended-return unit test
npm start                    # http://localhost:3000
```

## State & persistence

This is a static site with no backend. Your allocation, transfer log, signal log, regime flag,
and thresholds all live in your browser's `localStorage` — nothing is sent anywhere. Clearing
site data resets the dashboard. The monthly transfer count is derived from the transfer log
itself (you log each real move after you make it on tsp.gov), so it's also your audit trail.

## Regime flag

Ships a manual risk-on/risk-off toggle, labeled as manual with a last-updated timestamp in the
UI. The spec calls for eventually wiring this to an HMM regime model; that model doesn't exist
in this repo yet — `RegimeToggle.jsx` is the integration point once it does.

## Deploy

Same pattern as this repo's sibling project, `finance-hub`: plain Create React App +
[`gh-pages`](https://www.npmjs.com/package/gh-pages), no Next.js.

```bash
npm run deploy   # builds and pushes /build to the gh-pages branch
```
