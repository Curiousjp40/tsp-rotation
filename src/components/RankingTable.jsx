function fmtPct(v, digits = 2) {
  return v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%`;
}
function fmtRatio(v) {
  return v == null ? '—' : v.toFixed(2);
}

export default function RankingTable({ ranking, currentHolding, windowMonths }) {
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
            {ranking.map((row) => (
              <tr
                key={row.fund}
                className={[
                  row.fund === leaderFund ? 'leader-row' : '',
                  row.fund === currentHolding ? 'current-row' : '',
                ].join(' ').trim()}
              >
                <td>
                  <span className={`badge badge-fund fund-${row.fund}`}>{row.fund}</span>
                  {row.fund === leaderFund && ' 🏆'}
                  {row.fund === currentHolding && <span className="stat-note"> (current)</span>}
                </td>
                <td className={`num ${row.trailingReturnPct >= 0 ? 'pos' : 'neg'}`}>{fmtPct(row.trailingReturnPct)}</td>
                <td className="num">{fmtRatio(row.sharpeStyleRatio)}</td>
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
        Sharpe-style = (fund return − G Fund return) ÷ stdev of the fund's daily returns over the window — a relative-strength-vs-risk
        score, not an annualized Sharpe ratio. A fund can lead on return while failing the trend filter; that combination is shown as-is, not hidden.
      </div>
    </div>
  );
}
