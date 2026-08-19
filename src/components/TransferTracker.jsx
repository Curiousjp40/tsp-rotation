export default function TransferTracker({ transferLog, transfersUsed }) {
  const unrestrictedUsed = Math.min(transfersUsed, 2);
  const safeHarborExtra = Math.max(0, transfersUsed - 2);
  const thisMonthLabel = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const today = new Date().toISOString().slice(0, 10);

  const recent = [...transferLog]
    .filter((e) => e.date.slice(0, 7) === today.slice(0, 7))
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <div className="card">
      <div className="card-title">
        <span><span className="icon">🔁</span>Transfers this month</span>
      </div>
      <div className="stat-tile">
        <div className="stat-value">{unrestrictedUsed}/2 unrestricted used{safeHarborExtra > 0 ? `, ${safeHarborExtra} additional safe-harbor move${safeHarborExtra === 1 ? '' : 's'}` : ''}</div>
        <div className="stat-note">
          {unrestrictedUsed < 2
            ? `${2 - unrestrictedUsed} unrestricted reallocation${2 - unrestrictedUsed === 1 ? '' : 's'} left in ${thisMonthLabel}.`
            : `No unrestricted reallocations left in ${thisMonthLabel} — only moves that increase G Fund weight are still allowed (safe-harbor exception).`}
        </div>
      </div>
      <div className="chart-legend-note" style={{ marginTop: '.6rem' }}>
        Log a real transfer from the "Your allocation" card above, right after you've made the move on tsp.gov.
      </div>

      {recent.length > 0 && (
        <div className="table-wrap" style={{ marginTop: '.9rem' }}>
          <table className="data-table">
            <thead><tr><th>Date</th><th>Allocation (C/S/I/F/G)</th></tr></thead>
            <tbody>
              {recent.map((e) => (
                <tr key={e.id}>
                  <td>{e.date}</td>
                  <td>{e.allocation.C}/{e.allocation.S}/{e.allocation.I}/{e.allocation.F}/{e.allocation.G}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
