import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine,
} from 'recharts';
import { cumulativeReturnSeries, blendedValueSeries, windowStartIndex } from '../lib/metrics';

const FUND_COLORS = { C: 'var(--fund-c)', S: 'var(--fund-s)', I: 'var(--fund-i)', F: 'var(--fund-f)', G: 'var(--fund-g)' };
const FUND_ORDER = ['C', 'S', 'I', 'F', 'G'];
const BLEND_COLOR = 'var(--navy)';

function buildChartData(prices, asOfIndex, windowMonths, allocation) {
  const perFund = {};
  for (const fund of FUND_ORDER) {
    perFund[fund] = cumulativeReturnSeries(prices, fund, asOfIndex, windowMonths);
  }
  const startIdx = windowStartIndex(prices, asOfIndex, windowMonths);
  const blendSeries = startIdx == null ? [] : blendedValueSeries(prices, allocation, startIdx, asOfIndex);
  const blendByDate = new Map(blendSeries.map((p) => [p.date, (p.value - 1) * 100]));

  const dates = perFund.C.map((row) => row.date);
  return dates.map((date, i) => {
    const point = { date, BLEND: blendByDate.get(date) ?? null };
    for (const fund of FUND_ORDER) {
      point[fund] = perFund[fund][i]?.returnPct ?? null;
    }
    return point;
  });
}

function formatDate(d) {
  const [, m, day] = d.split('-');
  return `${m}/${day}`;
}

export default function RotationChart({ prices, asOfIndex, windowMonths, allocation }) {
  const data = buildChartData(prices, asOfIndex, windowMonths, allocation);

  return (
    <div className="card">
      <div className="card-title">
        <span><span className="icon">📈</span>Cumulative trailing return</span>
      </div>
      <div className="chart-wrap">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="date" tickFormatter={formatDate} tick={{ fontSize: 11, fill: 'var(--muted)' }} minTickGap={30} />
            <YAxis tickFormatter={(v) => `${v.toFixed(0)}%`} tick={{ fontSize: 11, fill: 'var(--muted)' }} width={48} />
            <ReferenceLine y={0} stroke="var(--border)" />
            <Tooltip
              formatter={(value, name) => [`${Number(value).toFixed(2)}%`, name]}
              labelFormatter={(label) => label}
              contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid var(--border)' }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {FUND_ORDER.map((fund) => (
              <Line
                key={fund}
                type="monotone"
                dataKey={fund}
                name={`${fund} Fund`}
                stroke={FUND_COLORS[fund]}
                strokeWidth={1.5}
                dot={false}
                connectNulls
              />
            ))}
            <Line
              type="monotone"
              dataKey="BLEND"
              name="Your blend (current)"
              stroke={BLEND_COLOR}
              strokeWidth={3.5}
              dot={false}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="chart-legend-note">Your blended allocation is drawn thickest. Prices are once-daily closing NAVs — there's no intraday movement to show.</div>
    </div>
  );
}
