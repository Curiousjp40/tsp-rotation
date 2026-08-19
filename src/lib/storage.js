/**
 * Browser-only localStorage persistence. This is a static site with no
 * backend, so the allocation, transfer log, signal log, regime flag, and
 * thresholds all live client-side. The monthly transfer count is *derived*
 * from transferLog rather than tracked separately — the user logs each real
 * move they actually execute on tsp.gov, and that log is simultaneously the
 * transfer-count source and the audit trail.
 *
 * v2: keys for shapes that changed from v1 (single fund -> allocation
 * object) are versioned (":v2") rather than migrated in place — cheap for a
 * pre-launch local tool, and it means any old test entries under the old
 * key just stop being read instead of needing manual cleanup.
 */

import { CORE_FUNDS } from './metrics';

const KEYS = {
  allocation: 'tsp-rotation:allocation',
  transferLog: 'tsp-rotation:transferLog:v2',
  signalLog: 'tsp-rotation:signalLog:v2',
  regime: 'tsp-rotation:regime',
  settings: 'tsp-rotation:settings',
};

// Seed/test allocation from the spec's worked example.
const DEFAULT_ALLOCATION = { C: 50, S: 30, I: 20, F: 0, G: 0 };

const DEFAULT_SETTINGS = {
  windowMonths: 3,
  marginPct: 2,
  drawdownTriggerPct: 8,
  recentPeakLookbackDays: 60,
  maDays: 50,
  mode: 'tilt',
  tiltPct: 12,
};

const DEFAULT_REGIME = { value: false, source: 'manual', updatedAt: null };

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

function normalizeAllocation(allocation) {
  const out = {};
  for (const fund of CORE_FUNDS) out[fund] = Math.round((allocation?.[fund] ?? 0) * 10) / 10;
  return out;
}

function allocationsEqual(a, b) {
  return CORE_FUNDS.every((f) => (a?.[f] ?? 0) === (b?.[f] ?? 0));
}

export function getAllocation() {
  return normalizeAllocation(readJSON(KEYS.allocation, DEFAULT_ALLOCATION));
}

export function setAllocation(allocation) {
  const normalized = normalizeAllocation(allocation);
  writeJSON(KEYS.allocation, normalized);
  return normalized;
}

export function getTransferLog() {
  return readJSON(KEYS.transferLog, []);
}

/**
 * Log a real transfer (a new target allocation you actually set on tsp.gov).
 * Rejects, rather than silently accepting, two known v1 bugs:
 *   - a no-op: identical to your last LOGGED allocation (the seed default if
 *     you've never logged one) — i.e. "moving" to where you already are.
 *     Deliberately compared against the transfer-log history, not against
 *     whatever's currently live-edited in AllocationInput: editing commits
 *     to `allocation` immediately for what-if calculations, so by the time
 *     Log is clicked the draft and the live "current" value are always
 *     identical — comparing against that would make this guard never fire.
 *   - an exact duplicate: the same date + same allocation is already logged
 * Returns { ok: true, log } or { ok: false, reason, log: unchanged }.
 */
export function addTransferLogEntry({ date, allocation, note = '' }) {
  const normalized = normalizeAllocation(allocation);
  const log = getTransferLog();
  const sorted = [...log].sort((a, b) => (a.date < b.date ? 1 : -1));
  const lastLogged = sorted[0]?.allocation ?? DEFAULT_ALLOCATION;

  if (allocationsEqual(normalized, lastLogged)) {
    return { ok: false, reason: 'That matches your last logged allocation already — nothing to log.', log };
  }
  const duplicate = log.some((e) => e.date === date && allocationsEqual(e.allocation, normalized));
  if (duplicate) {
    return { ok: false, reason: 'An identical entry is already logged for this date.', log };
  }

  const entry = { id: `${date}-${Date.now()}`, date, allocation: normalized, note };
  const nextLog = [...log, entry];
  writeJSON(KEYS.transferLog, nextLog);
  setAllocation(normalized);
  return { ok: true, log: nextLog };
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

export function getRegime() {
  return readJSON(KEYS.regime, DEFAULT_REGIME);
}

export function setRegimeOff(value) {
  const next = { value, source: 'manual', updatedAt: new Date().toISOString() };
  writeJSON(KEYS.regime, next);
  return next;
}

export function getSettings() {
  return { ...DEFAULT_SETTINGS, ...readJSON(KEYS.settings, {}) };
}

export function setSettings(partial) {
  const merged = { ...getSettings(), ...partial };
  writeJSON(KEYS.settings, merged);
  return merged;
}

export { DEFAULT_SETTINGS, DEFAULT_ALLOCATION };
