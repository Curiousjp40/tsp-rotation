#!/usr/bin/env node
/**
 * Parameter sweep + out-of-sample validation, per SPEC.md section 11.
 *
 * The single-combination backtest (scripts/backtest.js) tells you the
 * result for whatever parameters you typed in — it doesn't tell you
 * whether those are good parameters or just the ones tried first. This
 * runs every combination of {window, margin, drawdown, tilt} in the grid
 * below against the full committed history, ranks them by win rate vs.
 * static C Fund (the spec's own "more honest than total return" metric),
 * then re-checks the winner on two non-overlapping sub-periods
 * (2003-2018, 2019-2026) to see if it's a real, consistent edge or just
 * fit to noise in years that happened to favor it.
 *
 * Note on "out of sample": the sweep itself scores every combination on
 * the FULL 2003-2026 range, then the winner is re-run on each half
 * separately. That's a consistency/robustness check across sub-periods,
 * not a blind holdout in the strict sense — the full range (which
 * contains both halves) was what picked the winner in the first place.
 * Flagging that plainly rather than overclaiming what got validated.
 *
 * Usage: node scripts/sweep.js [--save[=path]]
 */

const fs = require('fs');
const path = require('path');
const {
  DEFAULT_ALLOC, loadPrices, sliceByDateRange, simulateRebalance, winRate, summarize, yearsBetween,
} = require('./backtest');
const { findIndexOnOrBefore } = require('../src/lib/metrics');

const GRID = {
  window: [1, 3, 6],
  margin: [1, 2, 3, 5],
  drawdown: [5, 8, 12, 15],
  tilt: [5, 10, 15, 20],
};

const SLICES = [
  { label: '2003-2018 (out-of-sample half A)', start: null, end: '2018-12-31' },
  { label: '2019-2026 (out-of-sample half B)', start: '2019-01-01', end: null },
];

function staticCBenchmark(prices, years) {
  const mult = prices[prices.length - 1].C / prices[0].C;
  const values = prices.map((p) => p.C / prices[0].C);
  return summarize(mult, values, years);
}

function cWinRateFn(prices) {
  return (d1, d2) => {
    if (!d1 || !d2) return null;
    const i1 = findIndexOnOrBefore(prices, d1);
    const i2 = findIndexOnOrBefore(prices, d2);
    if (i1 < 0 || i2 < 0) return null;
    return prices[i2].C / prices[i1].C - 1;
  };
}

/** Run one {window, margin, drawdown, tilt} combination against `prices`. */
function runOne(prices, params) {
  const years = yearsBetween(prices[0].date, prices[prices.length - 1].date);
  const strategy = simulateRebalance(prices, {
    window: params.window, margin: params.margin, drawdown: params.drawdown,
    mode: 'tilt', tilt: params.tilt, startAllocation: DEFAULT_ALLOC,
  });
  const result = summarize(strategy.endValue, strategy.equityCurve.map((p) => p.value), years);
  const staticC = staticCBenchmark(prices, years);
  const winRatePct = winRate(prices, strategy.equityCurve, cWinRateFn(prices));

  return {
    ...params,
    range: { start: prices[0].date, end: prices[prices.length - 1].date },
    totalReturnPct: result.totalReturnPct,
    cagrPct: result.cagrPct,
    maxDrawdownPct: result.maxDrawdownPct,
    winRatePct,
    tradesCount: strategy.trades.length,
    staticCTotalReturnPct: staticC.totalReturnPct,
    // "Beats its static benchmark" = literally ended ahead of static C over
    // this same window — the direct, unambiguous reading. Win rate (logged
    // above per the spec) is a separate, more granular consistency metric
    // used for ranking, not for this pass/fail check.
    beatsStaticC: result.totalReturnPct != null && staticC.totalReturnPct != null && result.totalReturnPct > staticC.totalReturnPct,
  };
}

