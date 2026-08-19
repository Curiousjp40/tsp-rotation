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
function fmtPct(v) {
  return v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
}

function reweightDescription(s) {
  if (!s.proposedAllocation) return '';
  if (s.mode === 'full' || !s.laggard) return `move fully to ${s.leader.fund} Fund`;
  return `shift ${s.tiltAmount.toFixed(1)}pp from ${s.laggard} → ${s.leader.fund}`;
}

const STATE_COPY = {
  'actionable': (s) => `Consider a rebalance: ${reweightDescription(s)}. ${s.leader.fund} is leading the ${s.windowMonths}-month window by ${fmtPp(s.edgePct)} over your blend, past your ${s.marginPct}pp margin, and an unrestricted transfer is available this month.`,
  'actionable-safe-harbor-defensive': (s) => `Standing defensive signal: your blend has drawn down ${s.standingDefensive.drawdownPct.toFixed(2)}% from its peak since this allocation was set (trigger: ${s.drawdownTriggerPct}%). Safe-harbor move: ${reweightDescription(s)} — uncapped, doesn't use one of your two unrestricted transfers.`,
  'actionable-safe-harbor-margin': (s) => `G Fund is leading by ${fmtPp(s.edgePct)}. ${reweightDescription(s)} only increases G's weight, so it's uncapped regardless of transfers remaining this month.`,
  'capped': (s) => `${s.leader.fund} is leading by ${fmtPp(s.edgePct)} — the move would be to ${reweightDescription(s)}, but you've used both unrestricted transfers this month. Not actionable until next month — shown for visibility only, this would act but is currently capped.`,
  'suppressed-by-regime': (s) => `${s.leader.fund} is leading by ${fmtPp(s.edgePct)}, but the regime flag is set to Risk-off, so this rebalance signal into a stock fund is de-emphasized rather than pushed as actionable.`,
  'pending-evaluation': (s) => `${s.leader.fund} is leading by ${fmtPp(s.edgePct)} — past the margin, but today isn't a scheduled evaluation day.`,
  'no-signal': (s) => `No signal. Your blend is either leading the ${s.windowMonths}-month window or within ${s.marginPct}pp of the leader (${s.leader?.fund ?? '—'}).`,
};

export default function SignalPanel({ signal, onLogSignal }) {
  const key = signal.state === 'actionable-safe-harbor'
    ? (signal.reason === 'standing-defensive' ? 'actionable-safe-harbor-defensive' : 'actionable-safe-harbor-margin')
    : signal.state;

  const headline = {
    'actionable': '🟢 Actionable signal',
    'actionable-safe-harbor-defensive': '🔴 Standing defensive signal (safe harbor)',
    'actionable-safe-harbor-margin': '🟢 Actionable — G Fund safe harbor',
    'capped': '🟡 Would act, but capped this month',
    'suppressed-by-regime': '⚪ Signal de-emphasized (risk-off regime)',
    'pending-evaluation': '⚪ Margin met — awaiting evaluation day',
    'no-signal': '⚪ No signal',
  }[key];

  const panelClass = signal.reason === 'standing-defensive' ? 'signal-standing-defensive' : `signal-${signal.state}`;
  const showHindsight = signal.hindsightReturnPct != null;

  return (
    <div className={`card signal-panel ${panelClass}`}>
      <div className="card-title">
        <span><span className="icon">📡</span>Current signal</span>
        <span className={`badge badge-state state-${signal.state}`}>{signal.state.replace(/-/g, ' ')}</span>
      </div>
      <div className="signal-headline">{headline}</div>
      <div className="signal-detail">{STATE_COPY[key](signal)}</div>

      {showHindsight && (
        <div className="chart-legend-note" style={{ marginTop: '.7rem', padding: '.6rem .8rem', background: 'var(--light)', borderRadius: 8 }}>
          <strong>Hindsight, not a forecast:</strong> if your account had been 100% in {signal.leader.fund} Fund for this
          window, blended return would have been {fmtPct(signal.hindsightReturnPct)} vs. your actual {fmtPct(signal.blendedReturn)}.
        </div>
      )}

      {(signal.state === 'actionable' || signal.state === 'actionable-safe-harbor') && (
        <button type="button" className="btn btn-sm" style={{ marginTop: '.8rem' }} onClick={() => onLogSignal(signal)}>
          Log this signal to history
        </button>
      )}

      <div className="chart-legend-note" style={{ marginTop: '.8rem' }}>
        Evaluates twice monthly: the 1st trading day of the month, and the first trading day on/after the 15th — matching
        the 2-unrestricted-transfer cap this is built around. Next evaluation: {nextEvaluationDateLabel(signal.date)}.
      </div>
    </div>
  );
}
