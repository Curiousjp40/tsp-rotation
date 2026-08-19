function relativeTime(iso) {
  if (!iso) return 'never set';
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export default function RegimeToggle({ regime, onChange }) {
  return (
    <div className="card">
      <div className="card-title">
        <span><span className="icon">🚦</span>Market regime</span>
      </div>
      <label className="toggle-switch">
        <input type="checkbox" checked={regime.value} onChange={(e) => onChange(e.target.checked)} />
        <span className="toggle-track" />
        <span>{regime.value ? 'Risk-off' : 'Risk-on'}</span>
      </label>
      <div className="stat-note" style={{ marginTop: '.5rem' }}>
        Source: <strong>{regime.source === 'manual' ? 'Manual' : 'Model-driven'}</strong> · updated {relativeTime(regime.updatedAt)}
      </div>
      <div className="stat-note" style={{ marginTop: '.3rem' }}>
        {regime.value
          ? 'Rotation signals into stock funds are de-emphasized — "leading" during a broad selloff often just means it fell the least. The standing defensive rule still fires normally.'
          : 'Manual switch for now (no HMM regime model wired up yet). Flip this to Risk-off during a broad selloff to de-emphasize stock-fund rotation signals.'}
      </div>
    </div>
  );
}
