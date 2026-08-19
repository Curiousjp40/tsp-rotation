/**
 * Shared metrics/ranking math for the TSP rotation dashboard.
 *
 * Written as CommonJS so it can be `require()`d directly from Node scripts
 * (scripts/backtest.js) AND `import`ed from React components (webpack/CRA
 * handles the CJS interop fine for named exports). This keeps the live
 * dashboard and the backtest computing returns/Sharpe/drawdown/ranking with
 * exactly the same code — no risk of the two silently drifting apart.
 *
 * `prices` throughout is an array of rows sorted ASCENDING by date:
 *   [{ date: '2003-05-30', G: 10, F: 10, C: 10, S: 10, I: 10 }, ...]
 */

const CORE_FUNDS = ['C', 'S', 'I', 'F', 'G'];
const RISK_FREE_FUND = 'G';

// ---- date helpers -----------------------------------------------------

/** Parse an ISO 'YYYY-MM-DD' string as a UTC date (avoids local-TZ drift). */
function parseISO(dateStr) {
  return new Date(`${dateStr}T00:00:00Z`);
}

function formatISO(date) {
  return date.toISOString().slice(0, 10);
}

/** Subtract N calendar months from an ISO date string, return an ISO string. */
function subtractMonthsISO(dateStr, months) {
  const d = parseISO(dateStr);
  const result = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - months, d.getUTCDate()));
  return formatISO(result);
}

// ---- lookup -------------------------------------------------------------

/**
 * Binary search for the last index whose date is <= targetDateStr.
 * Returns -1 if targetDateStr is before the first row in `prices`.
 */
function findIndexOnOrBefore(prices, targetDateStr) {
  let lo = 0;
  let hi = prices.length - 1;
  let result = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (prices[mid].date <= targetDateStr) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}

/**
 * Resolve the start index for a trailing window of `windowMonths` calendar
 * months, ending at `asOfIndex`. Returns null if there isn't enough history.
 */
function windowStartIndex(prices, asOfIndex, windowMonths) {
  const asOfDate = prices[asOfIndex].date;
  const startDate = subtractMonthsISO(asOfDate, windowMonths);
  const idx = findIndexOnOrBefore(prices, startDate);
  return idx < 0 ? null : idx;
}

// ---- core math ------------------------------------------------------------

function trailingReturnPct(prices, fund, asOfIndex, windowMonths) {
  const startIdx = windowStartIndex(prices, asOfIndex, windowMonths);
  if (startIdx === null) return null;
  const startPrice = prices[startIdx][fund];
  const endPrice = prices[asOfIndex][fund];
  if (startPrice == null || endPrice == null) return null;
  return ((endPrice - startPrice) / startPrice) * 100;
}

/** Day-over-day % returns for `fund` across (startIdx, endIdx] — length endIdx-startIdx. */
function dailyReturns(prices, fund, startIdx, endIdx) {
  const out = [];
  for (let i = startIdx + 1; i <= endIdx; i++) {
    const prev = prices[i - 1][fund];
    const cur = prices[i][fund];
    if (prev == null || cur == null || prev === 0) continue;
    out.push(((cur - prev) / prev) * 100);
  }
  return out;
}

