import { useState, useEffect, useMemo, useCallback } from 'react';
import './styles.css';
import { evaluateRebalanceSignal } from './lib/signals';
import {
  findIndexOnOrBefore, blendedReturnPct, blendedSharpeStyleRatio,
  blendedMaxDrawdownForWindow, blendedTrendFilterPass,
} from './lib/metrics';
import * as storage from './lib/storage';
import AllocationInput from './components/AllocationInput';
import SettingsPanel from './components/SettingsPanel';
import TransferTracker from './components/TransferTracker';
import RegimeToggle from './components/RegimeToggle';
import SignalPanel from './components/SignalPanel';
import RotationChart from './components/RotationChart';
import RankingTable from './components/RankingTable';
import SignalLog from './components/SignalLog';
import BacktestSummary from './components/BacktestSummary';

export default function App() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const [settings, setSettingsState] = useState(storage.getSettings());
  const [allocation, setAllocationState] = useState(storage.getAllocation());
  const [regime, setRegimeState] = useState(storage.getRegime());
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

  const handleAllocationChange = useCallback((next) => {
    setAllocationState(storage.setAllocation(next));
  }, []);

  const handleRegimeChange = useCallback((val) => {
    setRegimeState(storage.setRegimeOff(val));
  }, []);

  const handleLogTransfer = useCallback(({ date, allocation: alloc }) => {
    const result = storage.addTransferLogEntry({ date, allocation: alloc });
    if (result.ok) {
      setTransferLog(result.log);
      setAllocationState(storage.getAllocation());
    }
    return result;
  }, []);

  const handleLogSignal = useCallback((signal) => {
    setSignalLog(storage.appendSignalLogEntry({
      date: signal.date,
      state: signal.state,
      reason: signal.reason,
      leaderFund: signal.leader?.fund,
      blendedReturn: signal.blendedReturn,
      edgePct: signal.edgePct,
      windowMonths: signal.windowMonths,
      laggard: signal.laggard,
      tiltAmount: signal.tiltAmount,
      mode: signal.mode,
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

  // Best-effort "when was this allocation last set" for the standing
  // defensive rule — the most recent logged transfer. If none exists yet,
  // signals.js falls back to the plain recent-lookback cap.
  const allocationSinceIndex = useMemo(() => {
    if (!data || transferLog.length === 0) return null;
    const latest = [...transferLog].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    const idx = findIndexOnOrBefore(data.prices, latest.date);
    return idx < 0 ? null : idx;
  }, [data, transferLog]);

  const signal = useMemo(() => {
    if (!data || asOfIndex == null) return null;
    return evaluateRebalanceSignal(data.prices, asOfIndex, {
      windowMonths: settings.windowMonths,
      marginPct: settings.marginPct,
      allocation,
      transfersUsedThisMonth,
      regimeOff: regime.value,
      recentPeakLookbackDays: settings.recentPeakLookbackDays,
      drawdownTriggerPct: settings.drawdownTriggerPct,
      maDays: settings.maDays,
      allocationSinceIndex,
      mode: settings.mode,
      tiltPct: settings.tiltPct,
    });
  }, [data, asOfIndex, settings, allocation, transfersUsedThisMonth, regime, allocationSinceIndex]);

  const blended = useMemo(() => {
    if (!data || asOfIndex == null) return null;
    return {
      trailingReturnPct: blendedReturnPct(data.prices, allocation, asOfIndex, settings.windowMonths),
      sharpeStyleRatio: blendedSharpeStyleRatio(data.prices, allocation, asOfIndex, settings.windowMonths),
      maxDrawdownPct: blendedMaxDrawdownForWindow(data.prices, allocation, asOfIndex, settings.windowMonths),
      trendPass: blendedTrendFilterPass(data.prices, allocation, asOfIndex, settings.maDays),
    };
  }, [data, asOfIndex, allocation, settings.windowMonths, settings.maDays]);

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <div className="logo"><span className="logo-icon">📊</span>TSP Rotation Dashboard</div>
          {data && <div className="data-asof">Data as of <strong>{data.asOf}</strong></div>}
        </div>
      </header>

      <main className="main">
        <h1 className="page-title">C / S / I / F / G rebalancing monitor</h1>
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

        {data && signal && blended && (
          <>
            <AllocationInput
              allocation={allocation}
              onAllocationChange={handleAllocationChange}
              onLogTransfer={handleLogTransfer}
            />

            <div className="grid-top">
              <SettingsPanel settings={settings} onSettingsChange={handleSettingsChange} />
              <TransferTracker transferLog={transferLog} transfersUsed={transfersUsedThisMonth} />
              <RegimeToggle regime={regime} onChange={handleRegimeChange} />
            </div>

            <SignalPanel signal={signal} onLogSignal={handleLogSignal} />

            <RotationChart
              prices={data.prices}
              asOfIndex={asOfIndex}
              windowMonths={settings.windowMonths}
              allocation={allocation}
            />

            <RankingTable ranking={signal.ranking} blended={blended} allocation={allocation} windowMonths={settings.windowMonths} />

            <BacktestSummary />

            <SignalLog signalLog={signalLog} onMarkActed={handleMarkActed} />
          </>
        )}
      </main>

      <footer className="footer">
        Decision-support and record-keeping only — not a guarantee of performance, not investment advice, and it does not place
        trades. See <a href="https://www.tsp.gov" target="_blank" rel="noreferrer">tsp.gov</a> to actually reallocate.
        Run the backtest (<code>npm run backtest -- --save</code>) across multiple market regimes, and paper-trade signals
        for 30+ days, before treating any live signal here as real.
      </footer>
    </div>
  );
}
