# TSP Fund Rotation Dashboard — Build Spec (v2)

> Current project brief, kept for reference across sessions. v2 supersedes v1 (kept below as an
> appendix) — the core change is the holding model: a weighted allocation across funds instead
> of a single selected fund. See "Deviations from this spec" right after this section, and
> [README.md](./README.md), for what was actually built and why.

## What changed since v1

The first build got the TSP mechanics right (pricing, the transfer cap, the safe-harbor
exception) and the additional metrics right (Sharpe-style, drawdown, trend filter, regime
flag). But it modeled "current holding" as a single fund selected from a dropdown. Real TSP
accounts, including the one this is built for, are usually a weighted mix across several funds
at once, not 100% in any one fund. That single assumption touches almost everything downstream:
the ranking comparison, the margin calculation, the drawdown trigger, the chart. This version
rebuilds the holding model around a weighted allocation and fixes several smaller issues found
while reviewing the first pass.

## 1. What this is

A read-only monitoring and decision-support dashboard for Thrift Savings Plan (TSP) fund allocation. It tracks the C, S, I, F, and G funds, ranks them by trailing performance, and surfaces when rebalancing is worth considering, while respecting TSP's actual transfer rules. It does not execute trades. TSP has no public transaction API, so any real reallocation still happens manually on tsp.gov.

## 2. Ground-truth rules to encode correctly

* Pricing: TSP funds post one NAV per business day, calculated after market close. There is no intraday price movement to track.
* Cutoff: reallocation requests submitted before 12:00pm ET execute at that day's closing price. Requests submitted after 12:00pm ET execute at the next business day's closing price.
* Transfer limit: two unrestricted reallocations per calendar month, can move into any fund combination. After those two are used, any remaining reallocations that month can only move money INTO the G Fund (the safe-harbor exception), not back out into C/S/I/F. The count resets on the 1st of each calendar month.
* Funds tracked:
   * C Fund: large-cap US stock, tracks the S&P 500
   * S Fund: small/mid-cap US stock, tracks the Dow Jones US Completion TSM
   * I Fund: international stock, tracks MSCI EAFE
   * F Fund: US bonds, tracks the Bloomberg US Aggregate Bond Index
   * G Fund: government securities, essentially flat and steadily accruing, treated as the risk-free rate, not a market-moving series

## 3. The holding model has to be a weighted allocation, not a single fund

This is the most important change in this version. A real TSP allocation is a set of percentages across the five funds that sum to 100, not a single selected fund. The current build's "Current holding" dropdown should be replaced with an allocation input: five percentage fields (C/S/I/F/G) that must sum to 100, pre-fillable and editable, structured the same way as TSP's own reallocation screen (percentage per fund, running total shown).

Example starting allocation to seed and test against: 50% C / 30% S / 20% I / 0% F / 0% G, total account value roughly $9,650.

From that allocation, the dashboard needs to compute and prominently display a blended return: the weighted sum of each fund's trailing return by its allocation percentage, for whatever lookback window is selected. This is the actual "how am I doing" number, and it should replace any single fund's return as the baseline the ranking table and signals compare against.

Worked example to validate the calculation against (2026 YTD, through end of July): C +10.13%, S +13.52%, I +15.35%. A 50/30/20 C/S/I blend:

```
(0.50 × 10.13) + (0.30 × 13.52) + (0.20 × 15.35) = 12.19%
```

The blended return for that allocation and window should compute to 12.19%. Use this as a unit test for the blending logic.

Everything downstream needs to use the blended return as "current," not a single fund:

