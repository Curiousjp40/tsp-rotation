import { useState, useMemo } from 'react';
import { topTwoReturnSplit } from '../lib/metrics';

function fmtPct(v) {
  return v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

/**
 * Top-2-by-trailing-return split, computed live: NOT the calculator (which
 * uses whatever allocation you typed in) and NOT the Advanced/experimental
 * tilt signal (which reweights gradually off your actual holding). This is
 * its own specific formula, on permanent display with its own permanent
 * caveat — see topTwoReturnSplit's own doc comment in lib/metrics.js for
 * exactly why that caveat is non-negotiable: it's the same "rank by
 * trailing return, weight the leaders" rule family the 192-combination
 * sweep already tested and rejected. The caveat sits at the same visual
 * weight as the number itself, in the same row, never behind a toggle.
 */
export default function TopTwoSplit({ prices, asOfIndex, onLogTransfer }) {
  const [logResult, setLogResult] = useState(null);
  const result = useMemo(() => topTwoReturnSplit(prices, asOfIndex, 3), [prices, asOfIndex]);

  if (!result) {
    return (
      <div className="card">
        <div className="card-title"><span><span className="icon">🧭</span>Top-2 momentum split (3-month)</span></div>
        <div className="stat-note">Not enough price history yet to compute this.</div>
      </div>
    );
  }

  const { first, second, allocation, fellBack } = result;

  function handleLog() {
    const today = new Date().toISOString().slice(0, 10);
    setLogResult(onLogTransfer({ date: today, allocation }));
  }

  return (
    <div className="card">
      <div className="card-title">
        <span><span className="icon">🧭</span>Top-2 momentum split (3-month trailing)</span>
      </div>

      <div className="top2-row">
        <div className="top2-cell">
          <div className="stat-label">Computed split</div>
          <div className="top2-number">
            <span className={`badge badge-fund fund-${first.fund}`}>{first.fund}</span> {allocation[first.fund]}%
            {'  /  '}
            <span className={`badge badge-fund fund-${second.fund}`}>{second.fund}</span> {allocation[second.fund]}%
          </div>
          <div className="stat-note" style={{ marginTop: '.35rem' }}>
            {first.fund} Fund: {fmtPct(first.returnPct)} (3mo) · {second.fund} Fund: {fmtPct(second.returnPct)} (3mo)
            {fellBack && ' · fell back to an even 50/50 split — return ÷ sum-of-returns only works as a percentage when both are positive'}
          </div>
        </div>

        <div className="top2-cell signal-alert top2-caveat">
          Computed live, not validated — same rule family the 192-combination sweep already tested and rejected.
        </div>

        <div className="top2-cell top2-action">
          <button type="button" className="btn btn-primary" onClick={handleLog}>
            Log this as your real transfer
          </button>
          {logResult && !logResult.ok && <div className="stat-note" style={{ marginTop: '.5rem' }}>{logResult.reason}</div>}
          {logResult?.ok && <div className="stat-note" style={{ marginTop: '.5rem' }}>Logged.</div>}
        </div>
      </div>
    </div>
  );
}
