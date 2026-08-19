import { useState, useMemo } from 'react';
import { resolvePeriod, blendedReturnBetween, returnBetween, CORE_FUNDS } from '../lib/metrics';

const PERIODS = [
  { id: '1m', label: '1 Month', period: { kind: 'months', months: 1 } },
  { id: '3m', label: '3 Months', period: { kind: 'months', months: 3 } },
  { id: '6m', label: '6 Months', period: { kind: 'months', months: 6 } },
  { id: '1y', label: '1 Year', period: { kind: 'months', months: 12 } },
  { id: 'ytd', label: 'YTD', period: { kind: 'ytd' } },
  { id: 'custom', label: 'Custom range', period: null },
];

// "100% C Fund" is the historically best-returning static option from the
// backtest's benchmarks (see Backtest results in Advanced / experimental).
const PRESETS = [
  { id: 'c100', label: '100% C Fund', allocation: { C: 100, S: 0, I: 0, F: 0, G: 0 } },
  { id: 'even', label: 'Even split', allocation: { C: 20, S: 20, I: 20, F: 20, G: 20 } },
  { id: 'current', label: 'Your current holding' },
];

function fmtPct(v) {
  return v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

export default function Calculator({ prices, asOfIndex, allocation, onAllocationChange, lastLoggedAllocation }) {
  const [periodId, setPeriodId] = useState('ytd');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const period = useMemo(() => {
    if (periodId === 'custom') {
      return customStart ? { kind: 'custom', start: customStart, end: customEnd || undefined } : null;
    }
    return PERIODS.find((p) => p.id === periodId)?.period ?? null;
  }, [periodId, customStart, customEnd]);

  const resolved = useMemo(() => (period ? resolvePeriod(prices, asOfIndex, period) : null), [prices, asOfIndex, period]);

  const blended = resolved ? blendedReturnBetween(prices, allocation, resolved.startIndex, resolved.endIndex) : null;
  const fundReturns = resolved
    ? CORE_FUNDS.map((fund) => ({ fund, returnPct: returnBetween(prices, fund, resolved.startIndex, resolved.endIndex) }))
    : [];

  const periodLabel = PERIODS.find((p) => p.id === periodId)?.label;
  const rangeLabel = resolved ? `${prices[resolved.startIndex].date} to ${prices[resolved.endIndex].date}` : null;

  function applyPreset(preset) {
    onAllocationChange(preset.id === 'current' ? lastLoggedAllocation : preset.allocation);
  }

  return (
    <div className="card">
      <div className="card-title">
        <span><span className="icon">🧮</span>Return calculator</span>
      </div>

      <div className="window-toggle" style={{ flexWrap: 'wrap' }}>
        {PERIODS.map((p) => (
          <button key={p.id} type="button" className={periodId === p.id ? 'active' : ''} onClick={() => setPeriodId(p.id)}>{p.label}</button>
        ))}
      </div>

      {periodId === 'custom' && (
        <div className="field-row" style={{ marginTop: '.8rem' }}>
          <div className="field">
            <label htmlFor="calc-start">Start date</label>
            <input id="calc-start" type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="calc-end">End date (optional — defaults to latest)</label>
            <input id="calc-end" type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
          </div>
        </div>
      )}

      <div className="field-row" style={{ margin: '1rem 0 .5rem' }}>
        <span className="stat-note" style={{ alignSelf: 'center' }}>Quick presets:</span>
        {PRESETS.map((p) => (
          <button key={p.id} type="button" className="btn btn-sm" onClick={() => applyPreset(p)}>{p.label}</button>
        ))}
      </div>

      {!resolved && (
        <div className="signal-alert">
          Not enough data for this period{periodId === 'custom' && !customStart ? ' — pick a start date above' : ''}.
        </div>
      )}

      {resolved && (
        <>
          <div style={{ margin: '1rem 0' }}>
            <div className="stat-label">Your blend would have returned ({periodLabel}{rangeLabel ? `, ${rangeLabel}` : ''})</div>
            <div className={blended != null && blended >= 0 ? 'pos' : 'neg'} style={{ fontSize: '2.4rem', fontWeight: 800, lineHeight: 1.2 }}>
              {fmtPct(blended)}
            </div>
          </div>

          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>Fund</th><th className="num">Return, same period</th></tr></thead>
              <tbody>
                {fundReturns.map((r) => (
                  <tr key={r.fund}>
                    <td><span className={`badge badge-fund fund-${r.fund}`}>{r.fund}</span></td>
                    <td className={`num ${r.returnPct != null && r.returnPct >= 0 ? 'pos' : 'neg'}`}>{fmtPct(r.returnPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="chart-legend-note" style={{ marginTop: '.8rem' }}>
        A plain calculation, not a recommendation — a 192-combination parameter search (see "Advanced / experimental" below)
        found no rule set that beats simply holding C Fund both in-sample and out-of-sample. Deciding a target allocation
        is a personal call (risk tolerance, time horizon), not something this tool asserts as optimized.
      </div>
    </div>
  );
}
