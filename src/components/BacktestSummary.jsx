import { useState, useEffect } from 'react';

function fmtPct(v) {
  return v == null ? 'n/a' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}

export default function BacktestSummary() {
  const [results, setResults] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ok | missing

  useEffect(() => {
    fetch(`${process.env.PUBLIC_URL}/data/backtest-results.json`)
      .then((res) => {
        if (!res.ok) throw new Error('missing');
        return res.json();
      })
      .then((json) => { setResults(json); setStatus('ok'); })
      .catch(() => setStatus('missing'));
  }, []);

  return (
    <div className="card">
      <div className="card-title">
        <span><span className="icon">🧪</span>Backtest results</span>
      </div>

      {status === 'loading' && <div className="stat-note">Loading…</div>}

      {status === 'missing' && (
        <div className="signal-alert">
          Backtest hasn't been run yet — no results to show. Don't treat any live signal as real until it has been. Run:
          {' '}<code>npm run backtest -- --save</code>
        </div>
      )}

      {status === 'ok' && results && (
        <>
          <div className="stat-note" style={{ marginBottom: '.7rem' }}>
            Generated {new Date(results.generatedAt).toLocaleString()} · range {results.range?.start} – {results.range?.end} ·
            rules: {results.rules?.windowMonths}mo window, {results.rules?.marginPct}pp margin, {results.rules?.mode} mode,
            {' '}{results.rules?.drawdownTriggerPct}% drawdown trigger
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>Strategy</th><th className="num">Total return</th><th className="num">CAGR</th><th className="num">Max drawdown</th></tr>
              </thead>
              <tbody>
                <tr className="leader-row">
                  <td>Rebalance strategy</td>
                  <td className="num">{fmtPct(results.strategy?.totalReturnPct)}</td>
                  <td className="num">{fmtPct(results.strategy?.cagrPct)}</td>
                  <td className="num neg">-{results.strategy?.maxDrawdownPct?.toFixed(1)}%</td>
                </tr>
                <tr>
                  <td>Static starting blend (buy &amp; hold)</td>
                  <td className="num">{fmtPct(results.staticBlend?.totalReturnPct)}</td>
                  <td className="num">{fmtPct(results.staticBlend?.cagrPct)}</td>
                  <td className="num neg">-{results.staticBlend?.maxDrawdownPct?.toFixed(1)}%</td>
                </tr>
                <tr>
                  <td>Static 100% C Fund</td>
                  <td className="num">{fmtPct(results.staticC?.totalReturnPct)}</td>
                  <td className="num">{fmtPct(results.staticC?.cagrPct)}</td>
                  <td className="num neg">-{results.staticC?.maxDrawdownPct?.toFixed(1)}%</td>
                </tr>
                {results.staticL && (
                  <tr>
                    <td>Static {results.staticL.fund}</td>
                    <td className="num">{fmtPct(results.staticL?.totalReturnPct)}</td>
                    <td className="num">{fmtPct(results.staticL?.cagrPct)}</td>
                    <td className="num neg">-{results.staticL?.maxDrawdownPct?.toFixed(1)}%</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="chart-legend-note" style={{ marginTop: '.6rem' }}>
            Win rate vs. static C Fund (by rebased monthly period): <strong>{results.winRatePct == null ? 'n/a' : `${results.winRatePct.toFixed(1)}%`}</strong>
            {' '}· {results.tradesCount} trades simulated. A strategy that wins big once and loses small often has an ugly
            underlying track record that total return alone hides — win rate is the more honest number.
          </div>
        </>
      )}
    </div>
  );
}
