/**
 * Rebalancing decision engine. Pure functions (no localStorage, no
 * Date.now()) so the exact same rules drive the live dashboard and
 * scripts/backtest.js. CommonJS for the same reason as metrics.js.
 *
 * v2: the holding is a weighted allocation across all five funds, not a
 * single fund — see SPEC.md section 3. "Should I switch" becomes "how much
 * weight should shift, and toward what."
 */

const {
  rankFunds,
  blendedReturnPct,
  blendedValueSeries,
  maxDrawdownFromSeries,
  heldFunds,
  CORE_FUNDS,
} = require('./metrics');

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
  const sameMonth = prices[idx].date.slice(0, 7) === prices[idx - 1].date.slice(0, 7);
  return !sameMonth || prevDay < 15;
}

/**
 * Twice-monthly evaluation cadence: new rebalance signals are only meant to
 * be *acted on* around these dates, matching realistic transfer cadence
 * rather than daily noise. (The standing defensive drawdown rule below is
 * explicitly exempt from this gate.) Exposed as a pair of concrete anchor
 * descriptions too, so the UI can show the full schedule, not just the
 * next date.
 */
function isEvaluationDay(prices, idx) {
  return isFirstTradingDayOfMonth(prices, idx) || isFirstTradingDayOnOrAfter15th(prices, idx);
}

/**
 * Recent-peak drawdown for the blended allocation, independent of the
 * ranking window — the "standing defensive rule," can fire any day,
 * capped-transfers or not, since increasing G's weight is always uncapped.
 *
 * The peak is bounded by BOTH the recent-lookback cap AND the date the
 * allocation was last set (`allocationSinceIndex`), whichever is more
 * recent — without that bound, a fresh allocation could "trigger" off a
 * peak from before it was ever held. A blend that's 100% G naturally never
 * triggers (its value series is essentially flat), so no special-case is
 * needed the way v1 needed one for a single G holding.
 */
function standingDefensiveCheck(prices, asOfIndex, allocation, {
  recentPeakLookbackDays = 60,
  drawdownTriggerPct = 8,
  allocationSinceIndex = null,
} = {}) {
  if (heldFunds(allocation).length === 0) {
    return { triggered: false, drawdownPct: 0 };
  }
  const lookbackStart = asOfIndex - recentPeakLookbackDays + 1;
  const startIdx = Math.max(0, lookbackStart, allocationSinceIndex ?? -Infinity);
  const series = blendedValueSeries(prices, allocation, startIdx, asOfIndex);
  const drawdownPct = maxDrawdownFromSeries(series.map((p) => p.value));
  return { triggered: drawdownPct >= drawdownTriggerPct, drawdownPct };
}

/** Round to 1 decimal place — allocation math accumulates float noise otherwise. */
function round1(n) {
  return Math.round(n * 10) / 10;
}

/**
 * Suggested reweighting for a signal that fired: shift `tiltPct` points
 * (capped at what's actually held) from the current biggest laggard among
 * HELD funds toward the leader. 'full' mode moves everything to the leader
 * instead. Never proposes taking weight from a fund at 0%.
 */
function proposeReweighting(ranking, allocation, leaderFund, { mode = 'tilt', tiltPct = 12 } = {}) {
  if (mode === 'full') {
    const full = Object.fromEntries(CORE_FUNDS.map((f) => [f, 0]));
    full[leaderFund] = 100;
    return { proposedAllocation: full, laggard: null, tiltAmount: 100 - (allocation[leaderFund] ?? 0) };
  }

  const held = heldFunds(allocation).filter((f) => f !== leaderFund);
  if (held.length === 0) {
    return { proposedAllocation: { ...allocation }, laggard: null, tiltAmount: 0 };
  }
  // Lowest trailing return among held (non-leader) funds — ties broken by
  // ranking's own C,S,I,F,G stable order.
  const laggard = [...held].sort((a, b) => {
    const ra = ranking.find((r) => r.fund === a)?.trailingReturnPct ?? Infinity;
    const rb = ranking.find((r) => r.fund === b)?.trailingReturnPct ?? Infinity;
    return ra - rb;
  })[0];

  const tiltAmount = Math.min(tiltPct, allocation[laggard] ?? 0);
  const proposedAllocation = { ...allocation };
  proposedAllocation[laggard] = round1((proposedAllocation[laggard] ?? 0) - tiltAmount);
  proposedAllocation[leaderFund] = round1((proposedAllocation[leaderFund] ?? 0) + tiltAmount);

  return { proposedAllocation, laggard, tiltAmount };
}

