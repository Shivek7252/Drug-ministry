import React from 'react';
import {
  Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import ChartCard from './ChartCard';
import {
  axisProps, fmtInt, fmtPct, fmtValueWithShare, seriesColors, token,
} from './chartTheme';

/* ============================================================================
   RankedBarChart — shared horizontal "count by dimension, sorted descending"
   primitive behind Category Mix, Destination Countries and State Distribution.

   Labels are never truncated: the Y axis is given real width and long names
   wrap into the tick. Presentational only.
   ============================================================================ */

function RankedTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const row = payload[0].payload;
  return (
    <div className="cc-tip">
      <div className="cc-tip-label">{row.label}</div>
      <div className="cc-tip-value tnum">{fmtValueWithShare(row.value, row.share)}</div>
    </div>
  );
}

/* Long labels wrap rather than clip (audit item 9). */
function WrappedTick({ x, y, payload, width }) {
  const text = String(payload.value || '');
  const perLine = Math.max(10, Math.floor((width || 140) / 6.4));
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > perLine && line) { lines.push(line); line = w; }
    else line = (line + ' ' + w).trim();
  }
  if (line) lines.push(line);
  const shown = lines.slice(0, 2);
  if (lines.length > 2) shown[1] = `${shown[1].slice(0, perLine - 1)}…`;

  return (
    <text x={x} y={y} textAnchor="end" fill={token('--chart-axis')} fontSize={11}>
      {shown.map((l, i) => (
        <tspan key={i} x={x} dy={i === 0 ? (shown.length > 1 ? -3 : 4) : 12}>{l}</tspan>
      ))}
      <title>{text}</title>
    </text>
  );
}

export default function RankedBarChart({
  title, subtitle, span, rows, loading, height = 240,
  colorMode = 'single', yWidth = 150, emptyMessage,
}) {
  const palette = seriesColors();
  const barFill = token('--chart-1');

  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      span={span}
      loading={loading}
      empty={!loading && rows.length === 0}
      emptyMessage={emptyMessage}
      height={height}
      table={{
        columns: [
          { key: 'label', label: title },
          { key: 'value', label: 'Applications', numeric: true, render: r => fmtInt(r.value) },
          { key: 'share', label: 'Share', numeric: true, render: r => fmtPct(r.share) },
        ],
        rows,
      }}
    >
      <div className="cc-plot" role="img" aria-label={`${title}. ${rows.length} categories shown.`}>
        <ResponsiveContainer width="100%" height={height}>
          <BarChart
            data={rows}
            layout="vertical"
            margin={{ top: 4, right: 44, bottom: 4, left: 4 }}
            barCategoryGap={6}
          >
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="label"
              width={yWidth}
              interval={0}
              {...axisProps()}
              tick={<WrappedTick width={yWidth} />}
            />
            <Tooltip content={<RankedTooltip />} cursor={{ fill: token('--chart-grid'), fillOpacity: 0.35 }} />
            <Bar dataKey="value" radius={[0, 3, 3, 0]} isAnimationActive={false}>
              {rows.map((row, i) => (
                <Cell key={row.label} fill={colorMode === 'series' ? palette[i % palette.length] : barFill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
