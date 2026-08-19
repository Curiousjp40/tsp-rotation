import { useState } from 'react';

const FUNDS = ['C', 'S', 'I', 'F', 'G'];

export default function TransferTracker({ transferLog, transfersUsed, transfersRemaining, onLogTransfer }) {
  const [toFund, setToFund] = useState('G');
  const today = new Date().toISOString().slice(0, 10);
  const thisMonthLabel = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });

  const recent = [...transferLog]
    .filter((e) => e.date.slice(0, 7) === today.slice(0, 7))
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <div className="card">
      <div className="card-title">
        <span><span className="icon">🔁</span>Transfers this month</span>
      </div>
      <div className="stat-tile">
        <div className="stat-value">{transfersUsed} / 2 used</div>
        <div className="stat-note">
          {transfersRemaining > 0
            ? `${transfersRemaining} unrestricted reallocation${transfersRemaining === 1 ? '' : 's'} left in ${thisMonthLabel}.`
            : `No unrestricted reallocations left in ${thisMonthLabel} — only moves INTO the G Fund are still allowed (safe-harbor exception).`}
        </div>
      </div>

      <div className="field-row" style={{ marginTop: '1rem' }}>
        <div className="field">
          <label htmlFor="log-transfer-fund">I actually moved to</label>
          <select id="log-transfer-fund" value={toFund} onChange={(e) => setToFund(e.target.value)}>
            {FUNDS.map((f) => <option key={f} value={f}>{f} Fund</option>)}
          </select>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => onLogTransfer({ date: today, toFund })}
        >
          Log real transfer on tsp.gov
        </button>
      </div>
      <div className="stat-note" style={{ marginTop: '.4rem' }}>
        This dashboard can't execute trades — log it here only after you've made the move yourself on tsp.gov, so the count above stays accurate.
      </div>

      {recent.length > 0 && (
        <div className="table-wrap" style={{ marginTop: '.9rem' }}>
          <table className="data-table">
            <thead><tr><th>Date</th><th>To</th></tr></thead>
            <tbody>
              {recent.map((e) => (
                <tr key={e.id}>
                  <td>{e.date}</td>
                  <td><span className={`badge badge-fund fund-${e.toFund}`}>{e.toFund}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
