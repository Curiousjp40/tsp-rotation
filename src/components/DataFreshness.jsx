import { useState, useEffect } from 'react';

// This dashboard lives at exactly one repo — these aren't the kind of
// "hardcoded" the freshness numbers below need to avoid (a hardcoded DATE
// that silently goes stale); they're just where to ask GitHub the question.
const OWNER = 'Curiousjp40';
const REPO = 'tsp-rotation';
const WORKFLOW_FILE = 'update-prices.yml';

// Must match the cron in .github/workflows/update-prices.yml — if that
// schedule ever changes, update this too.
const CRON_HOUR_UTC = 3;
const CRON_MINUTE_UTC = 30;

function nextScheduledRun(fromDate) {
  const next = new Date(fromDate);
  next.setUTCHours(CRON_HOUR_UTC, CRON_MINUTE_UTC, 0, 0);
  if (next <= fromDate) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

function fmtDateTime(d) {
  return d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
}

function relativeTime(iso) {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

/**
 * Reads the real GitHub Actions run history for the price-fetch workflow
 * (client-side, GitHub's public API sends permissive CORS headers for
 * unauthenticated reads on a public repo) — not a hardcoded date, and not
 * just trusting the committed JSON's own fetchedAt field, which would stay
 * silent if the pipeline started failing. If the most recent run failed,
 * that's surfaced directly rather than only showing the last success.
 */
export default function DataFreshness({ asOf }) {
  const [status, setStatus] = useState('loading'); // loading | ok | error
  const [lastSuccess, setLastSuccess] = useState(null);
  const [latestRun, setLatestRun] = useState(null);

  useEffect(() => {
    fetch(`https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_FILE}/runs?per_page=10`, {
      headers: { Accept: 'application/vnd.github+json' },
    })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status));
        return res.json();
      })
      .then((json) => {
        const runs = json.workflow_runs || [];
        setLatestRun(runs[0] ?? null);
        setLastSuccess(runs.find((r) => r.conclusion === 'success') ?? null);
        setStatus('ok');
      })
      .catch(() => setStatus('error'));
  }, []);

  const next = nextScheduledRun(new Date());
  const latestFailed = latestRun && latestRun.status === 'completed' && latestRun.conclusion !== 'success';

  return (
    <div className="card freshness-card">
      <div className="freshness-row">
        <span className="stat-note">Data as of</span> <strong>{asOf}</strong>
        <span className="freshness-sep">·</span>
        <span className="stat-note">Next scheduled update</span> <strong>{fmtDateTime(next)}</strong>
      </div>

      {status === 'loading' && <div className="chart-legend-note">Checking the price-fetch workflow's run history…</div>}

      {status === 'error' && (
        <div className="chart-legend-note">
          Couldn't reach GitHub Actions to confirm the pipeline is healthy — this doesn't mean it's broken, just that
          this check failed (rate limit or a network hiccup). <a href={`https://github.com/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_FILE}`} target="_blank" rel="noreferrer">Check the Actions tab directly</a>.
        </div>
      )}

      {status === 'ok' && (
        <div className="chart-legend-note">
          Price-fetch workflow: {lastSuccess
            ? <>last succeeded <strong>{relativeTime(lastSuccess.created_at)}</strong></>
            : 'no successful run found in recent history'}
          {latestFailed && (
            <>
              {' '}— and <a href={latestRun.html_url} target="_blank" rel="noreferrer" style={{ color: 'var(--danger)', fontWeight: 700 }}>
                its most recent attempt failed ({relativeTime(latestRun.created_at)})
              </a>, worth a look.
            </>
          )}
          {' '}<a href={`https://github.com/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_FILE}`} target="_blank" rel="noreferrer">Full run history</a>.
        </div>
      )}
    </div>
  );
}
