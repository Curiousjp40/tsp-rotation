function fmtPct(v) {
  return v == null ? 'n/a' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
}

export default function SweepSummary({ sweep, status }) {
  return (
    <div className="card">
      <div className="card-title">
        <span><span className="icon">🔬</span>Parameter sweep — is there a validated edge?</span>
      </div>

      {status === 'loading' && <div className="stat-note">Loading…</div>}

      {status === 'missing' && (
        <div className="signal-alert">
          Sweep hasn't been run yet — no parameter combination has been validated. Treat every live signal as
          unvalidated until it has. Run: <code>npm run sweep -- --save</code>
        </div>
      )}

      {status !== 'loading' && status !== 'missing' && sweep && (
        <>
          <div className="stat-note" style={{ marginBottom: '.7rem' }}>
            Generated {new Date(sweep.generatedAt).toLocaleString()} · {sweep.combosRun} combinations swept over
            {' '}{sweep.fullRange?.start} – {sweep.fullRange?.end}, ranked by win rate vs. static C Fund, then the
            best combination re-checked on two non-overlapping halves it wasn't specifically picked from.
          </div>

          <div className={`signal-alert`} style={sweep.passesValidation
            ? { background: 'var(--success-bg)', color: 'var(--success)' }
            : {}}>
            {sweep.passesValidation
              ? `PASS — window=${sweep.best.window}mo / margin=${sweep.best.margin}pp / drawdown=${sweep.best.drawdown}% / tilt=${sweep.best.tilt}pp beat static C Fund in the full period and both out-of-sample halves. This is the dashboard's validated rule set.`
              : `FAIL — no combination in the swept grid beat static C Fund in the full period AND both out-of-sample halves. This family of rules (trailing-return relative strength + a drawdown safety valve) does not show a validated edge over simply holding C Fund across this history. Read every live signal below as informational, not a backed recommendation — the honest answer on most days may just be "stay put."`}
          </div>

          <div className="table-wrap" style={{ marginTop: '.8rem' }}>
            <table className="data-table">
              <thead>
                <tr><th>Combination</th><th className="num">Total return</th><th className="num">Win rate</th><th>Beats static C?</th></tr>
              </thead>
              <tbody>
                <tr className="leader-row">
                  <td>Full period — best by win rate ({sweep.best.window}mo/{sweep.best.margin}pp/{sweep.best.drawdown}%/{sweep.best.tilt}pp)</td>
                  <td className="num">{fmtPct(sweep.best.totalReturnPct)}</td>
                  <td className="num">{sweep.best.winRatePct == null ? 'n/a' : `${sweep.best.winRatePct.toFixed(1)}%`}</td>
                  <td>{sweep.best.beatsStaticC ? '✅ yes' : '❌ no'}</td>
                </tr>
                {sweep.outOfSample?.map((s) => (
                  <tr key={s.label}>
                    <td>{s.label} (same combination)</td>
                    <td className="num">{fmtPct(s.totalReturnPct)}</td>
                    <td className="num">{s.winRatePct == null ? 'n/a' : `${s.winRatePct.toFixed(1)}%`}</td>
                    <td>{s.beatsStaticC ? '✅ yes' : '❌ no'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="chart-legend-note" style={{ marginTop: '.6rem' }}>
            "Out of sample" here means the winning combination — chosen by scoring the full 2003-2026 range — is
            re-checked on each non-overlapping half separately. That's a consistency check across sub-periods, not a
            blind holdout in the strict sense (the full range that picked the winner contains both halves) — noted
            plainly rather than overclaiming what got validated.
          </div>
        </>
      )}
    </div>
  );
}