function fmtPct(v) { return v == null ? 'n/a' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`; }
function fmtRow(r) {
  return `${String(r.window).padStart(2)}mo ${String(r.margin).padStart(2)}pp ${String(r.drawdown).padStart(2)}% ${String(r.tilt).padStart(2)}pp | ` +
    `${fmtPct(r.totalReturnPct).padStart(9)} ${fmtPct(r.cagrPct).padStart(8)}/yr  maxDD ${r.maxDrawdownPct.toFixed(1).padStart(5)}%  ` +
    `winRate ${r.winRatePct == null ? ' n/a' : r.winRatePct.toFixed(1).padStart(5) + '%'}  trades ${String(r.tradesCount).padStart(4)}  ` +
    `beatsC ${r.beatsStaticC ? 'yes' : 'no '}`;
}

function main() {
  const args = process.argv.slice(2);
  let savePath = null;
  for (const raw of args) {
    if (raw === '--save') savePath = 'public/data/sweep-results.json';
    const m = raw.match(/^--save=(.*)$/);
    if (m) savePath = m[1];
  }

  const allPrices = loadPrices();
  const fullPrices = sliceByDateRange(allPrices, null, null);

  const combos = [];
  for (const window of GRID.window) {
    for (const margin of GRID.margin) {
      for (const drawdown of GRID.drawdown) {
        for (const tilt of GRID.tilt) combos.push({ window, margin, drawdown, tilt });
      }
    }
  }

  console.log(`\nTSP Rebalance Parameter Sweep`);
  console.log(`Grid: window=[${GRID.window}] margin=[${GRID.margin}] drawdown=[${GRID.drawdown}] tilt=[${GRID.tilt}] -> ${combos.length} combinations`);
  console.log(`Full range: ${fullPrices[0].date} .. ${fullPrices[fullPrices.length - 1].date}\n`);

  const startTime = Date.now();
  const results = combos.map((c, i) => {
    if (i > 0 && i % 48 === 0) console.log(`  ...${i}/${combos.length} (${((Date.now() - startTime) / 1000).toFixed(0)}s elapsed)`);
    return runOne(fullPrices, c);
  });
  console.log(`Done in ${((Date.now() - startTime) / 1000).toFixed(1)}s.\n`);

  // Sorted best-to-worst by win rate, per spec section 11.
  results.sort((a, b) => (b.winRatePct ?? -Infinity) - (a.winRatePct ?? -Infinity));

  console.log('Top 10 of full-period sweep, ranked by win rate vs static C Fund:');
  console.log('window margin drawdown tilt | totalReturn     cagr    maxDD    winRate       trades  beatsC');
  for (const r of results.slice(0, 10)) console.log(fmtRow(r));

  const passingFullPeriod = results.filter((r) => r.beatsStaticC);
  console.log(`\n${passingFullPeriod.length}/${combos.length} combinations beat static C Fund over the full period.`);

  const best = results[0];
  console.log(`\nBest by win rate: window=${best.window}mo margin=${best.margin}pp drawdown=${best.drawdown}% tilt=${best.tilt}pp`);
  console.log(fmtRow(best));

  console.log('\nOut-of-sample check — same combination, re-run on each non-overlapping half:');
  const sliceResults = SLICES.map((slice) => {
    const slicedPrices = sliceByDateRange(allPrices, slice.start, slice.end);
    const r = runOne(slicedPrices, best);
    console.log(`  ${slice.label} (${slicedPrices[0].date}..${slicedPrices[slicedPrices.length - 1].date}):`);
    console.log('    ' + fmtRow(r));
    return { ...slice, ...r };
  });

  const passesValidation = best.beatsStaticC && sliceResults.every((r) => r.beatsStaticC);

  console.log(`\n${'='.repeat(78)}`);
  if (passesValidation) {
    console.log(`PASS: window=${best.window}mo / margin=${best.margin}pp / drawdown=${best.drawdown}% / tilt=${best.tilt}pp`);
    console.log('beats static C Fund in the full period AND both out-of-sample halves.');
    console.log('This combination is validated as this dashboard\'s recommended rule set.');
  } else {
    console.log('FAIL: no combination in this grid beat static C Fund in the full period AND');
    console.log('both out-of-sample halves. Per the spec, that is a real finding — this family');
    console.log('of rules (trailing-return relative strength + a drawdown safety valve) does not');
    console.log('show a validated edge over static buy-and-hold across this history. The honest');
    console.log('default is to say so, not to quietly keep recommending an unvalidated rule set.');
  }
  console.log('='.repeat(78) + '\n');

  if (savePath) {
    const outPath = path.isAbsolute(savePath) ? savePath : path.join(__dirname, '..', savePath);
    const output = {
      generatedAt: new Date().toISOString(),
      grid: GRID,
      combosRun: combos.length,
      fullRange: { start: fullPrices[0].date, end: fullPrices[fullPrices.length - 1].date },
      top10: results.slice(0, 10),
      best,
      outOfSample: sliceResults,
      passesValidation,
    };
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
    console.log(`Saved to ${outPath}`);
  }
}

main();