/** Sample standard deviation (n-1). Returns null for fewer than 2 points. */
function stdDev(values) {
  if (!values || values.length < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * "Sharpe-style" ratio per the TSP-specific convention:
 *   (fund trailing return - G Fund trailing return) / stdev(fund's daily
 *   returns over the same window)
 * NOT annualized — this is a relative-strength-vs-risk score, not a
 * textbook Sharpe ratio. Returns null if there isn't enough data.
 */
function sharpeStyleRatio(prices, fund, asOfIndex, windowMonths) {
  const startIdx = windowStartIndex(prices, asOfIndex, windowMonths);
  if (startIdx === null) return null;
  const fundReturn = trailingReturnPct(prices, fund, asOfIndex, windowMonths);
  const gReturn = trailingReturnPct(prices, RISK_FREE_FUND, asOfIndex, windowMonths);
  if (fundReturn == null || gReturn == null) return null;
  const sd = stdDev(dailyReturns(prices, fund, startIdx, asOfIndex));
  if (!sd) return null;
  return (fundReturn - gReturn) / sd;
}

/** Largest peak-to-trough % decline across a plain array of values (any series, any base). */
function maxDrawdownFromSeries(values) {
  let peak = -Infinity;
  let worst = 0;
  for (const v of values) {
    if (v == null) continue;
    if (v > peak) peak = v;
    if (peak > 0) {
      const dd = ((peak - v) / peak) * 100;
      if (dd > worst) worst = dd;
    }
  }
  return worst;
}

/** Largest peak-to-trough % decline for `fund` within [startIdx, asOfIndex]. */
function maxDrawdownPct(prices, fund, startIdx, asOfIndex) {
  const values = [];
  for (let i = startIdx; i <= asOfIndex; i++) values.push(prices[i][fund]);
  return maxDrawdownFromSeries(values);
}

function maxDrawdownForWindow(prices, fund, asOfIndex, windowMonths) {
  const startIdx = windowStartIndex(prices, asOfIndex, windowMonths);
  if (startIdx === null) return null;
  return maxDrawdownPct(prices, fund, startIdx, asOfIndex);
}

/** Trailing N-trading-day simple moving average of `fund`, ending at asOfIndex. */
function movingAverage(prices, fund, asOfIndex, n) {
  const startIdx = asOfIndex - n + 1;
  if (startIdx < 0) return null;
  let sum = 0;
  let count = 0;
  for (let i = startIdx; i <= asOfIndex; i++) {
    const price = prices[i][fund];
    if (price == null) return null;
    sum += price;
    count++;
  }
  return count === n ? sum / n : null;
}

/** Trend filter: is current price above its own trailing N-day moving average? */
function trendFilterPass(prices, fund, asOfIndex, n = 50) {
  const ma = movingAverage(prices, fund, asOfIndex, n);
  const price = prices[asOfIndex][fund];
  if (ma == null || price == null) return null;
  return price > ma;
}

/**
 * Cumulative trailing-return series for `fund` across the window, rebased
 * to 0% at the window start — what the RotationChart plots.
 */
function cumulativeReturnSeries(prices, fund, asOfIndex, windowMonths) {
  const startIdx = windowStartIndex(prices, asOfIndex, windowMonths);
  if (startIdx === null) return [];
  const basePrice = prices[startIdx][fund];
  if (basePrice == null) return [];
  const out = [];
  for (let i = startIdx; i <= asOfIndex; i++) {
    const price = prices[i][fund];
    if (price == null) continue;
    out.push({ date: prices[i].date, returnPct: ((price - basePrice) / basePrice) * 100 });
  }
  return out;
}

// ---- blended allocation math ---------------------------------------------
//
// A TSP allocation is a set of percentages across the five funds summing to
// 100, not a single fund. For a buy-and-hold blend (no daily rebalancing —
// real TSP accounts aren't auto-rebalanced either), the blended % return is
// EXACTLY the weight-averaged sum of each fund's own % return: if you put
// weight w_i into fund i at the start, value at any later point is
// Σ w_i·(1+r_i) = Σw_i + Σw_i·r_i = 1 + Σw_i·r_i (weights sum to 1), so
// blended return = Σ w_i·r_i exactly, not an approximation.

/** Convert an {C,S,I,F,G} allocation (percentages, may omit funds) to fractions summing to <=1. */
function weightsFromAllocation(allocation) {
  const weights = {};
  for (const fund of CORE_FUNDS) {
    weights[fund] = (allocation?.[fund] ?? 0) / 100;
  }
  return weights;
}

/** Funds actually held (weight > 0) in an allocation. */
function heldFunds(allocation, funds = CORE_FUNDS) {
  return funds.filter((f) => (allocation?.[f] ?? 0) > 0);
}

/**
 * Blended trailing return for `allocation` over `windowMonths`, ending at
 * asOfIndex. Returns null if any held fund lacks enough history for the window.
 */
function blendedReturnPct(prices, allocation, asOfIndex, windowMonths) {
  const weights = weightsFromAllocation(allocation);
  let total = 0;
  for (const fund of heldFunds(allocation)) {
    const r = trailingReturnPct(prices, fund, asOfIndex, windowMonths);
    if (r == null) return null;
    total += weights[fund] * r;
  }
  return total;
}

/**
 * Blended portfolio value series for `allocation` across [fromIndex, toIndex],
 * rebased to 1.0 at fromIndex. This is what actually gets charted, and what
 * blended drawdown/trend-filter/Sharpe-style are computed from — unlike
 * blendedReturnPct (a single window-end number), this needs the full path.
 */
function blendedValueSeries(prices, allocation, fromIndex, toIndex) {
  const weights = weightsFromAllocation(allocation);
  const held = heldFunds(allocation);
  if (held.length === 0) return [];
  const basePrices = {};
  for (const fund of held) {
    const p = prices[fromIndex]?.[fund];
    if (p == null) return [];
    basePrices[fund] = p;
  }
  const out = [];
  for (let i = fromIndex; i <= toIndex; i++) {
    let value = 1;
    let ok = true;
    for (const fund of held) {
      const price = prices[i][fund];
      if (price == null) { ok = false; break; }
      value += weights[fund] * (price / basePrices[fund] - 1);
    }
    if (ok) out.push({ date: prices[i].date, value });
  }
  return out;
}

/** Day-over-day % returns from a plain {value}[] series (e.g. blendedValueSeries). */
function dailyReturnsFromSeries(series) {
  const out = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1].value;
    const cur = series[i].value;
    if (prev === 0) continue;
    out.push(((cur - prev) / prev) * 100);
  }
  return out;
}

