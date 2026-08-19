const WINDOWS = [1, 3, 6];

export default function SettingsPanel({ settings, onSettingsChange }) {
  return (
    <div className="card">
      <div className="card-title">
        <span><span className="icon">⚙️</span>Rules &amp; strategy</span>
      </div>
      <div className="field-row">
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
          <label>Strategy</label>
          <div className="window-toggle">
            {['tilt', 'full'].map((m) => (
              <button
                key={m}
                type="button"
                className={settings.mode === m ? 'active' : ''}
                onClick={() => onSettingsChange({ mode: m })}
              >
                {m === 'tilt' ? 'Tilt' : 'Full rotation'}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label htmlFor="tilt-input">Tilt size (pp)</label>
          <input
            id="tilt-input"
            type="number" min="1" max="100" step="1"
            value={settings.tiltPct}
            disabled={settings.mode === 'full'}
            onChange={(e) => onSettingsChange({ tiltPct: Number(e.target.value) })}
          />
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
        A signal only fires when the ranked leader beats your blend by more than the margin threshold — a bare edge-out
        doesn't count. Tilt mode shifts a slice of weight from your biggest laggard toward the leader (default); full
        rotation proposes moving everything to the leader instead. The drawdown trigger is the standing defensive rule:
        if your blend falls that far from its peak since you last set it, a G Fund safe-harbor signal fires immediately,
        any day, uncapped.
      </div>
    </div>
  );
}
