#!/usr/bin/env node
/**
 * Standalone backtest runner. Replays the committed price history through
 * the exact same rule engine (src/lib/signals.js + src/lib/metrics.js) the
 * live dashboard uses, and compares the simulated rebalance strategy
 * against three static benchmarks: buy-and-hold the starting blend, 100%
 * C Fund, and a static L Fund.
 *
 * v2: simulates a real weighted allocation, not a single fund. To get an
 * accurate multi-year equity curve, it tracks per-fund UNIT holdings
 * day-by-day (classic buy-and-hold-until-rebalanced — real TSP accounts
 * aren't auto-rebalanced either), derives the drifted current allocation %
 * from that state at every evaluation point, and feeds it into
 * evaluateRebalanceSignal exactly like the live dashboard would if you kept
 * your input perfectly up to date. Same formula, same signal engine either
 * way — the backtest just needs the richer internal state because its job
 * is to produce a real equity curve, not just today's snapshot.
 *
 * This exists specifically so no signal from the live dashboard gets acted
 * on before its rule set has been validated across multiple market regimes
 * (2008, 2020, 2022 are all in the committed history). Do not treat a live
 * signal as real until this has run clean and, per the spec, until the
 * signal has been paper-traded for 30+ days.
 *
 * Usage:
 *   node scripts/backtest.js [--window=3] [--margin=2] [--drawdown=8]
 *     [--mode=tilt] [--tilt=12] [--alloc=C:50,S:30,I:20,F:0,G:0]
 *     [--lfund=L2050] [--start=YYYY-MM-DD] [--end=YYYY-MM-DD] [--save[=path]]
 */

const fs = require('fs');
const path = require('path');
const { evaluateRebalanceSignal } = require('../src/lib/signals');
const { findIndexOnOrBefore, maxDrawdownPct, maxDrawdownFromSeries, blendedValueSeries, CORE_FUNDS } = require('../src/lib/metrics');

const DATA_PATH = path.join(__dirname, '..', 'public', 'data', 'tsp-prices.json');
const DEFAULT_ALLOC = { C: 50, S: 30, I: 20, F: 0, G: 0 }; // spec's worked-example seed

function parseAlloc(str) {
  const alloc = { C: 0, S: 0, I: 0, F: 0, G: 0 };
  for (const part of str.split(',')) {
    const [fund, pct] = part.split(':');
    if (CORE_FUNDS.includes(fund)) alloc[fund] = Number(pct);
  }
  return alloc;
}

function parseArgs(argv) {
  const args = {
    window: 3, margin: 2, drawdown: 8, mode: 'tilt', tilt: 12,
    alloc: null, lfund: 'L2050', start: null, end: null, save: null,
  };
  for (const raw of argv) {
    if (raw === '--save') { args.save = 'public/data/backtest-results.json'; continue; }
    const m = raw.match(/^--([^=]+)=(.*)$/);
    if (!m) continue;
    const [, key, val] = m;
    if (key === 'save') { args.save = val; continue; }
    if (key in args) args[key] = val;
  }
  args.window = Number(args.window);
  args.margin = Number(args.margin);
  args.drawdown = Number(args.drawdown);
  args.tilt = Number(args.tilt);
  args.startAllocation = args.alloc ? parseAlloc(args.alloc) : DEFAULT_ALLOC;
  return args;
}

function loadPrices() {
  const raw = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  return raw.prices;
}

/** Fetch L-fund history from tsp.gov (has L funds; data/tsp-prices.json only carries the 5 core funds). */
async function loadLFundSeries(lfund) {
  const res = await fetch('https://www.tsp.gov/data/fund-price-history.csv', {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    },
  });
  if (!res.ok) throw new Error(`L-fund fetch failed: ${res.status}`);
  const text = await res.text();
  const Papa = require('papaparse');
  const parsed = Papa.parse(text.trim(), { header: true, skipEmptyLines: true });
  const col = lfund.replace('L', 'L '); // 'L2050' -> 'L 2050'
  const rows = parsed.data
    .map((row) => {
      const date = row.Date?.trim();
      const val = row[col];
      if (!date || val === undefined || val === '') return null;
      const num = Number(val);
      return Number.isFinite(num) ? { date, price: num } : null;
    })
    .filter(Boolean)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return rows;
}

