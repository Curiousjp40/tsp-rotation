function fmtPct(v, digits = 2) {
  return v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`;
}
function fmtRatio(v) {
  return v == null ? '—' : v.toFixed(2);
}

export default function RankingTable({ ranking, blended, allocation, windowMonths }) {
  const leaderFund = ranking[0]?.fund;

  return (
    <div className="card">
      <div className="card-title">
        <span><span className="icon">🏆</span>Fund ranking — {windowMonths}-month trailing</span>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Fund</th>
              <th className="num">Trailing return</th>
              <th className="num">Sharpe-style</th>
              <th className="num">Max drawdown</th>
              <th className="num">Trend (50d)</th>
            </tr>
          </thead>
          <tbody>
            <tr className="current-row" style={{ background: 'var(--info-bg)' }}>
              <td>
                <span className="badge badge-state" style={{ background: 'var(--navy)', color: 'var(--white)' }}>YOUR BLEND</span>
                <span className="stat-note"> ({allocation.C}/{allocation.S}/{allocation.I}/{allocation.F}/{allocation.G} C/S/I/F/G)</span>
              </td>
              <td className={`num ${blended.trailingReturnPct >= 0 ? 'pos' : 'neg'}`}>{fmtPct(blended.trailingReturnPct)}</td>
              <td className="num">{fmtRatio(blended.sharpeStyleRatio)}</td>
              <td className="num neg">{blended.maxDrawdownPct == null ? '—' : `-${blended.maxDrawdownPct.toFixed(2)}%`}</td>
              <td className="num">
                {blended.trendPass == null ? '—' : blended.trendPass ? <span className="pass">Above ✓</span> : <span className="fail">Below ✗</span>}
              </td>
            </tr>
            {ranking.map((row) => (
              <tr key={row.fund} className={row.fund === leaderFund ? 'leader-row' : ''}>
                <td>
                  <span className={`badge badge-fund fund-${row.fund}`}>{row.fund}</span>
                  {row.fund === leaderFund && ' 🏆'}
                </td>
                <td className={`num ${row.trailingReturnPct >= 0 ? 'pos' : 'neg'}`}>{fmtPct(row.trailingReturnPct)}</td>
                <td className="num">{row.fund === 'G' ? '—' : fmtRatio(row.sharpeStyleRatio)}</td>
                <td className="num neg">{row.maxDrawdownPct == null ? '—' : `-${row.maxDrawdownPct.toFixed(2)}%`}</td>
                <td className="num">
                  {row.trendPass == null ? '—' : row.trendPass ? <span className="pass">Above ✓</span> : <span className="fail">Below ✗</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="chart-legend-note">
        Your blend is pinned above, not competing for the top spot — it's the "current position" row, not one of the five
        ranked funds. G Fund's Sharpe-style is shown as — (comparing G to itself isn't meaningful) but its return and
        drawdown are shown for direct comparison when evaluating a move toward safety. Sharpe-style =
        (return − G Fund return) ÷ stdev of daily returns over the window — a relative-strength-vs-risk score, not an
        annualized Sharpe ratio. A fund can lead on return while failing the trend filter; that combination is shown as-is,
        not hidden.
      </div>
    </div>
  );
}
