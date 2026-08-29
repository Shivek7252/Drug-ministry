import React, { useMemo } from 'react';
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import ChartCard from './ChartCard';
import { decisionThroughput } from '../aggregations';
import { axisProps, fmtDateKey, fmtInt, gridProps, statusColor, token } from './chartTheme';

/* ============================================================================
   Decision Throughput — decisions recorded per week, plus the open backlog.

   Deliberately NOT framed as reviewer workload: the application model carries
   no assignee, so no per-reviewer attribution is possible and none is implied
   anywhere in the title, subtitle or legend.
   ============================================================================ */

const SERIES = [
  { key: 'approved', label: 'Approved', status: 'Approved' },
  { key: 'partiallyApproved', label: 'Partially Approved', status: 'Partially Approved' },
  { key: 'rejected', label: 'Rejected', status: 'Rejected' },
  { key: 'pending', label: 'Still open', status: 'Submitted' },
];

function ThroughputTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  const total = payload.reduce((s, p) => s + (p.value || 0), 0);
  return (
    <div className="cc-tip">
      <div className="cc-tip-label">Week of {fmtDateKey(label, 'day')}</div>
      {payload.map(p => (
        <div key={p.dataKey} className="cc-tip-row tnum">
          {p.name}: {fmtInt(p.value)}
          {total ? ` (${Math.round((p.value / total) * 100)}%)` : ''}
        </div>
      ))}
      <div className="cc-tip-row cc-tip-net tnum">Total: {fmtInt(total)}</div>
    </div>
  );
}

export default function DecisionThroughput({ apps, loading }) {
  const rows = useMemo(() => decisionThroughput(apps, { weeks: 12 }), [apps]);
  const hasData = rows.some(r => r.approved || r.partiallyApproved || r.rejected || r.pending);

  return (
    <ChartCard
      title="Decision Throughput"
      subtitle="Decisions recorded per week, with applications still open shown against the week they were received."
      span={6}
      loading={loading}
      empty={!loading && !hasData}
      height={260}
      table={{
        columns: [
          { key: 'key', label: 'Week beginning', render: r => fmtDateKey(r.key, 'day') },
          { key: 'approved', label: 'Approved', numeric: true, render: r => fmtInt(r.approved) },
          { key: 'partiallyApproved', label: 'Partially Approved', numeric: true, render: r => fmtInt(r.partiallyApproved) },
          { key: 'rejected', label: 'Rejected', numeric: true, render: r => fmtInt(r.rejected) },
          { key: 'pending', label: 'Still open', numeric: true, render: r => fmtInt(r.pending) },
        ],
        rows,
        note: 'Decided applications are counted in the week the decision was recorded. Open applications are counted in the week they were received, so the bar shows arriving work that has not yet been disposed.',
      }}
    >
      <div className="cc-plot" role="img" aria-label="Decision throughput by week: approved, partially approved, rejected and still open.">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
            <CartesianGrid {...gridProps()} />
            <XAxis
              dataKey="key"
              {...axisProps()}
              tickFormatter={k => fmtDateKey(k, 'day')}
              minTickGap={16}
            />
            <YAxis {...axisProps()} allowDecimals={false} width={44} />
            <Tooltip content={<ThroughputTooltip />} cursor={{ fill: token('--chart-grid'), fillOpacity: 0.35 }} />
            <Legend
              verticalAlign="top"
              align="right"
              height={24}
              iconType="square"
              wrapperStyle={{ fontSize: 12, color: token('--chart-axis') }}
            />
            {SERIES.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                stackId="decisions"
                fill={statusColor(s.status)}
                isAnimationActive={false}
                radius={i === SERIES.length - 1 ? [3, 3, 0, 0] : undefined}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