* The ranking table's "current" row should show the blended allocation's return, Sharpe-style score, and drawdown, alongside the individual funds, clearly marked as the actual current position rather than a fund competing for the top spot.
* The chart should plot the blended allocation as its own line (drawn thicker, as the current build already does for whatever's marked "current"), in addition to each individual fund's line.
* The standing drawdown trigger (see section 5) should measure drawdown on the blended allocation, not a single fund.

## 4. Rebalancing logic replaces full-rotation logic

Because the holding is a blend, not a single fund, "should I switch" isn't really the right question anymore, "how much weight should shift, and toward what" is. Rebuild the core signal logic around reweighting:

1. On a schedule matching real-world transfer cadence (twice monthly, matching the two unrestricted transfers), rank the five funds by trailing return over the selected lookback window.
2. Compute the blended return of the current allocation over the same window.
3. Flag a signal only if the top-ranked fund beats the blended return by more than the configured margin threshold (currently 2 percentage points). A bare edge-out shouldn't trigger anything.
4. When a signal fires, the suggested action should be a reweighting, not a full swap: shift a configurable slice of the allocation (a reasonable default is something like 10-15 percentage points) away from the current biggest laggard and toward the current leader, rather than proposing 100% into the leader. Support both a "tilt" mode (this incremental reweighting) and a "full rotation" mode (move everything to the single leader) as selectable strategies, but default to tilt.
5. Alongside the suggested reweighting, show the hindsight comparison plainly labeled as hindsight: what the blended return would have been if the account had been 100% in the current leader for the same window. This is useful context, not a promise, make sure the UI doesn't imply it's a forecast.
6. Capacity and safe-harbor logic stays as originally specced: check whether an unrestricted transfer is still available this month, and if not, still allow moves that only increase the G Fund's weight (the uncapped safe-harbor exception), flagging anything that would require moving out of G into a stock fund as "would act, but capped this month" rather than a live signal.

## 5. Additional metrics, unchanged in concept, updated in scope

* Sharpe-style ratio: (fund's trailing return minus G Fund's trailing return over the same window) divided by the standard deviation of the fund's daily returns over that window. This is a relative-strength-vs-risk score, not an annualized Sharpe ratio, label it that way in the UI (the current build already does this well, keep the exact wording).
* Max drawdown: largest peak-to-trough decline within the lookback window, computed per individual fund AND for the blended allocation.
* Trend filter: is the fund's (or the blend's) current value above its own trailing 50-day moving average. Treat as a confirmation flag, not a hard gate, a fund can lead on relative strength while failing the trend filter, and that combination should be shown, not hidden.
* Regime flag: a risk-on/risk-off flag, currently manual, ideally wired to the HMM regime-detection dashboard eventually. Whatever the source, label it clearly in the UI (manual toggle vs. model-driven) and show when it was last updated, so a stale flag is visible as stale. Rotation signals into stock funds should be de-emphasized in the UI when flagged risk-off; the standing defensive rule below still fires regardless of regime.
* Standing defensive rule: independent of the twice-monthly schedule, if the blended allocation draws down more than the configured percentage (currently 8%) from its recent peak, surface a safe-harbor signal immediately, since increasing G Fund weight is never capped at 2/month.

## 6. Data source and a data-freshness check

* Primary: TSP's own published prices, not proxy ETFs. Official source is tsp.gov/share-price-history; tspfolio.com publishes a single CSV of daily closing prices for all five funds back to June 2003, which is the easier source to pull programmatically.
* CORS: fetching that CSV directly from the browser at runtime will likely fail as a cross-origin request. Don't build this as a client-side fetch. Use a scheduled GitHub Actions workflow that fetches the source server-side, computes derived fields, and commits an updated JSON file into the repo (`/data/tsp-prices.json`). The static site reads that committed file, no live cross-origin calls needed.
* Freshness check, new: sites that show performance in a monthly-table format (year/month columns, rather than a daily series) are often only current through the most recently closed month, not through today. When cross-checking or seeding data from a source like that, confirm the as-of date explicitly rather than assuming it's current, a YTD figure that's actually "YTD through last month" can understate current performance by several points during a strong run. The daily CSV approach above avoids this by construction, but treat monthly-table sources as spot-verification only, not a live feed.
* Built-in integrity check: after each data refresh, have the pipeline compound each fund's daily or monthly returns over a period and confirm the result matches that fund's independently reported cumulative return for the same period (within rounding). This generalizes a manual check that already caught the freshness issue above, worth automating so a bad pull or a broken parse gets flagged instead of silently feeding wrong numbers into the dashboard.

## 7. Dashboard UI

