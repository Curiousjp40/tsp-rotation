export default function RegimeToggle({ regimeOff, onChange }) {
  return (
    <div className="card">
      <div className="card-title">
        <span><span className="icon">🚦</span>Market regime</span>
      </div>
      <label className="toggle-switch">
        <input type="checkbox" checked={regimeOff} onChange={(e) => onChange(e.target.checked)} />
        <span className="toggle-track" />
        <span>{regimeOff ? 'Risk-off' : 'Risk-on'}</span>
      </label>
      <div className="stat-note" style={{ marginTop: '.6rem' }}>
        {regimeOff
          ? 'Rotation signals into stock funds are de-emphasized — "leading" during a broad selloff often just means it fell the least. The standing defensive rule still fires normally.'
          : 'Manual switch for now (no HMM regime model wired up yet). Flip this to Risk-off during a broad selloff to de-emphasize stock-fund rotation signals.'}
      </div>
    </div>
  );
}
