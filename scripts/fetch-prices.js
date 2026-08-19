#!/usr/bin/env node
/**
 * Pulls the official TSP share-price history CSV and writes a normalized
 * data/tsp-prices.json for the dashboard and backtest to read.
 *
 * Source: https://www.tsp.gov/data/fund-price-history.csv
 * This is TSP's own published data (G/F/C/S/I plus the L funds), not a
 * third-party proxy. It's fetched here in Node (server-side / CI runner)
 * specifically to sidestep browser CORS — the static site never calls this
 * URL directly at runtime, it just reads the committed JSON this produces.
 *
 * The endpoint 403s without a normal browser User-Agent header, so one is
 * sent explicitly below.
 */

const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');

const SOURCE_URL = 'https://www.tsp.gov/data/fund-price-history.csv';
// NOTE: lives under public/, not a repo-root /data folder. Create React App
// (react-scripts, unejected) only ever serves files from public/ or bundles
// files imported from within src/ — anything else is invisible to the built
// site. public/data/... is fetched at runtime as a plain static asset, both
// in `npm start` and after a gh-pages deploy under the /tsp-rotation/ subpath.
const OUTPUT_PATH = path.join(__dirname, '..', 'public', 'data', 'tsp-prices.json');
const CORE_FUNDS = ['G', 'F', 'C', 'S', 'I'];

async function fetchCSV(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      Accept: 'text/csv,*/*',
    },
  });
  if (!res.ok) {
    throw new Error(`Fetch failed: ${res.status} ${res.statusText}`);
  }
  return res.text();
}

/** CSV columns are '<Fund> Fund' (e.g. "G Fund"); normalize to the bare letter. */
function fundColumnName(fund) {
  return `${fund} Fund`;
}

function normalize(csvText) {
  const parsed = Papa.parse(csvText.trim(), { header: true, skipEmptyLines: true });
  if (parsed.errors?.length) {
    const fatal = parsed.errors.filter((e) => e.type !== 'FieldMismatch');
    if (fatal.length) {
      throw new Error(`CSV parse errors: ${JSON.stringify(fatal.slice(0, 3))}`);
    }
  }

  const rows = parsed.data
    .map((row) => {
      const date = row.Date?.trim();
      if (!date) return null;
      const entry = { date };
      for (const fund of CORE_FUNDS) {
        const raw = row[fundColumnName(fund)];
        const val = raw === undefined || raw === '' ? null : Number(raw);
        entry[fund] = Number.isFinite(val) ? val : null;
      }
      return entry;
    })
    // Drop rows with no date, or missing any of the 5 core funds (e.g. the
    // source's trailing blank line, or any partial/malformed row).
    .filter((row) => row && CORE_FUNDS.every((f) => row[f] != null));

  // Source CSV is newest-first; the dashboard/backtest expect ascending.
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // De-dupe by date in case of any overlap/re-run artifacts.
  const seen = new Set();
  const deduped = rows.filter((row) => {
    if (seen.has(row.date)) return false;
    seen.add(row.date);
    return true;
  });

  return deduped;
}

// ---- integrity checks ------------------------------------------------
//
// A monthly-table source (year/month columns) can look current when it's
// actually only through the last CLOSED month — a "YTD" figure read from
// one of those can understate current performance by several points during
// a strong run. That's exactly what happened once already while building
// this: a spot-check against a monthly-table site under-reported July's
// actual YTD numbers. The daily-CSV approach avoids that by construction,
// but a bad pull or a broken parse could still silently feed wrong numbers
// downstream — these checks exist to catch that instead of staying quiet.

/**
 * Dated, one-time reference points spot-checked by hand against an
 * independent source at the time they were added. Not a live feed — this
 * is exactly the "monthly-table site, verified manually" kind of check the
 * spec calls for, automated so it re-runs on every future pull instead of
 * needing another manual check. Add more over time the same way.
 */
const REFERENCE_CHECKPOINTS = [
  {
    label: '2026 YTD through 2026-07-31',
    baselineDate: '2025-12-31', // prior year-end close
    asOf: '2026-07-31',
    expectedPct: { C: 10.13, S: 13.52, I: 15.35 },
    tolerancePp: 0.15,
  },
];

function findOnOrBefore(prices, targetDate) {
  let result = null;
  for (const row of prices) {
    if (row.date > targetDate) break;
    result = row;
  }
  return result;
}