* Holding input: weighted allocation form (C/S/I/F/G percentages summing to 100), replacing the single-fund dropdown. Pre-fill with 50/30/20 C/S/I as the seed/test case.
* Blended return: shown prominently, computed as described in section 3, alongside each individual fund's return.
* Chart: cumulative trailing return by fund over the selected lookback window, plus the blended allocation as its own thicker line. Current build's "no intraday movement to show" caption is good, keep it.
* Ranking table: all five funds visible, including G Fund (currently missing, it's on the chart but not the table). G doesn't need a Sharpe-style score against itself, but its return and drawdown should be visible in the same table for direct comparison when evaluating a move toward safety. Add a row for the blended allocation itself, clearly marked as the current position rather than a competitor for the top spot.
* Transfer tracker: relabel for clarity. The current "3 / 2 used" reads as a contradiction. If the intent is 2 unrestricted transfers plus additional safe-harbor moves into G, say that explicitly, e.g. "2/2 unrestricted used, 1 additional safe-harbor move this month."
* Transfer log: add a safeguard against duplicate or no-op entries, specifically, logging a move to a fund you're already reporting as your full holding shouldn't be possible, and identical same-day entries should be caught rather than silently duplicated. The current build has three identical entries logged on the same day, worth checking whether that's a UI bug or leftover test data.
* Signal log: keep as built, running history of signals and whether they were acted on, feeding the backtest validation.
* Regime flag indicator: label its source (manual vs. model-driven) and last-updated time, as noted in section 5.
* Evaluation schedule: show the actual full schedule (for example, "evaluates on the 1st and 15th"), not just the single next upcoming date. The current build only shows one upcoming date, worth confirming the underlying schedule genuinely lands twice a month, matching the 2-transfer cap it's designed around, and not just once.
* Backtest results: surface the most recent backtest run's results directly in the dashboard (win rate, comparison vs. static benchmarks), not just a footer instruction to run a CLI command. If it hasn't been run yet, say so plainly rather than implying it has.

## 8. Backtesting, required before this touches real money

* Build a standalone backtest script that replays the exact rule set (lookback window, margin threshold, transfer cap, drawdown trigger, tilt-vs-full-rotation mode) against the full historical CSV, simulating from a blended starting allocation, not a single fund.
* Compare the simulated strategy's ending value against simply holding the current static blend the whole period, a static 100% C Fund allocation, and a static age-appropriate L Fund, over the same period.
* Report win rate (percentage of rebalancing periods that beat the static benchmark), not just total return, a strategy that wins big once and loses small often has an ugly underlying track record that total return alone hides.
* Don't treat any signal from the live dashboard as real until this backtest has run across multiple market regimes. The 30+ day paper-trading rule from the trading course this is being built alongside is a reasonable floor to apply here too, watch signals play out before acting on the first one.

## 9. Suggested stack and repo structure

Matching the existing GitHub Pages pattern:

* React + Next.js static export, Tailwind for styling
* `papaparse` for CSV parsing in the data-refresh script
* `recharts` for the chart

```
/data/tsp-prices.json          # committed, updated daily by Actions
/scripts/fetch-prices.js       # the Actions data pull + derived metrics + integrity check
/scripts/backtest.js           # standalone backtest runner
/src/components/AllocationInput.jsx   # weighted holding input, replaces the fund dropdown
/src/components/RotationChart.jsx
/src/components/RankingTable.jsx
/src/components/SignalLog.jsx
/src/lib/metrics.js            # Sharpe, drawdown, moving average, ranking, blended-return logic
```

Deploy via GitHub Pages, same as FinanceHub.

## 10. What this tool explicitly does not do

* Does not execute trades. TSP has no public transaction API, every real reallocation still happens manually on tsp.gov.
* Does not guarantee performance. It's a decision-support and record-keeping tool, the backtest step and the hindsight-labeled comparisons exist specifically to keep it honest about that.

## 11. Parameter search, finding a rule set that actually beats buy-and-hold

The backtest in section 8 returns a result for whatever parameters happen to be set, but one result doesn't tell you whether those numbers are good, or just the ones that were typed in first. Before the dashboard's live signal gets treated as return-maximizing, search the parameter space and validate it out of sample.

**Sweep**: run the backtest across every combination of:
* Lookback window: 1, 3, 6 months
* Margin threshold: 1, 2, 3, 5 percentage points
* Drawdown trigger: 5, 8, 12, 15 percent
* Tilt size: 5, 10, 15, 20 percentage points

That's roughly 190 combinations, each run against the full 2003-2026 history, logging total return, CAGR, max drawdown, and win rate vs. static C Fund for every one. This is just looping the existing `backtest.js` over a parameter grid and writing results to a table, sorted best to worst by win rate. Fast, no real performance concern.

**Validate out of sample, this step is not optional**: whatever combination wins the sweep, re-run it on two separate slices, 2003-2018 only, then 2019-2026 only, data the sweep didn't use to pick that combination. A rule set that wins on the full period but loses on 2019-2026 was likely fit to noise in the years it was tuned against, not a real edge. Only a combination that beats its static benchmark in both the in-sample and out-of-sample windows should ever become the dashboard's live, confidently-stated recommendation.

**Once (if) something passes**: that becomes the production rule set, replacing today's defaults (3mo / 2pp / 8% / 12pp), and the Current Signal panel states its recommendation with actual backing. If nothing in the sweep clears the bar in both windows, that's a real finding too, it means this family of rules (trailing-return relative strength with a drawdown safety valve) doesn't have an edge over this history, and the dashboard's honest job becomes telling you "stay put" on most logins, which is still telling you what to invest in, the answer just won't always be a different fund.

## 12. Simplify, the calculator is the primary view now

The parameter sweep in section 11 came back negative: no combination beat static C Fund both in-sample and out-of-sample. That changes what the main screen should be. Right now the primary surface is signal-generation machinery (lookback window, margin threshold, tilt size, drawdown trigger, strategy toggle, current-signal panel), all in service of a rotation edge that's now been tested and not found. Keeping that as the main view, after running the test it asked for, buries the honest answer under controls for a system that doesn't work.

Rebuild the primary view as a plain return calculator:

1. **A period selector**: last month, 3 months, 6 months, 1 year, YTD, custom date range. One control, no jargon.
2. **The allocation input**: the existing five percentage fields (C/S/I/F/G, sum to 100), unchanged, this part already does exactly what's needed.
3. **One big number**: "Your blend would have returned: X%" for the selected period, updating live as the percentages change. This is the headline, large and immediate, no scrolling required to see it.
4. **A plain list below it**: each individual fund's return over the same period (C Fund: X%, S Fund: X%, etc.), so a 100%-in-one-fund comparison is visible at a glance without retyping anything.
5. **A few one-tap presets**: "100% C Fund" (the historically best-returning static option from the section 8 backtest), "Even split," and "Your current holding," auto-filling the percentage fields so comparing scenarios doesn't require manual re-typing.

This view answers "what would this split have earned" honestly and immediately, for any period, any allocation, no jargon. It's not a recommendation engine and shouldn't pretend to be one, it's an answer to "let me see," which is what a 192-combination test just confirmed is the more trustworthy thing to offer. Deciding an actual target allocation from what it shows is a personal call (risk tolerance, time horizon), not something the tool should assert as optimized.

**Move the signal/rotation machinery** (sections 4, 5, and the rules-and-strategy panel, current-signal panel, transfer tracker, and regime flag from section 7) **behind a clearly labeled "Advanced / experimental" section**, collapsed by default. Not deleted, the parameter search from section 11 is worth re-running periodically as more data comes in, but it shouldn't be the first thing the dashboard shows since it isn't currently backed by evidence. Keep the backtest results panel visible right at the top of that section, so anyone who opens it immediately sees why it's labeled experimental.

---

## Deviations from this spec (v2)

- **Allocation is a static snapshot, not auto-drifted daily.** The dashboard doesn't track
  per-fund dollar amounts, so it can't know how your % mix silently drifts between updates the
  way a real account does. `blendedReturnPct` is the fixed-weight linear combination the spec's
  worked example describes — exact for that formula, but "as of your last update," not
  continuously adjusted. Nudge the allocation periodically if drift matters to you.
- **The backtest tracks real per-fund unit holdings day-by-day** to get an accurate multi-year
  equity curve (classic buy-and-hold-until-rebalanced), deriving "current %" from that drifted
  state at each evaluation point and feeding it into the exact same `blendedReturnPct`/
  `evaluateRebalanceSignal` the live dashboard uses. Different internal state than the live
  dashboard's static snapshot, same formula and signal engine either way.
- **Integrity check is self-consistency + a dated reference checkpoint, not a live second
  data source.** A true "independently reported" comparison on every run would mean scraping a
  second site each time — reintroducing the exact CORS/fragility problem already avoided by
  using tsp.gov directly. Implemented instead: (a) an always-on compounding-consistency check
  per fund (a regression guard on this script's own arithmetic, hard-fails the write if wrong),
  and (b) the spec's own worked reference point — C/S/I YTD through 2026-07-31 — checked with
  tolerance whenever the data covers that date, warning non-fatally rather than blocking. It
  matched exactly on first run (10.13% / 13.52% / 15.35%, confirming both the reference and the
  data). More checkpoints can be appended the same way over time.
- **AllocationInput is the one place you edit your holding**, replacing both the old "Current
  holding" dropdown and the transfer tracker's own mini-form. A real bug turned up testing this:
  the no-op/duplicate guard originally compared a new log entry against the *live* "current"
  allocation — but editing already commits live for what-if calculations, so draft and current
  were always identical by the time you clicked Log, and the guard fired on every legitimate
  entry. Fixed by comparing against the *last logged transfer* instead (or the seed allocation
  if none exists yet), which is what "already reporting as your holding" actually means.
- **Storage keys were versioned** (`:v2` suffixes) rather than migrated in place for the shapes
  that changed (single fund → allocation object). Cheap for a pre-launch local tool, and it
  means the 3 duplicate test entries flagged in this spec simply stop being read rather than
  needing manual cleanup — they were leftover clicks from live-testing the previous build in
  the browser preview, not a logging bug.
- **The blended row in the ranking table is pinned above the sorted list**, not interleaved
  into the sort — matches "not a competitor for the top spot" literally.
- **Default tilt size: 12 percentage points** (within the spec's 10-15pp range), adjustable in
  Rules & Strategy.
- Everything in the v1 deviations section below (stack, data source, data path, derived-fields
  location, regime flag, standing-defensive-rule entry bound) still applies unchanged in v2.

## Section 11 result (parameter sweep) — FAIL, and what that changed

Ran `npm run sweep -- --save` against the committed 2003-2026 history: **0 of 192 grid
combinations beat static C Fund's total return over the full period.** The single
best-by-win-rate combination (6mo window / 3pp margin / 8% drawdown / 20pp tilt) does beat
static C on the 2003-2018 half but *loses* to it on 2019-2026 — exactly the kind of
period-dependent result the out-of-sample check exists to catch. Per section 11's own decision
rule, this is a real finding, not a bug: this family of rules (trailing-return relative
strength + a drawdown safety valve) has no demonstrated edge over simply holding C Fund across
this history — a monster, mostly-uninterrupted C Fund bull run is a hard benchmark to clear for
any strategy that spends time in other funds.

Per spec: since nothing passed, the production defaults were **left unchanged** (3mo/2pp/8%/
12pp — the original spec's suggested values, not the swept "best," since that combination
failed validation). What did change: `SweepSummary.jsx` surfaces the full result (pass/fail,
the winning combination, both out-of-sample rows) directly in the dashboard, and a caveat
banner on the Current Signal panel reads the same saved JSON live — so if a future re-run ever
does find a validated combination, both update automatically without a code change; until then,
every live signal carries an explicit "informational, not backed" warning rather than silently
implying validation that doesn't exist.

One methodology note worth being honest about: "out of sample" here means the sweep scores the
*full* 2003-2026 range to pick a winner, then that winner is re-checked on each non-overlapping
half separately — a consistency check across sub-periods, not a blind holdout in the strict
sense (the full range that picked the winner contains both halves). `SweepSummary.jsx` and the
README both say this plainly rather than overclaiming what got validated.

## Section 12 result — calculator is now the primary view

Built as specced: a new `Calculator.jsx` is the first thing the dashboard shows (period
selector — 1M/3M/6M/1Y/YTD/custom range — plus the existing `AllocationInput`, a large blended-
return number, a plain per-fund list, and the three presets). Everything from the old primary
view (Rules & Strategy, Transfer Tracker, Regime flag, Current Signal, the chart, ranking
table, and signal log) now lives behind a collapsed "Advanced / experimental" toggle, with
`BacktestSummary` pinned first inside it per the spec's instruction.

One addition beyond the letter of the spec, in the same spirit: the "Your current holding"
preset needed a genuine "current" to restore, distinct from whatever's been live-edited while
exploring the other presets — `AllocationInput` commits every edit immediately (by design, for
live what-if calculations), so a naive "current" reference would just be the last thing you
clicked. Added `storage.getLastLoggedAllocation()` (the same lookup the transfer-log no-op
guard already used) as the one honest source of "what you actually, really hold" — sourced from
the immutable transfer-log history, not the mutable live-edit state.

`metrics.js` gained a lower-level `returnBetween`/`blendedReturnBetween` primitive (return
between two explicit indices, not just "N months back from today") to support the calculator's
flexible period selector; `trailingReturnPct`/`blendedReturnPct` were refactored to be thin
wrappers over it — same external behavior, re-verified against the existing 12.19% unit test
after the refactor, plus two new tests for `resolvePeriod` (YTD anchors to the prior year-end
close; a custom start before the dataset clamps to the earliest available row rather than
erroring — friendlier for a "let me see" calculator than a hard failure).

---

## Appendix: v1 spec (superseded by the above)

> Original v1 project brief. Kept for history; see the v1 deviations section immediately below
> it for what changed during that build.

### 1. What this is

A read-only monitoring and decision-support dashboard for Thrift Savings Plan (TSP) fund allocation. It tracks the C, S, I, F, and G funds, ranks them by trailing performance, and surfaces when a reallocation is worth considering, while respecting TSP's actual transfer rules. It does not execute trades. TSP has no public transaction API, so any real reallocation still happens manually on tsp.gov.

### 2. Ground-truth rules to encode correctly

Get these right before anything else, the whole tool is built on top of them — same five rules as section 2 above (pricing, cutoff, transfer limit, funds tracked).

### 3. Data source (v1)

tspfolio.com's CSV was the originally suggested source; see "Deviations" — v2 (and the actual build) uses tsp.gov's own CSV directly instead.

### 4. Core feature: relative-strength rotation (v1, single-fund)

1. On a schedule matching real-world transfer cadence (twice monthly, not daily), rank funds by trailing return for the selected lookback window.
2. Compare the top-ranked fund against the currently held fund.
3. Flag a "consider switching" signal only if the leader is ahead of the current holding by more than a configurable margin (default suggestion: 2 percentage points over the lookback window). A bare edge-out shouldn't trigger a signal.
4. If a signal fires, check whether an unrestricted transfer is still available this calendar month (track a running count that resets on the 1st).
5. If yes, this is a normal actionable signal.
6. If no unrestricted transfers remain this month AND the signal target is specifically the G Fund, still flag it as actionable (uncapped safe harbor).
7. If no unrestricted transfers remain and the target is a stock fund, flag it as "would switch, but capped this month" rather than a real actionable signal, so the dashboard stays honest about what's actually possible.

### 5-9

Additional metrics, dashboard UI, backtesting, and suggested stack — same content as v2 sections 5, 7, 8, 9 above, minus the allocation-specific additions (blended metrics, tilt/full mode, hindsight comparison, G row + pinned blend row, relabeled transfer tracker, evaluation-schedule display, backtest results in the UI). See git history for the original full v1 text if needed.

### Deviations from v1 spec (and why)

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
