import { useState, useEffect } from 'react';

const FUNDS = ['C', 'S', 'I', 'F', 'G'];

export default function AllocationInput({ allocation, onAllocationChange, onLogTransfer }) {
  // Local draft so typing doesn't fight with the committed allocation on every keystroke.
  const [draft, setDraft] = useState(allocation);
  const [logResult, setLogResult] = useState(null);

  useEffect(() => setDraft(allocation), [allocation]);

  const total = FUNDS.reduce((sum, f) => sum + (Number(draft[f]) || 0), 0);
  const totalOk = Math.abs(total - 100) < 0.05;

  function handleFieldChange(fund, value) {
    const next = { ...draft, [fund]: value === '' ? '' : Number(value) };
    setDraft(next);
    setLogResult(null);
    if (Math.abs(FUNDS.reduce((sum, f) => sum + (Number(next[f]) || 0), 0) - 100) < 0.05) {
      onAllocationChange(next);
    }
  }

  function handleLog() {
    if (!totalOk) return;
    const today = new Date().toISOString().slice(0, 10);
    const result = onLogTransfer({ date: today, allocation: draft });
    setLogResult(result);
  }

  return (
    <div className="card">
      <div className="card-title">
        <span><span className="icon">📋</span>Your allocation</span>
        <span className={`stat-note ${totalOk ? '' : 'fail'}`}>{total.toFixed(1)}% of 100%</span>
      </div>
      <div className="field-row">
        {FUNDS.map((fund) => (
          <div className="field" key={fund}>
            <label htmlFor={`alloc-${fund}`}>{fund} Fund %</label>
            <input
              id={`alloc-${fund}`}
              type="number" min="0" max="100" step="0.5"
              value={draft[fund]}
              onChange={(e) => handleFieldChange(fund, e.target.value)}
              style={{ width: '80px', borderLeft: `3px solid var(--fund-${fund.toLowerCase()})` }}
            />
          </div>
        ))}
        <button type="button" className="btn btn-primary" onClick={handleLog} disabled={!totalOk}>
          Log as real transfer on tsp.gov
        </button>
      </div>
      {!totalOk && <div className="signal-alert" style={{ marginTop: '.7rem' }}>Percentages must sum to 100 (currently {total.toFixed(1)}).</div>}
      {logResult && !logResult.ok && <div className="signal-alert" style={{ marginTop: '.7rem' }}>{logResult.reason}</div>}
      {logResult?.ok && <div className="chart-legend-note" style={{ marginTop: '.7rem' }}>Logged. Transfer count and history updated below.</div>}
      <div className="chart-legend-note">
        Edit freely to explore "what if" — it updates every calculation live. Only click "Log as real transfer" after you've
        actually made the move on tsp.gov, so the monthly transfer count stays accurate. This is a snapshot as of your last
        update, not auto-adjusted day to day as fund prices move.
      </div>
    </div>
  );
}
