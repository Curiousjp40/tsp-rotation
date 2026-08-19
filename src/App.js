import { useState, useEffect, useMemo, useCallback } from 'react';
import './styles.css';
import { evaluateRotationSignal } from './lib/signals';
import { findIndexOnOrBefore } from './lib/metrics';
import * as storage from './lib/storage';
import SettingsPanel from './components/SettingsPanel';
import TransferTracker from './components/TransferTracker';
import RegimeToggle from './components/RegimeToggle';
import SignalPanel from './components/SignalPanel';
import RotationChart from './components/RotationChart';
import RankingTable from './components/RankingTable';
import SignalLog from './components/SignalLog';

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const [settings, setSettingsState] = useState(storage.getSettings());
  const [currentHolding, setCurrentHoldingState] = useState(storage.getCurrentHolding());
  const [regimeOff, setRegimeOffState] = useState(storage.getRegimeOff());
  const [transferLog, setTransferLog] = useState(storage.getTransferLog());
  const [signalLog, setSignalLog] = useState(storage.getSignalLog());

  useEffect(() => {
    fetch(`${process.env.PUBLIC_URL}/data/tsp-prices.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
        return res.json();
      })
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  const handleSettingsChange = useCallback((partial) => {
    setSettingsState(storage.setSettings(partial));
  }, []);

  const handleHoldingChange = useCallback((fund) => {
    storage.setCurrentHolding(fund);
    setCurrentHoldingState(fund);
  }, []);

  const handleRegimeChange = useCallback((val) => {
    storage.setRegimeOff(val);
    setRegimeOffState(val);
  }, []);

  const handleLogTransfer = useCallback(({ date, toFund }) => {
    setTransferLog(storage.addTransferLogEntry({ date, toFund }));
    // A real transfer means the current holding actually changed on tsp.gov —
    // reflect that here so the dashboard's "current holding" stays honest.
    storage.setCurrentHolding(toFund);
    setCurrentHoldingState(toFund);
  }, []);

  const handleLogSignal = useCallback((signal) => {
    setSignalLog(storage.appendSignalLogEntry({
      date: signal.date,
      state: signal.state,
      reason: signal.reason,
      currentHolding: signal.currentHolding,
      target: signal.target,
      edgePct: signal.edgePct,
      windowMonths: signal.windowMonths,
    }));
  }, []);

  const handleMarkActed = useCallback((id, actedOn) => {
    setSignalLog(storage.markSignalActed(id, actedOn));
  }, []);

  const transfersUsedThisMonth = useMemo(() => {
    const ym = new Date().toISOString().slice(0, 7);
    return transferLog.filter((e) => e.date.slice(0, 7) === ym).length;
  }, [transferLog]);

  const asOfIndex = data ? data.prices.length - 1 : null;

  // Best-effort "when did we enter this position" for the standing defensive
  // rule — the most recent logged transfer INTO the current holding. If the
  // user never logged one (e.g. they just set their holding manually),
  // signals.js falls back to the plain recent-lookback cap.
  const holdingSinceIndex = useMemo(() => {
    if (!data) return null;
    const entries = transferLog
      .filter((e) => e.toFund === currentHolding)
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    if (entries.length === 0) return null;
    const idx = findIndexOnOrBefore(data.prices, entries[0].date);
    return idx < 0 ? null : idx;
  }, [data, transferLog, currentHolding]);

  const signal = useMemo(() => {
    if (!data || asOfIndex == null) return null;
    return evaluateRotationSignal(data.prices, asOfIndex, {
      windowMonths: settings.windowMonths,
      marginPct: settings.marginPct,
      currentHolding,
      transfersUsedThisMonth,
      regimeOff,
      recentPeakLookbackDays: settings.recentPeakLookbackDays,
      drawdownTriggerPct: settings.drawdownTriggerPct,
      maDays: settings.maDays,
      holdingSinceIndex,
    });
  }, [data, asOfIndex, settings, currentHolding, transfersUsedThisMonth, regimeOff, holdingSinceIndex]);

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <div className="logo"><span className="logo-icon">📊</span>TSP Rotation Dashboard</div>
          {data && <div className="data-asof">Data as of <strong>{data.asOf}</strong></div>}
        </div>
      </header>

      <main className="main">
        <h1 className="page-title">C / S / I / F / G rotation monitor</h1>
        <p className="page-sub">
          Read-only monitoring and decision support. Every real reallocation still happens manually on tsp.gov —
          this dashboard never executes a trade.
        </p>

        {error && (
          <div className="card">
            Couldn't load price data ({error}). Run <code>npm run fetch-prices</code> to generate{' '}
            <code>public/data/tsp-prices.json</code>, or check your connection.
          </div>
        )}
        {!data && !error && <div className="card">Loading price data…</div>}

        {data && signal && (
          <>
            <div className="grid-top">
              <SettingsPanel
                settings={settings}
                onSettingsChange={handleSettingsChange}
                currentHolding={currentHolding}
                onHoldingChange={handleHoldingChange}
              />
              <TransferTracker
                transferLog={transferLog}
                transfersUsed={transfersUsedThisMonth}
                transfersRemaining={signal.transfersRemaining}
                onLogTransfer={handleLogTransfer}
              />
              <RegimeToggle regimeOff={regimeOff} onChange={handleRegimeChange} />
            </div>

            <SignalPanel signal={signal} onLogSignal={handleLogSignal} />

            <RotationChart
              prices={data.prices}
              asOfIndex={asOfIndex}
              windowMonths={settings.windowMonths}
              currentHolding={currentHolding}
            />

            <RankingTable ranking={signal.ranking} currentHolding={currentHolding} windowMonths={settings.windowMonths} />

            <SignalLog signalLog={signalLog} onMarkActed={handleMarkActed} />
          </>
        )}
      </main>

      <footer className="footer">
        Decision-support and record-keeping only — not a guarantee of performance, not investment advice, and it does not place
        trades. See <a href="https://www.tsp.gov" target="_blank" rel="noreferrer">tsp.gov</a> to actually reallocate.
        Run the backtest (<code>npm run backtest</code>) across multiple market regimes, and paper-trade signals for 30+ days,
        before treating any live signal here as real.
      </footer>
    </div>
  );
}
