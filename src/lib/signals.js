/**
 * Rotation decision engine. Pure functions (no localStorage, no Date.now())
 * so the exact same rules drive the live dashboard and scripts/backtest.js.
 * CommonJS for the same reason as metrics.js.
 */

const { rankFunds, maxDrawdownPct } = require('./metrics');

const G = 'G';

/** True if the row at `idx` is the first trading day of its calendar month. */
function isFirstTradingDayOfMonth(prices, idx) {
  if (idx === 0) return true;
  return prices[idx].date.slice(0, 7) !== prices[idx - 1].date.slice(0, 7);
}

/** True if the row at `idx` is the first trading day on/after the 15th of its month. */
function isFirstTradingDayOnOrAfter15th(prices, idx) {
  const day = Number(prices[idx].date.slice(8, 10));
  if (day < 15) return false;
  if (idx === 0) return true;
  const prevDay = Number(prices[idx - 1].date.slice(8, 10));
  const samMonth = prices[idx].date.slice(0, 7) === prices[idx - 1].date.slice(0, 7);
  return !samMonth || prevDay < 15;
}

/**
 * Twice-monthly evaluation cadence: new rotation signals are only meant to
 * be *acted on* around these dates, matching realistic transfer cadence
 * rather than daily noise. (The standing defensive drawdown rule below is
 * explicitly exempt from this gate.)
 */
function isEvaluationDay(prices, idx) {
  return isFirstTradingDayOfMonth(prices, idx) || isFirstTradingDayOnOrAfter15th(prices, idx);
}

/**
 * Recent-peak drawdown for the currently held fund, independent of the
 * ranking window — this is the "standing defensive rule" and can fire any
 * day, capped-transfers or not, since a move into G is always uncapped.
 *
 * The peak is bounded by BOTH the recent-lookback cap AND the date the
 * position was entered (`holdingSinceIndex`), whichever is more recent.
 * Without the entry bound, a fund you bought yesterday could "trigger" off
 * a peak from before you owned it — that's not your position drawing down,
 * it's an unrelated pre-existing dip, and treating it as a signal causes a
 * flee-the-day-after-every-purchase whipsaw.
 */
function standingDefensiveCheck(prices, asOfIndex, currentHolding, {
  recentPeakLookbackDays = 60,
  drawdownTriggerPct = 8,
  holdingSinceIndex = null,
} = {}) {
  if (currentHolding === G) {
    return { triggered: false, drawdownPct: 0 };
  }
  const lookbackStart = asOfIndex - recentPeakLookbackDays + 1;
  const startIdx = Math.max(0, lookbackStart, holdingSinceIndex ?? -Infinity);
  const drawdownPct = maxDrawdownPct(prices, currentHolding, startIdx, asOfIndex);
  return { triggered: drawdownPct >= drawdownTriggerPct, drawdownPct };
}

/**
 * Evaluate the rotation signal as of `asOfIndex`.
 *
 * @param {number} transfersUsedThisMonth - unrestricted transfers already
 *   used in the *current* calendar month (caller derives this — from
 *   localStorage on the live dashboard, from the simulated running count
 *   in the backtest).
 */
function evaluateRotationSignal(prices, asOfIndex, {
  windowMonths = 3,
  marginPct = 2,
  currentHolding = G,
  transfersUsedThisMonth = 0,
  regimeOff = false,
  recentPeakLookbackDays = 60,
  drawdownTriggerPct = 8,
  maDays = 50,
  holdingSinceIndex = null,
} = {}) {
  const ranking = rankFunds(prices, asOfIndex, windowMonths, { maDays });
  const leader = ranking[0];
  const currentRow = currentHolding === G
    ? { fund: G, trailingReturnPct: null, sharpeStyleRatio: null, maxDrawdownPct: null, trendPass: null, price: prices[asOfIndex][G] }
    : ranking.find((r) => r.fund === currentHolding);

  const gTrailingReturnPct = require('./metrics').trailingReturnPct(prices, G, asOfIndex, windowMonths);
  const currentReturnPct = currentHolding === G ? gTrailingReturnPct : currentRow?.trailingReturnPct;
  const edgePct = leader && currentReturnPct != null && leader.trailingReturnPct != null
    ? leader.trailingReturnPct - currentReturnPct
    : null;

  const meetsMargin = edgePct != null && leader.fund !== currentHolding && edgePct > marginPct;
  const transfersRemaining = Math.max(0, 2 - transfersUsedThisMonth);
  const evaluationDay = isEvaluationDay(prices, asOfIndex);

  const standingDefensive = standingDefensiveCheck(prices, asOfIndex, currentHolding, {
    recentPeakLookbackDays,
    drawdownTriggerPct,
    holdingSinceIndex,
  });

  let state = 'no-signal';
  let target = null;
  let reason = null;

  if (standingDefensive.triggered) {
    // Always fires, any day, uncapped (safe-harbor move into G).
    state = 'actionable-safe-harbor';
    target = G;
    reason = 'standing-defensive';
  } else if (meetsMargin && evaluationDay) {
    target = leader.fund;
    reason = 'margin';
    if (transfersRemaining > 0) {
      state = regimeOff && target !== G ? 'suppressed-by-regime' : 'actionable';
    } else if (target === G) {
      state = 'actionable-safe-harbor';
    } else {
      state = 'capped';
    }
  } else if (meetsMargin && !evaluationDay) {
    state = 'pending-evaluation';
    target = leader.fund;
    reason = 'margin';
  }

  return {
    date: prices[asOfIndex].date,
    windowMonths,
    marginPct,
    currentHolding,
    ranking,
    leader,
    currentReturnPct,
    edgePct,
    meetsMargin,
    evaluationDay,
    transfersRemaining,
    transfersUsedThisMonth,
    regimeOff,
    standingDefensive,
    drawdownTriggerPct,
    state,
    target,
    reason,
  };
}

module.exports = {
  isFirstTradingDayOfMonth,
  isFirstTradingDayOnOrAfter15th,
  isEvaluationDay,
  standingDefensiveCheck,
  evaluateRotationSignal,
};
