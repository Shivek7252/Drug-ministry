import React from 'react';

/* ============================================================================
   ChartDataTable — the text alternative every chart card must expose
   (GIGW 3.0 / WCAG 2.1 AA). A real <table> with scope'd headers, not a
   visual grid, so screen readers and copy-paste both work.

   `note` carries any definition the figures depend on — e.g. the funnel's
   query-hold rule — so the alternative is as explainable as the chart.
   ============================================================================ */

export default function ChartDataTable({ caption, columns, rows, note }) {
  if (!rows || rows.length === 0) {
    return <p className="cc-table-empty">No figures to show for the current filters.</p>;
  }

  return (
    <div className="cc-table-wrap">
      <table className="cc-table">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map(col => (
              <th
                key={col.key}
                scope="col"
                className={col.numeric ? 'cc-num' : undefined}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.key ?? i}>
              {columns.map((col, ci) => {
                const value = col.render ? col.render(row) : row[col.key];
                const cls = col.numeric ? 'cc-num tnum' : undefined;
                return ci === 0
                  ? <th key={col.key} scope="row" className={cls}>{value}</th>
                  : <td key={col.key} className={cls}>{value}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {note && <p className="cc-table-note">{note}</p>}
    </div>
  );
}