/**
 * Guards the arithmetic in this script itself: compounding each fund's
 * day-over-day returns must reproduce its direct start/end price ratio.
 * This is a regression guard against a future bug in this file, not a
 * check against the source data (a telescoping product is tautologically
 * equal to the endpoints — it can't detect a source-side gap or bad row on
 * its own; REFERENCE_CHECKPOINTS below is what actually verifies against
 * an external number).
 */
function checkCompoundingConsistency(prices) {
  const errors = [];
  for (const fund of CORE_FUNDS) {
    let compounded = 1;
    for (let i = 1; i < prices.length; i++) {
      compounded *= prices[i][fund] / prices[i - 1][fund];
    }
    const direct = prices[prices.length - 1][fund] / prices[0][fund];
    const relError = Math.abs(compounded - direct) / direct;
    if (relError > 1e-6) {
      errors.push(`${fund}: compounded daily returns (${compounded.toFixed(6)}) don't match direct return (${direct.toFixed(6)})`);
    }
  }
  return errors;
}

/** Flags unexpectedly large gaps between consecutive trading dates (normal holiday gaps are a few days). */
function checkDateGaps(prices) {
  const warnings = [];
  for (let i = 1; i < prices.length; i++) {
    const days = (new Date(`${prices[i].date}T00:00:00Z`) - new Date(`${prices[i - 1].date}T00:00:00Z`)) / 86400000;
    if (days > 6) {
      warnings.push(`Gap of ${days} days between ${prices[i - 1].date} and ${prices[i].date} — longer than a normal holiday weekend.`);
    }
  }
  return warnings;
}

/** Flags implausible single-day moves (e.g. a decimal-shift parse bug), well outside even the worst real crash days. */
function checkDailyMoveSanity(prices) {
  const warnings = [];
  const THRESHOLD_PCT = 15;
  for (const fund of CORE_FUNDS) {
    for (let i = 1; i < prices.length; i++) {
      const change = ((prices[i][fund] - prices[i - 1][fund]) / prices[i - 1][fund]) * 100;
      if (Math.abs(change) > THRESHOLD_PCT) {
        warnings.push(`${fund} moved ${change.toFixed(1)}% on ${prices[i].date} — check for a parse/decimal error.`);
      }
    }
  }
  return warnings;
}

function checkReferenceCheckpoints(prices) {
  const warnings = [];
  for (const cp of REFERENCE_CHECKPOINTS) {
    const baseline = findOnOrBefore(prices, cp.baselineDate);
    const asOfRow = findOnOrBefore(prices, cp.asOf);
    if (!baseline || !asOfRow || asOfRow.date < cp.asOf) {
      continue; // data doesn't cover this checkpoint yet (or predates it) — nothing to check
    }
    for (const [fund, expectedPct] of Object.entries(cp.expectedPct)) {
      const actualPct = ((asOfRow[fund] - baseline[fund]) / baseline[fund]) * 100;
      const diff = Math.abs(actualPct - expectedPct);
      if (diff > cp.tolerancePp) {
        warnings.push(
          `${cp.label}: ${fund} computed ${actualPct.toFixed(2)}% vs. reference ${expectedPct.toFixed(2)}% (off by ${diff.toFixed(2)}pp, tolerance ${cp.tolerancePp}pp)`
        );
      }
    }
  }
  return warnings;
}

function runIntegrityChecks(prices) {
  const errors = checkCompoundingConsistency(prices);
  const warnings = [
    ...checkDateGaps(prices),
    ...checkDailyMoveSanity(prices),
    ...checkReferenceCheckpoints(prices),
  ];
  return { errors, warnings };
}

async function main() {
  console.log(`Fetching ${SOURCE_URL} ...`);
  const csvText = await fetchCSV(SOURCE_URL);
  const prices = normalize(csvText);

  if (prices.length === 0) {
    throw new Error('Parsed zero valid price rows — refusing to write an empty dataset.');
  }

  const { errors, warnings } = runIntegrityChecks(prices);
  if (errors.length > 0) {
    throw new Error(`Integrity check failed, refusing to write:\n  ${errors.join('\n  ')}`);
  }
  if (warnings.length > 0) {
    console.warn(`Integrity warnings (non-fatal, written into the output):\n  ${warnings.join('\n  ')}`);
  }

  const output = {
    asOf: prices[prices.length - 1].date,
    source: SOURCE_URL,
    fetchedAt: new Date().toISOString(),
    funds: CORE_FUNDS,
    integrityWarnings: warnings,
    prices,
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n');

  console.log(`Wrote ${prices.length} rows (${prices[0].date} .. ${output.asOf}) to ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
