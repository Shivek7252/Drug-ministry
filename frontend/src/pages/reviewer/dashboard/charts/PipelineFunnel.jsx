import React, { useMemo } from 'react';
import {
  Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import ChartCard from './ChartCard';
import { pipelineFunnel, queryHold } from '../aggregations';
import { axisProps, fmtInt, fmtPct, seriesColors, token } from './chartTheme';

/* ============================================================================
   Pipeline Funnel — cumulative, built entirely from recorded status.

   No stage is inferred. 'Query Raised' is a hold, not a stage, so it is never
   a bar; it is reported beside the chart and reconciled in the footnote.

   TODO: replace with a true time-based funnel once auditLog transition history
   is exposed on the reviewer list endpoint — see aggregations.pipelineFunnel.
   ============================================================================ */

function FunnelTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const row = payload[0].payload;
  return (
    <div className="cc-tip">
      <div className="cc-tip-label">{row.label}</div>
      <div className="cc-tip-value tnum">{fmtInt(row.value)} ({fmtPct(row.share)} of intake)</div>
      {row.dropOff !== null && (
        <div className="cc-tip-row tnum">
          Drop-off from previous stage: {fmtInt(row.dropOff)}
          {row.dropOffShare !== null ? ` (${fmtPct(row.dropOffShare)})` : ''}
        </div>
      )}
    </div>
  );
}

export default function PipelineFunnel({ apps = [], data = null, loading, error }) {
  const derivedStages = useMemo(() => pipelineFunnel(apps), [apps]);
  const derivedHold = useMemo(() => queryHold(apps), [apps]);
  const stages = data?.stages || derivedStages;
  const hold = data?.hold || derivedHold;
  const palette = seriesColors();
  const entry = stages[0]?.value || 0;

  const footnote = hold.held > 0
    ? `Includes ${fmtInt(hold.held)} application${hold.held === 1 ? '' : 's'} (${fmtPct(hold.share)}) currently held at query, counted at the stages they have cleared.`
    : undefined;

  return (
    <ChartCard
      title="Pipeline Funnel"
      subtitle="Cumulative — each stage counts applications that reached it or moved past it."
      span={6}
      className="cc-wide-tablet"
      loading={loading}
      error={error}
      empty={!loading && entry === 0}
      height={300}
      footnote={footnote}
      table={{
        columns: [
          { key: 'label', label: 'Stage' },
          { key: 'value', label: 'Reached', numeric: true, render: r => fmtInt(r.value) },
          { key: 'share', label: 'Share of intake', numeric: true, render: r => fmtPct(r.share) },
          {
            key: 'dropOff',
            label: 'Drop-off',
            numeric: true,
            render: r => (r.dropOff === null ? '—'
              : `${fmtInt(r.dropOff)}${r.dropOffShare !== null ? ` (${fmtPct(r.dropOffShare)})` : ''}`),
          },
        ],
        rows: stages.map(s => ({ ...s, key: s.key })),
        note: [
          'Cumulative: each stage counts applications that have reached it or moved past it, so a decided application still counts at every prior stage.',
          hold.held > 0
            ? `Includes ${fmtInt(hold.held)} application${hold.held === 1 ? '' : 's'} currently held at query, counted at the stages they have cleared (Submitted and Under Review). Query Raised is not itself a pipeline stage.`
            : 'Query Raised is an off-pipeline hold and is not a pipeline stage.',
        ].join(' '),
      }}
    >
      <div className="cc-plot" role="img" aria-label={`Cumulative pipeline funnel across ${stages.length} stages, from ${fmtInt(entry)} applications at intake.`}>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart
            data={stages}
            layout="vertical"
            margin={{ top: 4, right: 64, bottom: 4, left: 4 }}
            barCategoryGap={6}
          >
            <XAxis type="number" domain={[0, entry || 1]} hide />
            <YAxis type="category" dataKey="label" width={150} interval={0} {...axisProps()} />
            <Tooltip content={<FunnelTooltip />} cursor={{ fill: token('--chart-grid'), fillOpacity: 0.35 }} />
            <Bar dataKey="value" radius={[0, 3, 3, 0]} isAnimationActive={false}>
              {stages.map((s, i) => (
                <Cell key={s.key} fill={palette[i % palette.length]} />
              ))}
              <LabelList
                dataKey="value"
                position="right"
                className="tnum"
                style={{ fill: token('--chart-axis'), fontSize: 11 }}
                formatter={v => fmtInt(v)}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
