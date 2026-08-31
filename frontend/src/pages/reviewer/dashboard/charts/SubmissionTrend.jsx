import React, { useMemo, useState } from 'react';
import {
  Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import ChartCard from './ChartCard';
import { submissionTrend } from '../aggregations';
import {
  AREA_FILL_OPACITY, axisProps, fmtDateKey, fmtInt, gridProps, token,
} from './chartTheme';

/* ============================================================================
   Submission Trend — received vs disposed.
   The gap between the two series IS the backlog growth, which is the reason
   both are on one axis rather than in separate cards.
   ============================================================================ */

const GRANULARITIES = [
  { key: 'day', label: 'Daily', days: 90 },
  { key: 'week', label: 'Weekly', days: 180 },
  { key: 'month', label: 'Monthly', days: 365 },
];

function TrendTooltip({ active, payload, label, granularity }) {
  if (!active || !payload || !payload.length) return null;
  const received = payload.find(p => p.dataKey === 'received')?.value || 0;
  const disposed = payload.find(p => p.dataKey === 'disposed')?.value || 0;
  const net = received - disposed;
  return (
    <div className="cc-tip">
      <div className="cc-tip-label">{fmtDateKey(label, granularity)}</div>
      <div className="cc-tip-row tnum">Received: {fmtInt(received)}</div>
      <div className="cc-tip-row tnum">Disposed: {fmtInt(disposed)}</div>
      <div className="cc-tip-row cc-tip-net tnum">
        Backlog change: {net > 0 ? '+' : ''}{fmtInt(net)}
      </div>
    </div>
  );
}

export default function SubmissionTrend({ apps = [], series = null, loading, error }) {
  const [granularity, setGranularity] = useState('day');
  const active = GRANULARITIES.find(g => g.key === granularity) || GRANULARITIES[0];

  const derivedRows = useMemo(
    () => submissionTrend(apps, { granularity, days: active.days }),
    [apps, granularity, active.days]
  );
  const rows = series?.[granularity] || derivedRows;

  const hasData = rows.some(r => r.received > 0 || r.disposed > 0);
  const cReceived = token('--chart-1');
  const cDisposed = token('--chart-3');

  const segmented = (
    <div className="cc-segmented" role="group" aria-label="Trend granularity">
      {GRANULARITIES.map(g => (
        <button
          key={g.key}
          type="button"
          onClick={() => setGranularity(g.key)}
          aria-pressed={granularity === g.key}
          className={granularity === g.key ? 'is-active' : ''}
        >
          {g.label}
        </button>
      ))}
    </div>
  );

  return (
    <ChartCard
      title="Submission Trend"
      subtitle={`Received vs disposed, ${active.label.toLowerCase()} over ${active.days} days — the gap is backlog growth.`}
      span={8}
      loading={loading}
      error={error}
      empty={!loading && !hasData}
      height={300}
      actions={segmented}
      table={{
        columns: [
          { key: 'key', label: 'Period', render: r => fmtDateKey(r.key, granularity) },
          { key: 'received', label: 'Received', numeric: true, render: r => fmtInt(r.received) },
          { key: 'disposed', label: 'Disposed', numeric: true, render: r => fmtInt(r.disposed) },
          {
            key: 'net',
            label: 'Backlog change',
            numeric: true,
            render: r => `${r.received - r.disposed > 0 ? '+' : ''}${fmtInt(r.received - r.disposed)}`,
          },
        ],
        rows: rows.filter(r => r.received > 0 || r.disposed > 0),
        note: 'Disposed counts an application in the period its decision was recorded, not the period it was received.',
      }}
    >
      <div className="cc-plot" role="img" aria-label={`Submission trend, ${active.label.toLowerCase()}. Received and disposed applications over the last ${active.days} days.`}>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={rows} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
            <CartesianGrid {...gridProps()} />
            <XAxis
              dataKey="key"
              {...axisProps()}
              tickFormatter={k => fmtDateKey(k, granularity)}
              minTickGap={24}
            />
            <YAxis {...axisProps()} allowDecimals={false} width={44} />
            <Tooltip content={<TrendTooltip granularity={granularity} />} />
            <Legend
              verticalAlign="top"
              align="right"
              height={24}
              iconType="plainline"
              wrapperStyle={{ fontSize: 12, color: token('--chart-axis') }}
            />
            <Area
              type="monotone" dataKey="received" name="Received"
              stroke={cReceived} fill={cReceived} fillOpacity={AREA_FILL_OPACITY}
              strokeWidth={2} isAnimationActive={false}
            />
            <Area
              type="monotone" dataKey="disposed" name="Disposed"
              stroke={cDisposed} fill={cDisposed} fillOpacity={AREA_FILL_OPACITY}
              strokeWidth={2} strokeDasharray="5 3" isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
