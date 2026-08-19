# TSP Fund Rotation Dashboard — Build Spec

> Original project brief, kept for reference across sessions. Note: a few
> details were superseded during the build — see the "Deviations from this
> spec" section at the bottom and [README.md](./README.md) for what was
> actually built and why.

## 1. What this is

A read-only monitoring and decision-support dashboard for Thrift Savings Plan (TSP) fund allocation. It tracks the C, S, I, F, and G funds, ranks them by trailing performance, and surfaces when a reallocation is worth considering, while respecting TSP's actual transfer rules. It does not execute trades. TSP has no public transaction API, so any real reallocation still happens manually on tsp.gov.

## 2. Ground-truth rules to encode correctly

Get these right before anything else, the whole tool is built on top of them:

* Pricing: TSP funds post one NAV per business day, calculated after market close. There is no intraday price movement to track.
* Cutoff: reallocation requests submitted before 12:00pm ET execute at that day's closing price. Requests submitted after 12:00pm ET execute at the next business day's closing price.
* Transfer limit: two unrestricted reallocations per calendar month, can move into any fund combination. After those two are used, any remaining reallocations that month can only move money INTO the G Fund (the safe-harbor exception), not back out into C/S/I/F. The count resets on the 1st of each calendar month.
* Funds tracked:
   * C Fund: large-cap US stock, tracks the S&P 500
   * S Fund: small/mid-cap US stock, tracks the Dow Jones US Completion TSM
   * I Fund: international stock, tracks MSCI EAFE
   * F Fund: US bonds, tracks the Bloomberg US Aggregate Bond Index
   * G Fund: government securities, essentially flat and steadily accruing, treat as the risk-free rate, not a market-moving series

## 3. Data source

Use TSP's own published prices, not proxy ETFs, this is what makes the numbers accurate instead of approximate:

* Official: tsp.gov/share-price-history (likely renders as an interactive chart, more work to scrape reliably)
* Practical: tspfolio.com publishes a single CSV of daily closing prices for all five funds back to June 2003, this is the easier source to pull programmatically

CORS note: fetching that CSV directly from the browser at runtime will likely fail, it's a cross-origin request to a third-party site with no guarantee of permissive CORS headers. Don't build this as a client-side fetch. Instead:

* Set up a scheduled GitHub Actions workflow that fetches the source CSV server-side (no CORS issue from a CI runner), computes derived fields, and commits an updated JSON file into the repo (e.g. `/data/tsp-prices.json`)
* The static site just reads that committed JSON at build/runtime, no live cross-origin calls needed
* Store at minimum: date, and closing price for each of the five funds, per day

