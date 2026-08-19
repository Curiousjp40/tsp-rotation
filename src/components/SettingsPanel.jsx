const FUNDS = ['C', 'S', 'I', 'F', 'G'];
const WINDOWS = [1, 3, 6];

export default function SettingsPanel({ settings, onSettingsChange, currentHolding, onHoldingChange }) {
  return (
    <div className="card">
      <div className="card-title">
        <span><span className="icon">⚙️</span>Rules &amp; holding</span>
      </div>
      <div className="field-row">
        <div className="field">
          <label>Current holding</label>
          <select value={currentHolding} onChange={(e) => onHoldingChange(e.target.value)}>
            {FUNDS.map((f) => <option key={f} value={f}>{f} Fund</option>)}
          </select>
        </div>

        <div className="field">
          <label>Lookback window</label>
          <div className="window-toggle">
            {WINDOWS.map((w) => (
              <button
                key={w}
                type="button"
                className={settings.windowMonths === w ? 'active' : ''}
                onClick={() => onSettingsChange({ windowMonths: w })}
              >
                {w}M
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label htmlFor="margin-input">Margin threshold (pp)</label>
          <input
            id="margin-input"
            type="number" min="0" max="20" step="0.5"
            value={settings.marginPct}
            onChange={(e) => onSettingsChange({ marginPct: Number(e.target.value) })}
          />
        </div>

        <div className="field">
          <label htmlFor="drawdown-input">Drawdown trigger (%)</label>
          <input
            id="drawdown-input"
            type="number" min="1" max="30" step="0.5"
            value={settings.drawdownTriggerPct}
            onChange={(e) => onSettingsChange({ drawdownTriggerPct: Number(e.target.value) })}
          />
        </div>
      </div>
      <div className="chart-legend-note">
        A "consider switching" signal only fires when the ranked leader beats your current holding by more than the margin threshold — a bare
        edge-out doesn't count. The drawdown trigger is the standing defensive rule: if your current holding falls that far from its peak
        since you entered it, a G Fund safe-harbor signal fires immediately, any day, uncapped.
      </div>
    </div>
  );
}
