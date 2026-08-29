import React, { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import KpiFilterRow from './KpiFilterRow';
import { kpiCounts, kpiDeltas, OVERDUE_DAYS, KPI_TILES } from './aggregations';

const day = 86400000;
const ago = n => new Date(Date.now() - n * day).toISOString();

/* barFiltered stand-in: what the filter bar produced, before any tile. */
const BAR_FILTERED = [
  { status: 'Submitted', submittedAt: ago(1) },
  { status: 'Submitted', submittedAt: ago(20) },      // overdue
  { status: 'Under Review', submittedAt: ago(3) },
  { status: 'Under Review', submittedAt: ago(40) },   // overdue
  { status: 'Compliance Check', submittedAt: ago(45) }, // overdue via the In Review fold
  { status: 'Query Raised', submittedAt: ago(6) },
  { status: 'Query Raised', submittedAt: ago(9) },
  { status: 'Query Raised', submittedAt: ago(11) },
  { status: 'Approved', submittedAt: ago(30), approvedAt: ago(25) },
  { status: 'Partially Approved', submittedAt: ago(22), approvedAt: ago(18) },
  { status: 'Rejected', submittedAt: ago(15), rejectedAt: ago(8) },
];

/* Mirrors the real wiring: counts always read barFiltered, never the tile. */
function Harness() {
  const [value, setValue] = useState('total');
  return (
    <KpiFilterRow
      tiles={KPI_TILES}
      counts={kpiCounts(BAR_FILTERED)}
      deltas={kpiDeltas(BAR_FILTERED, { days: 7 })}
      value={value}
      onChange={setValue}
      loading={false}
    />
  );
}

const tile = name => screen.getByRole('radio', { name: new RegExp(name, 'i') });
const countOf = name => within(tile(name)).getByText(/^\d+$/).textContent;

describe('KpiFilterRow — counts are independent of the selection', () => {
  test('clicking Query leaves the Query tile showing the same count', () => {
    render(<Harness />);
    const before = countOf('Query');
    expect(before).toBe('3');

    fireEvent.click(tile('Query'));

    expect(tile('Query')).toHaveAttribute('aria-checked', 'true');
    expect(countOf('Query')).toBe(before);
  });

  test('selecting a tile does not zero any other tile', () => {
    render(<Harness />);
    const snapshot = KPI_TILES.map(t => countOf(t.label));
    fireEvent.click(tile('Rejected'));
    expect(KPI_TILES.map(t => countOf(t.label))).toEqual(snapshot);
  });
});

describe('KpiFilterRow — radiogroup semantics', () => {
  test('exposes a radiogroup with one radio per tile', () => {
    render(<Harness />);
    expect(screen.getByRole('radiogroup', { name: /filter applications by status/i })).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(KPI_TILES.length);
  });

  test('roving tabindex: only the checked tile is tabbable', () => {
    render(<Harness />);
    expect(tile('Total')).toHaveAttribute('tabindex', '0');
    expect(tile('Approved')).toHaveAttribute('tabindex', '-1');
  });

  test('arrow keys move the selection', () => {
    render(<Harness />);
    fireEvent.keyDown(tile('Total'), { key: 'ArrowRight' });
    expect(tile('New')).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(tile('New'), { key: 'ArrowLeft' });
    expect(tile('Total')).toHaveAttribute('aria-checked', 'true');
  });

  test('Home and End jump to first and last', () => {
    render(<Harness />);
    fireEvent.keyDown(tile('Total'), { key: 'End' });
    expect(tile('Overdue')).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(tile('Overdue'), { key: 'Home' });
    expect(tile('Total')).toHaveAttribute('aria-checked', 'true');
  });

  test('clicking the active tile clears the selection back to all', () => {
    render(<Harness />);
    fireEvent.click(tile('Approved'));
    expect(tile('Approved')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(tile('Approved'));
    expect(tile('Total')).toHaveAttribute('aria-checked', 'true');
  });
});

describe('KpiFilterRow — Overdue tile', () => {
  test('states the threshold in its title so nobody must read the code', () => {
    render(<Harness />);
    expect(tile('Overdue')).toHaveAttribute(
      'title',
      `Submitted or in review (including document verification and compliance check) for more than ${OVERDUE_DAYS} days`
    );
  });

  test('counts only Submitted / Under Review beyond the threshold', () => {
    render(<Harness />);
    expect(countOf('Overdue')).toBe('3');
  });
});
