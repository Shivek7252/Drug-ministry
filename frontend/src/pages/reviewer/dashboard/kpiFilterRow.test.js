import React, { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import KpiFilterRow from './KpiFilterRow';
import { kpiCounts, kpiDeltas, KPI_TILES } from './aggregations';
import { SLA_DESCRIPTION } from './statusModel';

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
    expect(tile('Submitted')).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(tile('Submitted'), { key: 'ArrowLeft' });
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
    expect(tile('Overdue')).toHaveAttribute('title', SLA_DESCRIPTION);
  });

  test('counts only Submitted / Under Review beyond the threshold', () => {
    render(<Harness />);
    expect(countOf('Overdue')).toBe('3');
  });
});

/* ============================================================================
   Server-computed comparisons: what the arrow, percentage and label mean.
   ============================================================================ */
describe('KPI delta rendering from server analytics', () => {
  const tiles = KPI_TILES;
  const counts = { total: 13, submitted: 10, underReview: 1, queryRaised: 1, approved: 1, rejected: 0, overdue: 10 };
  const partial = { windows: { currentWeekComplete: false } };

  const renderRow = (deltas, analytics = partial) => render(
    <KpiFilterRow
      tiles={tiles} counts={counts} deltas={deltas}
      value="all" onChange={() => {}} loading={false}
      unreadCount={12} readStateReady analytics={analytics}
    />,
  );

  test('an increase renders an up arrow, a signed value and the percentage', () => {
    renderRow({ total: { available: true, current: 3, prior: 2, delta: 1, percent: 50, direction: 'up' } });
    expect(screen.getByText(/\+1 WTD/)).toBeInTheDocument();
    expect(screen.getByText(/\+50%/)).toBeInTheDocument();
  });

  test('a decrease renders a down arrow and a negative value', () => {
    renderRow({ total: { available: true, current: 0, prior: 2, delta: -2, percent: -100, direction: 'down' } });
    expect(screen.getByText(/-2 WTD/)).toBeInTheDocument();
  });

  test('no percentage is shown when the previous week was zero', () => {
    renderRow({ total: { available: true, current: 2, prior: 0, delta: 2, percent: null, direction: 'up' } });
    expect(screen.getByText(/\+2 WTD/)).toBeInTheDocument();
    expect(screen.queryByText(/%/)).toBeNull();
  });

  test('an equal week renders no comparison text or empty delta element', () => {
    renderRow({ rejected: { available: true, current: 0, prior: 0, delta: 0, percent: null, direction: 'flat' } });
    const tile = screen.getByRole('radio', { name: /Rejected/ });
    expect(tile).toHaveTextContent('0');
    expect(tile.querySelector('.kpi-delta')).toBeNull();
    expect(screen.queryByText(/No WTD change/)).not.toBeInTheDocument();
  });

  test('an unavailable comparison says so and never shows a number', () => {
    renderRow({
      overdue: {
        available: false,
        reason: 'Historical data unavailable',
        detail: '3 application(s) have no reconcilable status history.',
      },
    });
    const el = screen.getAllByText('Historical data unavailable')[0];
    expect(el).toBeInTheDocument();
    expect(el).toHaveAttribute('title', expect.stringContaining('reconcilable status history'));
  });

  test('the tooltip states both weeks and the event being counted', () => {
    renderRow({
      approved: {
        available: true, current: 1, prior: 4, delta: -3, percent: -75, direction: 'down',
        basis: 'Applications approved in the window, even if later rejected.',
      },
    });
    const el = screen.getByText(/-3 WTD/).closest('.kpi-delta');
    expect(el).toHaveAttribute('title', expect.stringContaining('1 week to date vs 4 in the same period last week'));
    expect(el).toHaveAttribute('title', expect.stringContaining('even if later rejected'));
    expect(el).toHaveAttribute('title', expect.stringContaining('same period last week'));
  });

  test('a complete week omits the in-progress note', () => {
    renderRow(
      { total: { available: true, current: 5, prior: 4, delta: 1, percent: 25, direction: 'up' } },
      { windows: { currentWeekComplete: true } },
    );
    const el = screen.getByText(/\+1 WTD/).closest('.kpi-delta');
    expect(el.getAttribute('title')).not.toContain('still in progress');
  });

  test('a missing comparison degrades to Not comparable rather than crashing', () => {
    renderRow({});
    expect(screen.getAllByText('Not comparable').length).toBe(tiles.length);
  });

  test('counts still come from the count prop, never from the delta', () => {
    renderRow({ total: { available: true, current: 99, prior: 1, delta: 98, percent: 9800, direction: 'up' } });
    const tile = screen.getByRole('radio', { name: /Total/ });
    expect(tile.querySelector('.kpi-value')).toHaveTextContent('13');
  });
});
