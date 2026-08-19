function nextEvaluationDateLabel(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDate();
  const next = day < 15
    ? new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 15))
    : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  return next.toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: 'UTC' });
}

function fmtPp(v) {
  return v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}pp`;
}

const STATE_COPY = {
  'actionable': (s) => `Consider switching ${s.currentHolding} → ${s.target}. ${s.target} is leading the ${s.windowMonths}-month window by ${fmtPp(s.edgePct)}, past your ${s.marginPct}pp margin, and an unrestricted transfer is available this month.`,
  'actionable-safe-harbor-defensive': (s) => `Standing defensive signal: ${s.currentHolding} has drawn down ${s.standingDefensive.drawdownPct.toFixed(2)}% from its peak since you entered it (trigger: ${s.drawdownTriggerPct ?? ''}%). Safe-harbor move to G Fund — this is uncapped and doesn't use one of your two unrestricted transfers.`,
  'actionable-safe-harbor-margin': (s) => `G Fund is leading by ${fmtPp(s.edgePct)} and you're out of unrestricted transfers this month — but moves into G are never capped, so this is still actionable.`,
  'capped': (s) => `${s.target} is leading by ${fmtPp(s.edgePct)}, but you've used both unrestricted transfers this month. Not actionable until next month — shown for visibility only, this would switch but is currently capped.`,
  'suppressed-by-regime': (s) => `${s.target} is leading by ${fmtPp(s.edgePct)}, but the regime flag is set to Risk-off, so this rotation signal into a stock fund is de-emphasized rather than pushed as actionable.`,
  'pending-evaluation': (s) => `${s.target} is leading by ${fmtPp(s.edgePct)} — past the margin, but today isn't a scheduled evaluation day. Next evaluation: ${nextEvaluationDateLabel(s.date)}.`,
  'no-signal': (s) => `No signal. Your current holding (${s.currentHolding}) is either leading the ${s.windowMonths}-month window or within the ${s.marginPct}pp margin of the leader (${s.leader?.fund ?? '—'}).`,
};

export default function SignalPanel({ signal, onLogSignal }) {
  const key = signal.state === 'actionable-safe-harbor'
    ? (signal.reason === 'standing-defensive' ? 'actionable-safe-harbor-defensive' : 'actionable-safe-harbor-margin')
    : signal.state;

  const headline = {
    'actionable': '🟢 Actionable signal',
    'actionable-safe-harbor-defensive': '🔴 Standing defensive signal (safe harbor)',
    'actionable-safe-harbor-margin': '🟢 Actionable — G Fund safe harbor',
    'capped': '🟡 Would switch, but capped this month',
    'suppressed-by-regime': '⚪ Signal de-emphasized (risk-off regime)',
    'pending-evaluation': '⚪ Margin met — awaiting evaluation day',
    'no-signal': '⚪ No signal',
  }[key];

  const panelClass = signal.reason === 'standing-defensive' ? 'signal-standing-defensive' : `signal-${signal.state}`;

  return (
    <div className={`card signal-panel ${panelClass}`}>
      <div className="card-title">
        <span><span className="icon">📡</span>Current signal</span>
        <span className={`badge badge-state state-${signal.state}`}>{signal.state.replace(/-/g, ' ')}</span>
      </div>
      <div className="signal-headline">{headline}</div>
      <div className="signal-detail">{STATE_COPY[key](signal)}</div>

      {(signal.state === 'actionable' || signal.state === 'actionable-safe-harbor') && (
        <button type="button" className="btn btn-sm" style={{ marginTop: '.8rem' }} onClick={() => onLogSignal(signal)}>
          Log this signal to history
        </button>
      )}
    </div>
  );
}
