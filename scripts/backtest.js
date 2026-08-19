#!/usr/bin/env node
/**
 * Standalone backtest runner. Replays the committed price history through
 * the exact same rule engine (src/lib/signals.js + src/lib/metrics.js) the
 * live dashboard uses, and compares the simulated rotation strategy against
 * two static benchmarks: 100% C Fund, and a static L Fund.
 *
 * This exists specifically so no signal from the live dashboard gets acted
 * on before its rule set has been validated across multiple market regimes
 * (2008, 2020, 2022 are all in the committed history). Do not treat a live
 * signal as real until this has run clean and, per the spec, until the
 * signal has been paper-traded for 30+ days.
 *
 * Usage:
 *   node scripts/backtest.js [--window=3] [--margin=2] [--drawdown=8]
 *                             [--lfund=L2050] [--start=YYYY-MM-DD] [--end=YYYY-MM-DD]
 */

const fs = require('fs');
const path = require('path');
const { evaluateRotationSignal } = require('../src/lib/signals');
const { findIndexOnOrBefore, maxDrawdownPct } = require('../src/lib/metrics');

const DATA_PATH = path.join(__dirname, '..', 'public', 'data', 'tsp-prices.json');

function parseArgs(argv) {
  const args = { window: 3, margin: 2, drawdown: 8, lfund: 'L2050', start: null, end: null };
  for (const raw of argv) {
    const m = raw.match(/^--([^=]+)=(.*)$/);
    if (!m) continue;
    const [, key, val] = m;
    if (key in args) args[key] = val;
  }
  args.window = Number(args.window);
  args.margin = Number(args.margin);
  args.drawdown = Number(args.drawdown);
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
  const col = lfund.replace('L', 'L ').replace('L Income', 'L Income'); // 'L2050' -> 'L 2050'
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

/**
 * Simulate the rotation strategy over `prices` (already sliced to the
 * backtest window). Returns { equityCurve, trades, evaluations }.
 */
function simulateRotation(prices, opts) {
  let holding = 'G';
  let value = 1; // normalized starting value
  let lastRebaseIdx = 0;
  let lastRebasePrice = prices[0][holding];
  let holdingSinceIndex = 0; // index the CURRENT position was entered, for the standing defensive rule
  const trades = [];
  const evaluations = [];
  const equityCurve = [{ date: prices[0].date, value }];

  // Track unrestricted transfers used per calendar month, exactly like the
  // live dashboard's transfer log would.
  const transfersByMonth = new Map();

  function usedThisMonth(dateStr) {
    return transfersByMonth.get(dateStr.slice(0, 7)) || 0;
  }
  function recordTransfer(dateStr) {
    const ym = dateStr.slice(0, 7);
    transfersByMonth.set(ym, (transfersByMonth.get(ym) || 0) + 1);
  }

  function markToMarket(idx) {
    const price = prices[idx][holding];
    value = value * (price / lastRebasePrice);
    lastRebasePrice = price;
    lastRebaseIdx = idx;
  }

  for (let i = 1; i < prices.length; i++) {
    markToMarket(i);
    equityCurve.push({ date: prices[i].date, value });

    const signal = evaluateRotationSignal(prices, i, {
      windowMonths: opts.window,
      marginPct: opts.margin,
      currentHolding: holding,
      transfersUsedThisMonth: usedThisMonth(prices[i].date),
      drawdownTriggerPct: opts.drawdown,
      holdingSinceIndex,
    });

    if (signal.state === 'no-signal' || signal.state === 'pending-evaluation' || signal.state === 'capped') {
      continue;
    }

    if ((signal.state === 'actionable' || signal.state === 'actionable-safe-harbor') && signal.target && signal.target !== holding) {
      evaluations.push(signal);
      if (signal.state === 'actionable') {
        recordTransfer(prices[i].date);
      }
      trades.push({ date: prices[i].date, from: holding, to: signal.target, state: signal.state });
      holding = signal.target;
      lastRebasePrice = prices[i][holding];
      holdingSinceIndex = i;
    }
  }

  return { equityCurve, trades, evaluations, finalHolding: holding, endValue: value };
}

function simulateStaticHold(prices, fund) {
  const start = prices[0][fund];
  const end = prices[prices.length - 1][fund];
  return end / start;
}

function simulateStaticHoldSeries(series) {
  if (series.length === 0) return null;
  return series[series.length - 1].price / series[0].price;
}

/** Win rate: % of month-long rebased periods where rotation beat the static benchmark. */
function winRate(prices, rotationEquity, benchmarkFn) {
  let wins = 0;
  let total = 0;
  const byMonth = new Map();
  rotationEquity.forEach((pt, i) => byMonth.set(pt.date.slice(0, 7), i));
  const months = [...byMonth.keys()];
  for (let m = 1; m < months.length; m++) {
    const prevIdx = byMonth.get(months[m - 1]);
    const curIdx = byMonth.get(months[m]);
    const rotationReturn = rotationEquity[curIdx].value / rotationEquity[prevIdx].value - 1;
    const benchReturn = benchmarkFn(prices[prevIdx]?.date, prices[curIdx]?.date);
    if (benchReturn == null) continue;
    total++;
    if (rotationReturn > benchReturn) wins++;
  }
  return total > 0 ? (wins / total) * 100 : null;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const allPrices = loadPrices();
  const prices = sliceByDateRange(allPrices, opts.start, opts.end);

  if (prices.length < 60) {
    throw new Error('Not enough data in the selected range to backtest (need at least ~60 trading days).');
  }

  console.log(`\nTSP Rotation Backtest`);
  console.log(`Range: ${prices[0].date} .. ${prices[prices.length - 1].date} (${prices.length} trading days)`);
  console.log(`Rules: window=${opts.window}mo margin=${opts.margin}pp drawdown-trigger=${opts.drawdown}% benchmark-L=${opts.lfund}\n`);

  const rotation = simulateRotation(prices, opts);
  const years = yearsBetween(prices[0].date, prices[prices.length - 1].date);

  const staticC = simulateStaticHold(prices, 'C');
  const cDrawdown = maxDrawdownPct(prices, 'C', 0, prices.length - 1);
  const rotationDrawdown = maxDrawdownFromEquity(rotation.equityCurve);

  let lSeries = null;
  let staticL = null;
  try {
    const lRaw = await loadLFundSeries(opts.lfund);
    lSeries = sliceLSeriesByDateRange(lRaw, prices[0].date, prices[prices.length - 1].date);
    staticL = simulateStaticHoldSeries(lSeries);
  } catch (err) {
    console.warn(`Warning: could not load ${opts.lfund} benchmark (${err.message}). Skipping L-fund comparison.`);
  }

  function fmtMult(mult) {
    return mult == null ? 'n/a' : `${((mult - 1) * 100).toFixed(1)}%`;
  }
  function fmtCagr(mult) {
    return mult == null ? 'n/a' : `${cagr(1, mult, years).toFixed(2)}%/yr`;
  }

  console.log('Strategy            Total Return   CAGR         Max Drawdown');
  console.log('-------------------------------------------------------------');
  console.log(`Rotation strategy    ${pad(fmtMult(rotation.endValue))} ${pad(fmtCagr(rotation.endValue))} ${rotationDrawdown.toFixed(2)}%`);
  console.log(`Static 100% C Fund   ${pad(fmtMult(staticC))} ${pad(fmtCagr(staticC))} ${cDrawdown.toFixed(2)}%`);
  if (staticL != null) {
    const lDrawdown = maxDrawdownFromSeries(lSeries);
    console.log(`Static ${opts.lfund}${' '.repeat(Math.max(0, 8 - opts.lfund.length))}   ${pad(fmtMult(staticL))} ${pad(fmtCagr(staticL))} ${lDrawdown.toFixed(2)}%`);
  }

  const winRateVsC = winRate(prices, rotation.equityCurve, (d1, d2) => {
    if (!d1 || !d2) return null;
    const i1 = findIndexOnOrBefore(prices, d1);
    const i2 = findIndexOnOrBefore(prices, d2);
    if (i1 < 0 || i2 < 0) return null;
    return prices[i2].C / prices[i1].C - 1;
  });

  console.log(`\nWin rate vs static C Fund (by rebased monthly period): ${winRateVsC == null ? 'n/a' : winRateVsC.toFixed(1) + '%'}`);
  console.log(`Rotation trades executed: ${rotation.trades.length}`);
  console.log(`Signals evaluated as actionable: ${rotation.evaluations.length}`);
  console.log(`Ended holding: ${rotation.finalHolding}`);

  console.log('\nLast 10 trades:');
  for (const t of rotation.trades.slice(-10)) {
    console.log(`  ${t.date}  ${t.from} -> ${t.to}  [${t.state}]`);
  }

  console.log('\nReminder: this is a rule-replay sanity check, not a guarantee. Per the spec, treat live');
  console.log('signals as informational only until this backtest has been reviewed across multiple');
  console.log('regimes AND the signal has been paper-traded for 30+ days.\n');
}

function pad(str, width = 12) {
  return String(str).padStart(width);
}

function maxDrawdownFromEquity(equityCurve) {
  let peak = -Infinity;
  let worst = 0;
  for (const pt of equityCurve) {
    if (pt.value > peak) peak = pt.value;
    const dd = ((peak - pt.value) / peak) * 100;
    if (dd > worst) worst = dd;
  }
  return worst;
}

function maxDrawdownFromSeries(series) {
  let peak = -Infinity;
  let worst = 0;
  for (const pt of series) {
    if (pt.price > peak) peak = pt.price;
    const dd = ((peak - pt.price) / peak) * 100;
    if (dd > worst) worst = dd;
  }
  return worst;
}

function sliceLSeriesByDateRange(series, start, end) {
  return series.filter((row) => row.date >= start && row.date <= end);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