/** True if `proposed` only ever increases G's weight and never increases any other fund's weight. */
function isPureGSafeHarbor(allocation, proposed) {
  if ((proposed.G ?? 0) <= (allocation.G ?? 0)) return false;
  return CORE_FUNDS.filter((f) => f !== G).every((f) => (proposed[f] ?? 0) <= (allocation[f] ?? 0));
}

/**
 * Evaluate the rebalance signal as of `asOfIndex`.
 *
 * @param {number} transfersUsedThisMonth - unrestricted transfers already
 *   used in the *current* calendar month (caller derives this — from the
 *   transfer log on the live dashboard, from the simulated running count
 *   in the backtest).
 */
function evaluateRebalanceSignal(prices, asOfIndex, {
  windowMonths = 3,
  marginPct = 2,
  allocation = { C: 0, S: 0, I: 0, F: 0, G: 100 },
  transfersUsedThisMonth = 0,
  regimeOff = false,
  recentPeakLookbackDays = 60,
  drawdownTriggerPct = 8,
  maDays = 50,
  allocationSinceIndex = null,
  mode = 'tilt',
  tiltPct = 12,
} = {}) {
  const ranking = rankFunds(prices, asOfIndex, windowMonths, { maDays });
  const leader = ranking[0];
  const blendedReturn = blendedReturnPct(prices, allocation, asOfIndex, windowMonths);

  const edgePct = leader && blendedReturn != null && leader.trailingReturnPct != null
    ? leader.trailingReturnPct - blendedReturn
    : null;

  const alreadyFullyLeader = (allocation[leader?.fund] ?? 0) >= 99.5;
  const meetsMargin = edgePct != null && !alreadyFullyLeader && edgePct > marginPct;
  const transfersRemaining = Math.max(0, 2 - transfersUsedThisMonth);
  const evaluationDay = isEvaluationDay(prices, asOfIndex);

  const standingDefensive = standingDefensiveCheck(prices, asOfIndex, allocation, {
    recentPeakLookbackDays,
    drawdownTriggerPct,
    allocationSinceIndex,
  });

  let state = 'no-signal';
  let reason = null;
  let proposedAllocation = null;
  let laggard = null;
  let tiltAmount = 0;
  let hindsightReturnPct = null;

  if (standingDefensive.triggered) {
    // Always fires, any day, uncapped: tilt the full held-non-G weight into G.
    reason = 'standing-defensive';
    const reweight = proposeReweighting(ranking, allocation, G, { mode: 'full' });
    proposedAllocation = reweight.proposedAllocation;
    tiltAmount = reweight.tiltAmount;
    state = 'actionable-safe-harbor';
  } else if (meetsMargin && evaluationDay) {
    reason = 'margin';
    hindsightReturnPct = leader.trailingReturnPct;
    const reweight = proposeReweighting(ranking, allocation, leader.fund, { mode, tiltPct });
    proposedAllocation = reweight.proposedAllocation;
    laggard = reweight.laggard;
    tiltAmount = reweight.tiltAmount;

    const safeHarbor = isPureGSafeHarbor(allocation, proposedAllocation);
    if (safeHarbor) {
      state = 'actionable-safe-harbor';
    } else if (transfersRemaining > 0) {
      state = regimeOff ? 'suppressed-by-regime' : 'actionable';
    } else {
      state = 'capped';
    }
  } else if (meetsMargin && !evaluationDay) {
    state = 'pending-evaluation';
    reason = 'margin';
    hindsightReturnPct = leader.trailingReturnPct;
    const reweight = proposeReweighting(ranking, allocation, leader.fund, { mode, tiltPct });
    proposedAllocation = reweight.proposedAllocation;
    laggard = reweight.laggard;
    tiltAmount = reweight.tiltAmount;
  }

  return {
    date: prices[asOfIndex].date,
    windowMonths,
    marginPct,
    allocation,
    ranking,
    leader,
    blendedReturn,
    edgePct,
    meetsMargin,
    evaluationDay,
    transfersRemaining,
    transfersUsedThisMonth,
    regimeOff,
    standingDefensive,
    drawdownTriggerPct,
    mode,
    tiltPct,
    state,
    reason,
    proposedAllocation,
    laggard,
    tiltAmount,
    hindsightReturnPct,
  };
}

module.exports = {
  isFirstTradingDayOfMonth,
  isFirstTradingDayOnOrAfter15th,
  isEvaluationDay,
  standingDefensiveCheck,
  proposeReweighting,
  isPureGSafeHarbor,
  evaluateRebalanceSignal,
};
