import React, { useMemo } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import ChartCard from './ChartCard';
import { statusDistribution } from '../aggregations';
import { fmtInt, fmtPct, statusColor } from './chartTheme';

/* ============================================================================
   Status Distribution — the only pie permitted by the chart rules.
   Segment colours come from the same status tokens the KPI tiles and the
   table's status pills use, so the three can never disagree.
   ============================================================================ */

function DonutTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const row = payload[0].payload;
  return (
    <div className="cc-tip">
      <div className="cc-tip-label">{row.status}</div>
      <div className="cc-tip-value tnum">{fmtInt(row.value)} ({fmtPct(row.share)})</div>
    </div>
  );
}

export default function StatusDonut({ apps, loading, onSelectStatus }) {
  const rows = useMemo(() => statusDistribution(apps), [apps]);
  const total = rows.reduce((s, r) => s + r.value, 0);

  return (
    <ChartCard
      title="Status Distribution"
      subtitle="Current status of every application in view. Select a status to filter the queue."
      span={4}
      loading={loading}
      empty={!loading && total === 0}
      height={260}
      table={{
        columns: [
          { key: 'status', label: 'Status' },
          { key: 'value', label: 'Applications', numeric: true, render: r => fmtInt(r.value) },
          { key: 'share', label: 'Share', numeric: true, render: r => fmtPct(r.share) },
        ],
        rows: rows.map(r => ({ ...r, key: r.status })),
      }}
    >
      <div className="cc-donut">
        <div className="cc-donut-plot" role="img" aria-label={`Status distribution of ${fmtInt(total)} applications.`}>
          <ResponsiveContainer width="100%" height={150}>
            <PieChart>
              <Pie
                data={rows}
                dataKey="value"
                nameKey="status"
                innerRadius="62%"
                outerRadius="92%"
                paddingAngle={1}
                stroke="none"
                isAnimationActive={false}
                onClick={row => onSelectStatus && onSelectStatus(row.status)}
              >
                {rows.map(r => (
                  <Cell
                    key={r.status}
                    fill={statusColor(r.status)}
                    cursor={onSelectStatus ? 'pointer' : 'default'}
                  />
                ))}
              </Pie>
              <Tooltip content={<DonutTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="cc-donut-centre" aria-hidden="true">
            <span className="cc-donut-total tnum">{fmtInt(total)}</span>
            <span className="cc-donut-cap">Total</span>
          </div>
        </div>

        {/* Legend doubles as the filter control, so status is never encoded by
            colour alone. */}
        <ul className="cc-legend">
          {rows.map(r => (
            <li key={r.status}>
              <button
                type="button"
                onClick={() => onSelectStatus && onSelectStatus(r.status)}
                disabled={!onSelectStatus}
              >
                <span className="cc-swatch" style={{ background: statusColor(r.status) }} aria-hidden="true" />
                <span className="cc-legend-label">{r.status}</span>
                <span className="cc-legend-value tnum">{fmtInt(r.value)}</span>
                <span className="cc-legend-share tnum">{fmtPct(r.share)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </ChartCard>
  );
}
