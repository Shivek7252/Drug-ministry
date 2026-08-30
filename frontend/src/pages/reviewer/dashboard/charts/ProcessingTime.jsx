import React, { useMemo } from 'react';
import {
  Bar, BarChart, Cell, LabelList, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import ChartCard from './ChartCard';
import { processingTime } from '../aggregations';
import {
  axisProps, fmtInt, fmtPct, fmtValueWithShare, tatRamp, token,
} from './chartTheme';

/* ============================================================================
   Processing Time (TAT) — the operationally decisive chart, so it gets the
   tallest plot and the median annotation.

   Turnaround is submission → decision for disposed applications, and
   submission → today for those still open, which is what makes the ageing
   tail visible rather than hidden behind completed work.
   ============================================================================ */

function TatTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const row = payload[0].payload;
  return (
    <div className="cc-tip">
      <div className="cc-tip-label">{row.label}</div>
      <div className="cc-tip-value tnum">{fmtValueWithShare(row.value, row.share)}</div>
    </div>
  );
}

export default function ProcessingTime({ apps, loading }) {
  const { rows, median, counted } = useMemo(() => processingTime(apps), [apps]);
  const ramp = tatRamp();

  /* The reference line sits on the bucket the median falls inside. */
  const medianBucket = median === null
    ? null
    : rows.find(r => median >= r.min && median <= r.max);

  return (
    <ChartCard
      title="Processing Time"
      subtitle="Turnaround per application: submission to decision, or to today while still open."
      span={6}
      loading={loading}
      empty={!loading && counted === 0}
      height={280}
      footnote={
        median === null
          ? undefined
          : `Median turnaround ${median} day${median === 1 ? '' : 's'} across ${fmtInt(counted)} application${counted === 1 ? '' : 's'}.`
      }
      table={{
        columns: [
          { key: 'label', label: 'Age bucket' },
          { key: 'value', label: 'Applications', numeric: true, render: r => fmtInt(r.value) },
          { key: 'share', label: 'Share', numeric: true, render: r => fmtPct(r.share) },
        ],
        rows: rows.map(r => ({ ...r, key: r.key })),
        note: median === null
          ? undefined
          : `Median turnaround is ${median} day${median === 1 ? '' : 's'}. Open applications are measured to today, not to a decision.`,
      }}
    >
      <div className="cc-plot" role="img" aria-label={`Processing time by age bucket. Median ${median ?? 'not available'} days.`}>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart
            data={rows}
            layout="vertical"
            margin={{ top: 4, right: 52, bottom: 4, left: 4 }}
            barCategoryGap={8}
          >
            <XAxis type="number" hide />
            <YAxis type="category" dataKey="label" width={110} interval={0} {...axisProps()} />
            <Tooltip content={<TatTooltip />} cursor={{ fill: token('--chart-grid'), fillOpacity: 0.35 }} />
            {medianBucket && (
              <ReferenceLine
                y={medianBucket.label}
                stroke={token('--chart-ref')}
                strokeDasharray="4 3"
                label={{
                  value: `Median ${median}d`,
                  position: 'right',
                  fill: token('--chart-ref'),
                  fontSize: 11,
                  fontWeight: 700,
                }}
              />
            )}
            <Bar dataKey="value" radius={[0, 3, 3, 0]} isAnimationActive={false}>
              {rows.map((row, i) => <Cell key={row.key} fill={ramp[i] || ramp[ramp.length - 1]} />)}
              <LabelList
                dataKey="value"
                position="right"
                className="tnum"
                style={{ fill: token('--chart-axis'), fontSize: 11 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
