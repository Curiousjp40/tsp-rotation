/**
 * Browser-only localStorage persistence. This is a static site with no
 * backend, so current holding, the transfer log, signal log, regime flag,
 * and thresholds all live client-side. The monthly transfer count is
 * *derived* from transferLog rather than tracked separately — the user
 * logs each real move they actually execute on tsp.gov, and that log is
 * simultaneously the transfer-count source and the audit trail.
 */

const KEYS = {
  currentHolding: 'tsp-rotation:currentHolding',
  transferLog: 'tsp-rotation:transferLog',
  signalLog: 'tsp-rotation:signalLog',
  regimeOff: 'tsp-rotation:regimeOff',
  settings: 'tsp-rotation:settings',
};

const DEFAULT_SETTINGS = {
  windowMonths: 3,
  marginPct: 2,
  drawdownTriggerPct: 8,
  recentPeakLookbackDays: 60,
  maDays: 50,
};

function readJSON(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage unavailable (private browsing, quota, etc.) — fail silently,
    // the dashboard still works, it just won't persist across reloads.
  }
}

export function getCurrentHolding() {
  return readJSON(KEYS.currentHolding, 'G');
}

export function setCurrentHolding(fund) {
  writeJSON(KEYS.currentHolding, fund);
}

export function getTransferLog() {
  return readJSON(KEYS.transferLog, []);
}

export function addTransferLogEntry({ date, toFund, note = '' }) {
  const log = getTransferLog();
  log.push({ id: `${date}-${toFund}-${Date.now()}`, date, toFund, note });
  writeJSON(KEYS.transferLog, log);
  return log;
}

export function removeTransferLogEntry(id) {
  const log = getTransferLog().filter((e) => e.id !== id);
  writeJSON(KEYS.transferLog, log);
  return log;
}

/** Unrestricted transfers used in the calendar month containing `referenceDate` (Date). */
export function getTransfersUsedThisMonth(referenceDate = new Date()) {
  const ym = referenceDate.toISOString().slice(0, 7);
  return getTransferLog().filter((e) => e.date.slice(0, 7) === ym).length;
}

export function getSignalLog() {
  return readJSON(KEYS.signalLog, []);
}

export function appendSignalLogEntry(entry) {
  const log = getSignalLog();
  log.unshift({ id: `${entry.date}-${Date.now()}`, actedOn: false, ...entry });
  writeJSON(KEYS.signalLog, log);
  return log;
}

export function markSignalActed(id, actedOn) {
  const log = getSignalLog().map((e) => (e.id === id ? { ...e, actedOn } : e));
  writeJSON(KEYS.signalLog, log);
  return log;
}

export function getRegimeOff() {
  return readJSON(KEYS.regimeOff, false);
}

export function setRegimeOff(value) {
  writeJSON(KEYS.regimeOff, value);
}

export function getSettings() {
  return { ...DEFAULT_SETTINGS, ...readJSON(KEYS.settings, {}) };
}

export function setSettings(partial) {
  const merged = { ...getSettings(), ...partial };
  writeJSON(KEYS.settings, merged);
  return merged;
}

export { DEFAULT_SETTINGS };