/** Blended max drawdown over a trailing window ending at asOfIndex. */
function blendedMaxDrawdownForWindow(prices, allocation, asOfIndex, windowMonths) {
  const startIdx = windowStartIndex(prices, asOfIndex, windowMonths);
  if (startIdx === null) return null;
  const series = blendedValueSeries(prices, allocation, startIdx, asOfIndex);
  if (series.length === 0) return null;
  return maxDrawdownFromSeries(series.map((p) => p.value));
}

/** Blended "Sharpe-style" ratio, same convention as sharpeStyleRatio: (blend - G) / stdev(blend's daily returns). */
function blendedSharpeStyleRatio(prices, allocation, asOfIndex, windowMonths) {
  const startIdx = windowStartIndex(prices, asOfIndex, windowMonths);
  if (startIdx === null) return null;
  const blendReturn = blendedReturnPct(prices, allocation, asOfIndex, windowMonths);
  const gReturn = trailingReturnPct(prices, RISK_FREE_FUND, asOfIndex, windowMonths);
  if (blendReturn == null || gReturn == null) return null;
  const series = blendedValueSeries(prices, allocation, startIdx, asOfIndex);
  const sd = stdDev(dailyReturnsFromSeries(series));
  if (!sd) return null;
  return (blendReturn - gReturn) / sd;
}

/** Is the blend's current value above its own trailing N-day moving average? */
function blendedTrendFilterPass(prices, allocation, asOfIndex, n = 50) {
  const fromIndex = asOfIndex - n + 1;
  if (fromIndex < 0) return null;
  const series = blendedValueSeries(prices, allocation, fromIndex, asOfIndex);
  if (series.length !== n) return null;
  const ma = series.reduce((sum, p) => sum + p.value, 0) / n;
  return series[series.length - 1].value > ma;
}

/**
 * Rank the five funds (including G — G is a legitimate leader during a
 * selloff, that's the whole point of the safe-harbor case) by trailing
 * return for `windowMonths`, richest metrics attached to each row. Sorted
 * descending by trailing return.
 */
function rankFunds(prices, asOfIndex, windowMonths, { maDays = 50, rankableFunds = CORE_FUNDS } = {}) {
  const rows = rankableFunds.map((fund) => ({
    fund,
    trailingReturnPct: trailingReturnPct(prices, fund, asOfIndex, windowMonths),
    sharpeStyleRatio: sharpeStyleRatio(prices, fund, asOfIndex, windowMonths),
    maxDrawdownPct: maxDrawdownForWindow(prices, fund, asOfIndex, windowMonths),
    trendPass: trendFilterPass(prices, fund, asOfIndex, maDays),
    price: prices[asOfIndex][fund],
  }));
  rows.sort((a, b) => (b.trailingReturnPct ?? -Infinity) - (a.trailingReturnPct ?? -Infinity));
  return rows;
}

module.exports = {
  CORE_FUNDS,
  RISK_FREE_FUND,
  parseISO,
  formatISO,
  subtractMonthsISO,
  findIndexOnOrBefore,
  windowStartIndex,
  trailingReturnPct,
  dailyReturns,
  stdDev,
  sharpeStyleRatio,
  maxDrawdownFromSeries,
  maxDrawdownPct,
  maxDrawdownForWindow,
  movingAverage,
  trendFilterPass,
  cumulativeReturnSeries,
  weightsFromAllocation,
  heldFunds,
  blendedReturnPct,
  blendedValueSeries,
  dailyReturnsFromSeries,
  blendedMaxDrawdownForWindow,
  blendedSharpeStyleRatio,
  blendedTrendFilterPass,
  rankFunds,
};
