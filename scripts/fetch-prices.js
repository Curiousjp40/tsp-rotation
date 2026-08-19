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

async function main() {
  console.log(`Fetching ${SOURCE_URL} ...`);
  const csvText = await fetchCSV(SOURCE_URL);
  const prices = normalize(csvText);

  if (prices.length === 0) {
    throw new Error('Parsed zero valid price rows — refusing to write an empty dataset.');
  }

  const output = {
    asOf: prices[prices.length - 1].date,
    source: SOURCE_URL,
    fetchedAt: new Date().toISOString(),
    funds: CORE_FUNDS,
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