Example workflow skeleton (adjust the cron time once you confirm when TSP/tspfolio actually post each day's price):

```yaml
name: Update TSP Prices
on:
  schedule:
    - cron: "0 2 * * 2-6"   # ~9-10pm ET, Mon-Fri evenings
  workflow_dispatch: {}
jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm install
      - run: node scripts/fetch-prices.js
      - run: |
          git config user.name "tsp-data-bot"
          git config user.email "actions@github.com"
          git add data/tsp-prices.json
          git commit -m "Update TSP price data" || echo "No changes"
          git push
```

## 4. Core feature: relative-strength rotation

For each fund, compute trailing return over multiple lookback windows (1 month, 3 month, 6 month at minimum, expose as a toggle). Rank funds by return within the selected window.

Logic:

1. On a schedule matching real-world transfer cadence (twice monthly, not daily), rank funds by trailing return for the selected lookback window.
2. Compare the top-ranked fund against the currently held fund.
3. Flag a "consider switching" signal only if the leader is ahead of the current holding by more than a configurable margin (default suggestion: 2 percentage points over the lookback window). A bare edge-out shouldn't trigger a signal.
4. If a signal fires, check whether an unrestricted transfer is still available this calendar month (track a running count that resets on the 1st).
5. If yes, this is a normal actionable signal.
6. If no unrestricted transfers remain this month AND the signal target is specifically the G Fund, still flag it as actionable (uncapped safe harbor).
7. If no unrestricted transfers remain and the target is a stock fund, flag it as "would switch, but capped this month" rather than a real actionable signal, so the dashboard stays honest about what's actually possible.

## 5. Additional metrics to compute and display alongside raw return

* Sharpe-style ratio: (fund's trailing return minus G Fund's trailing return over the same window) divided by the standard deviation of the fund's daily returns over that window. G Fund as the risk-free proxy is the standard convention in TSP-specific analysis.
* Max drawdown: largest peak-to-trough decline within the lookback window, per fund.
* Trend filter: is the fund's current price above its own trailing N-day moving average (suggest 50-day)? Treat as a confirmation flag, not a hard gate, a fund can lead on relative strength while failing the trend filter, and that specific combination is worth surfacing distinctly rather than hiding.
* Regime flag: expose a manual or model-driven risk-on/risk-off flag (this is where the HMM regime dashboard from the trading course plugs in directly), and suppress or de-emphasize rotation signals during a flagged risk-off regime, since "leading" during a broad selloff often just means "fell the least."
* Standing defensive rule: independent of the twice-monthly schedule, if the currently held fund draws down more than a configurable percentage (suggest 7-10%) from its recent peak, surface a safe-harbor G Fund signal immediately, since that specific move is never capped.

## 6. Dashboard UI

* Line chart of cumulative trailing return by fund over the selected lookback window, current holding visually distinguished.
* Ranking table: fund, trailing return, Sharpe-style ratio, max drawdown, trend-filter pass/fail, current leader highlighted.
* Transfer-count tracker for the current calendar month (used / 2 remaining), with a clear note when only the G Fund safe harbor is left.
* Signal log: running history of past signals and whether they were acted on. This becomes an actual track record over time and feeds the backtest sanity check below.
* Regime flag indicator, pulled from or manually toggled alongside the HMM dashboard.

## 7. Backtesting, required before this touches real money

* Build a standalone backtest script that replays the exact rule set (lookback window, margin threshold, transfer cap, drawdown trigger) against the full historical CSV.
* Compare the simulated rotation strategy's ending value against simply holding a static C Fund allocation, and against a static age-appropriate L Fund, over the same period.
* Report win rate (percentage of rotation periods that beat the static benchmark), not just total return, a strategy that wins big once and loses small often has an ugly underlying track record that total return alone hides.
* Don't treat any signal from the live dashboard as real until this backtest has run across multiple market regimes. The trading course's own 30+ day paper-trading rule is a reasonable floor to apply here too, watch the signals play out before acting on the first one.

## 8. Suggested stack and repo structure

Matching the existing GitHub Pages pattern from FinanceHub:

* React + Next.js static export, Tailwind for styling
* `papaparse` for CSV parsing in the data-refresh script
* `recharts` for the chart

```
/data/tsp-prices.json          # committed, updated daily by Actions
/scripts/fetch-prices.js       # the Actions data pull + derived metrics
/scripts/backtest.js           # standalone backtest runner
/src/components/RotationChart.jsx
/src/components/RankingTable.jsx
/src/components/SignalLog.jsx
/src/lib/metrics.js            # Sharpe, drawdown, moving average, ranking logic
```

Deploy via GitHub Pages, same as FinanceHub.

## 9. What this tool explicitly does not do

* Does not execute trades. TSP has no public transaction API, every real reallocation still happens manually on tsp.gov.
* Does not guarantee performance. It's a decision-support and record-keeping tool, the backtest step exists specifically to keep it honest about that.

---

## Deviations from this spec (and why)

- **Stack**: built with Create React App (react-scripts 5) + plain CSS, not Next.js +
  Tailwind. `finance-hub` — the sibling project this was told to match — turned out to
  actually be CRA with hand-written CSS (Tailwind was listed as a dependency but never wired
  up: no config file, no utility classes anywhere in its JSX). Matched what's actually
  working there rather than what the spec assumed it was.
- **Data source**: pulls directly from `https://www.tsp.gov/data/fund-price-history.csv` (the
  official source) instead of tspfolio.com. Same CORS-avoidance approach either way (server-side
  fetch, commit the JSON), just a more authoritative source that was confirmed working.
- **Data path**: lives at `public/data/tsp-prices.json`, not a repo-root `/data/tsp-prices.json`.
  An un-ejected CRA app only ever serves `public/` or bundles files imported from `src/` — a
  root-level folder would be invisible to the built site.
- **Derived fields**: `scripts/fetch-prices.js` only fetches/normalizes; all the actual math
  (returns, Sharpe-style ratio, drawdown, ranking) lives once in `src/lib/metrics.js` and
  `src/lib/signals.js`, imported by both the dashboard and `scripts/backtest.js`. Keeps the
  live tool and the backtest from silently drifting apart.
- **Regime flag**: manual toggle only for now. No HMM regime project exists in this workspace
  to wire up yet — `RegimeToggle.jsx` is the integration point whenever it does.
- **Standing defensive rule**: measures drawdown from the peak *since the position was
  entered*, not just any peak in a trailing N-day window. Without that bound, a fund bought
  yesterday could trigger off a pre-existing dip from before it was ever held — caught this in
  the initial backtest run as an immediate buy-then-flee whipsaw and fixed it.