function sliceByDateRange(prices, start, end) {
  const startIdx = start ? Math.max(0, findIndexOnOrBefore(prices, start) + 1) : 0;
  let endIdx = end ? findIndexOnOrBefore(prices, end) : prices.length - 1;
  if (endIdx < 0) endIdx = prices.length - 1;
  return prices.slice(startIdx, endIdx + 1);
}

function cagr(startValue, endValue, years) {
  if (years <= 0 || startValue <= 0) return null;
  return (Math.pow(endValue / startValue, 1 / years) - 1) * 100;
}

function yearsBetween(startDate, endDate) {
  return (new Date(`${endDate}T00:00:00Z`) - new Date(`${startDate}T00:00:00Z`)) / (365.25 * 24 * 3600 * 1000);
}

function unitsFromAllocation(allocation, prices0) {
  const units = {};
  for (const fund of CORE_FUNDS) {
    const w = (allocation[fund] ?? 0) / 100;
    units[fund] = w > 0 ? w / prices0[fund] : 0;
  }
  return units;
}

function blendedValueFromUnits(units, priceRow) {
  return CORE_FUNDS.reduce((sum, f) => sum + units[f] * priceRow[f], 0);
}

function allocationPctFromUnits(units, priceRow, totalValue) {
  const pct = {};
  for (const fund of CORE_FUNDS) {
    pct[fund] = totalValue > 0 ? (units[fund] * priceRow[fund] / totalValue) * 100 : 0;
  }
  return pct;
}

/**
 * Simulate the rebalance strategy over `prices` (already sliced to the
 * backtest window), starting from `opts.startAllocation`. Returns
 * { equityCurve, trades, evaluations, endValue }.
 */
function simulateRebalance(prices, opts) {
  let units = unitsFromAllocation(opts.startAllocation, prices[0]);
  let allocationSinceIndex = 0;
  const trades = [];
  const evaluations = [];
  const equityCurve = [{ date: prices[0].date, value: 1 }];

  const transfersByMonth = new Map();
  function usedThisMonth(dateStr) {
    return transfersByMonth.get(dateStr.slice(0, 7)) || 0;
  }
  function recordTransfer(dateStr) {
    const ym = dateStr.slice(0, 7);
    transfersByMonth.set(ym, (transfersByMonth.get(ym) || 0) + 1);
  }

  for (let i = 1; i < prices.length; i++) {
    const value = blendedValueFromUnits(units, prices[i]);
    equityCurve.push({ date: prices[i].date, value });
    const currentAllocationPct = allocationPctFromUnits(units, prices[i], value);

    const signal = evaluateRebalanceSignal(prices, i, {
      windowMonths: opts.window,
      marginPct: opts.margin,
      allocation: currentAllocationPct,
      transfersUsedThisMonth: usedThisMonth(prices[i].date),
      drawdownTriggerPct: opts.drawdown,
      allocationSinceIndex,
      mode: opts.mode,
      tiltPct: opts.tilt,
    });

    const actionable = signal.state === 'actionable' || signal.state === 'actionable-safe-harbor';
    if (!actionable || !signal.proposedAllocation || signal.tiltAmount < 0.01) continue;

    evaluations.push(signal);
    if (signal.state === 'actionable') recordTransfer(prices[i].date);

    trades.push({
      date: prices[i].date,
      from: currentAllocationPct,
      to: signal.proposedAllocation,
      state: signal.state,
      reason: signal.reason,
    });

    const newUnits = {};
    for (const fund of CORE_FUNDS) {
      const w = (signal.proposedAllocation[fund] ?? 0) / 100;
      newUnits[fund] = w > 0 ? (w * value) / prices[i][fund] : 0;
    }
    units = newUnits;
    allocationSinceIndex = i;
  }

  const endValue = equityCurve[equityCurve.length - 1].value;
  return { equityCurve, trades, evaluations, endValue };
}

