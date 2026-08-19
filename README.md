# TSP Fund Rotation Dashboard

A **read-only** monitoring and decision-support dashboard for Thrift Savings Plan (TSP) fund
allocation. It tracks the C, S, I, F, and G funds, ranks them by trailing performance, and
surfaces when a reallocation is worth considering — while respecting TSP's actual transfer
rules.

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
- **Standing defensive rule**: independent of the twice-monthly schedule, if your current
  holding draws down more than the configured trigger (default 8%) from its peak *since you
  entered it*, a G Fund safe-harbor signal fires immediately — that move is never capped.

See [`SPEC.md`](./SPEC.md) (if present) for the full original build spec.

## Data source

Daily closing NAVs come straight from TSP's own published CSV:
`https://www.tsp.gov/data/fund-price-history.csv` — not a third-party proxy. It's fetched
server-side (`scripts/fetch-prices.js`, run from a GitHub Actions runner or locally) to avoid
browser CORS issues; the site itself only ever reads the committed
`public/data/tsp-prices.json`, never the live URL.

```bash
npm run fetch-prices   # re-pull from tsp.gov and rewrite public/data/tsp-prices.json
```

A scheduled workflow (`.github/workflows/update-prices.yml`) runs this automatically most
weekday evenings and commits the result. **For the bot's commit/push to succeed**, the repo
needs *Settings → Actions → General → Workflow permissions → "Read and write permissions"*
enabled (the workflow's own `permissions: contents: write` block covers the token scope, but
the repo-level toggle also needs to allow it).

## Backtest before trusting any live signal

```bash
npm run backtest -- --window=3 --margin=2 --drawdown=8 --lfund=L2050
```

Replays the full committed price history through the exact same rule engine
(`src/lib/metrics.js`, `src/lib/signals.js`) the live dashboard uses, and compares the
simulated rotation strategy against a static 100% C Fund holding and a static L Fund. Reports
total return, CAGR, max drawdown, and **win rate** (% of monthly periods the rotation beat
static C) — not just total return, since a strategy that wins big once and loses small often
has an ugly track record that total-return alone hides.

Don't treat a live dashboard signal as real until this has been reviewed across multiple
market regimes (2008, 2020, and 2022 are all in the committed history) — and, per the original
spec, until the signal has been paper-traded for 30+ days.

## Local development

```bash
npm install
npm run fetch-prices   # seed public/data/tsp-prices.json if it isn't already committed
npm start               # http://localhost:3000
```

## State & persistence

This is a static site with no backend. Your current holding, transfer log, signal log, regime
flag, and thresholds all live in your browser's `localStorage` — nothing is sent anywhere.
Clearing site data resets the dashboard. The monthly transfer count is derived from the
transfer log itself (you log each real move after you make it on tsp.gov), so it's also your
audit trail.

## Regime flag

v1 ships a manual risk-on/risk-off toggle only. The original spec calls for wiring this to an
HMM regime model; that model doesn't exist in this repo yet — `RegimeToggle.jsx` is the
integration point once it does.

## Deploy

Same pattern as this repo's sibling project, `finance-hub`: plain Create React App +
[`gh-pages`](https://www.npmjs.com/package/gh-pages), no Next.js.

```bash
npm run deploy   # builds and pushes /build to the gh-pages branch
```
