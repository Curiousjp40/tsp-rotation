function fmtPp(v) {
  return v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}pp`;
}

export default function SignalLog({ signalLog, onMarkActed }) {
  const actedCount = signalLog.filter((e) => e.actedOn).length;

  return (
    <div className="card">
      <div className="card-title">
        <span><span className="icon">📜</span>Signal log</span>
        <span className="stat-note">{signalLog.length} logged · {actedCount} acted on</span>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>State</th>
              <th>Current → Target</th>
              <th className="num">Edge</th>
              <th>Acted on?</th>
            </tr>
          </thead>
          <tbody>
            {signalLog.length === 0 && (
              <tr className="empty-row"><td colSpan={5}>No signals logged yet — use "Log this signal to history" on an actionable signal above.</td></tr>
            )}
            {signalLog.map((e) => (
              <tr key={e.id}>
                <td>{e.date}</td>
                <td><span className={`badge badge-state state-${e.state}`}>{e.state.replace(/-/g, ' ')}</span></td>
                <td>
                  <span className={`badge badge-fund fund-${e.currentHolding}`}>{e.currentHolding}</span>
                  {' → '}
                  <span className={`badge badge-fund fund-${e.target}`}>{e.target}</span>
                </td>
                <td className="num">{fmtPp(e.edgePct)}</td>
                <td>
                  <label className="toggle-switch">
                    <input type="checkbox" checked={!!e.actedOn} onChange={(ev) => onMarkActed(e.id, ev.target.checked)} />
                    <span className="toggle-track" />
                  </label>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="chart-legend-note">
        This is a track record, not an execution log — it becomes the input for validating the backtest against what actually would have
        happened. Nothing here executes a trade; do that manually on tsp.gov, then log the real transfer in the tracker above.
      </div>
    </div>
  );
}