function simulateStaticHold(prices, fund) {
  return prices[prices.length - 1][fund] / prices[0][fund];
}

function simulateStaticHoldSeries(series) {
  if (series.length === 0) return null;
  return series[series.length - 1].price / series[0].price;
}

/** Win rate: % of month-long rebased periods where the strategy beat the static benchmark. */
function winRate(prices, equityCurve, benchmarkFn) {
  let wins = 0;
  let total = 0;
  const byMonth = new Map();
  equityCurve.forEach((pt, i) => byMonth.set(pt.date.slice(0, 7), i));
  const months = [...byMonth.keys()];
  for (let m = 1; m < months.length; m++) {
    const prevIdx = byMonth.get(months[m - 1]);
    const curIdx = byMonth.get(months[m]);
    const strategyReturn = equityCurve[curIdx].value / equityCurve[prevIdx].value - 1;
    const benchReturn = benchmarkFn(prices[prevIdx]?.date, prices[curIdx]?.date);
    if (benchReturn == null) continue;
    total++;
    if (strategyReturn > benchReturn) wins++;
  }
  return total > 0 ? (wins / total) * 100 : null;
}

function summarize(mult, values, years) {
  return {
    totalReturnPct: mult == null ? null : (mult - 1) * 100,
    cagrPct: mult == null ? null : cagr(1, mult, years),
    maxDrawdownPct: values == null ? null : maxDrawdownFromSeries(values),
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const allPrices = loadPrices();
  const prices = sliceByDateRange(allPrices, opts.start, opts.end);

  if (prices.length < 60) {
    throw new Error('Not enough data in the selected range to backtest (need at least ~60 trading days).');
  }
  const allocTotal = CORE_FUNDS.reduce((s, f) => s + (opts.startAllocation[f] ?? 0), 0);
  if (Math.abs(allocTotal - 100) > 0.5) {
    throw new Error(`--alloc must sum to 100 (got ${allocTotal}). e.g. --alloc=C:50,S:30,I:20,F:0,G:0`);
  }

  console.log(`\nTSP Rebalance Backtest`);
  console.log(`Range: ${prices[0].date} .. ${prices[prices.length - 1].date} (${prices.length} trading days)`);
  console.log(`Start allocation: C:${opts.startAllocation.C} S:${opts.startAllocation.S} I:${opts.startAllocation.I} F:${opts.startAllocation.F} G:${opts.startAllocation.G}`);
  console.log(`Rules: window=${opts.window}mo margin=${opts.margin}pp drawdown-trigger=${opts.drawdown}% mode=${opts.mode} tilt=${opts.tilt}pp benchmark-L=${opts.lfund}\n`);

  const years = yearsBetween(prices[0].date, prices[prices.length - 1].date);

  const strategy = simulateRebalance(prices, opts);
  const strategyResult = summarize(strategy.endValue, strategy.equityCurve.map((p) => p.value), years);

  const blendSeries = blendedValueSeries(prices, opts.startAllocation, 0, prices.length - 1);
  const blendMult = blendSeries.length ? blendSeries[blendSeries.length - 1].value : null;
  const staticBlendResult = summarize(blendMult, blendSeries.map((p) => p.value), years);

  const staticCMult = simulateStaticHold(prices, 'C');
  const staticCValues = [];
  for (let i = 0; i < prices.length; i++) staticCValues.push(prices[i].C / prices[0].C);
  const staticCResult = summarize(staticCMult, staticCValues, years);

  let staticLResult = null;
  try {
    const lRaw = await loadLFundSeries(opts.lfund);
    const lSeries = lRaw.filter((row) => row.date >= prices[0].date && row.date <= prices[prices.length - 1].date);
    const staticLMult = simulateStaticHoldSeries(lSeries);
    staticLResult = { fund: opts.lfund, ...summarize(staticLMult, lSeries.map((p) => p.price), years) };
  } catch (err) {
    console.warn(`Warning: could not load ${opts.lfund} benchmark (${err.message}). Skipping L-fund comparison.`);
  }

  function fmtPct(v) { return v == null ? 'n/a' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`; }
  function fmtCagr(v) { return v == null ? 'n/a' : `${v.toFixed(2)}%/yr`; }

  console.log('Strategy                       Total Return   CAGR         Max Drawdown');
  console.log('----------------------------------------------------------------------');
  console.log(`Rebalance strategy              ${pad(fmtPct(strategyResult.totalReturnPct))} ${pad(fmtCagr(strategyResult.cagrPct))} ${strategyResult.maxDrawdownPct?.toFixed(2)}%`);
  console.log(`Static starting blend (buy&hold) ${pad(fmtPct(staticBlendResult.totalReturnPct))} ${pad(fmtCagr(staticBlendResult.cagrPct))} ${staticBlendResult.maxDrawdownPct?.toFixed(2)}%`);
  console.log(`Static 100% C Fund              ${pad(fmtPct(staticCResult.totalReturnPct))} ${pad(fmtCagr(staticCResult.cagrPct))} ${staticCResult.maxDrawdownPct?.toFixed(2)}%`);
  if (staticLResult) {
    console.log(`Static ${opts.lfund}${' '.repeat(Math.max(0, 8 - opts.lfund.length))}             ${pad(fmtPct(staticLResult.totalReturnPct))} ${pad(fmtCagr(staticLResult.cagrPct))} ${staticLResult.maxDrawdownPct?.toFixed(2)}%`);
  }

  const winRateVsC = winRate(prices, strategy.equityCurve, (d1, d2) => {
    if (!d1 || !d2) return null;
    const i1 = findIndexOnOrBefore(prices, d1);
    const i2 = findIndexOnOrBefore(prices, d2);
    if (i1 < 0 || i2 < 0) return null;
    return prices[i2].C / prices[i1].C - 1;
  });

  console.log(`\nWin rate vs static C Fund (by rebased monthly period): ${winRateVsC == null ? 'n/a' : winRateVsC.toFixed(1) + '%'}`);
  console.log(`Rebalance trades executed: ${strategy.trades.length}`);
  console.log(`Signals evaluated as actionable: ${strategy.evaluations.length}`);

  console.log('\nLast 10 trades:');
  for (const t of strategy.trades.slice(-10)) {
    console.log(`  ${t.date}  [${t.state}]`);
  }

  console.log('\nReminder: this is a rule-replay sanity check, not a guarantee. Per the spec, treat live');
  console.log('signals as informational only until this backtest has been reviewed across multiple');
  console.log('regimes AND the signal has been paper-traded for 30+ days.\n');

  if (opts.save) {
    const outPath = path.isAbsolute(opts.save) ? opts.save : path.join(__dirname, '..', opts.save);
    const output = {
      generatedAt: new Date().toISOString(),
      range: { start: prices[0].date, end: prices[prices.length - 1].date },
      rules: { windowMonths: opts.window, marginPct: opts.margin, drawdownTriggerPct: opts.drawdown, mode: opts.mode, tiltPct: opts.tilt },
      startAllocation: opts.startAllocation,
      strategy: strategyResult,
      staticBlend: staticBlendResult,
      staticC: staticCResult,
      staticL: staticLResult,
      winRatePct: winRateVsC,
      tradesCount: strategy.trades.length,
    };
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
    console.log(`Saved results to ${outPath}`);
  }
}

function pad(str, width = 14) {
  return String(str).padStart(width);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
