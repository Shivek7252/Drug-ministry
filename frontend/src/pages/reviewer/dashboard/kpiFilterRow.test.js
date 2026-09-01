import fs from 'fs';
import path from 'path';
import React, { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import KpiFilterRow from './KpiFilterRow';
import { kpiCounts, KPI_TILES } from './aggregations';
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
   Week-to-date comparisons were removed from the KPI cards. A tile carries its
   icon, its label and its count — nothing else.
   ============================================================================ */
describe('KPI cards carry no week-to-date comparison', () => {
  const counts = { total: 13, submitted: 10, underReview: 1, queryRaised: 1, approved: 1, rejected: 0, overdue: 10 };
  const renderRow = (props = {}) => render(
    <KpiFilterRow
      tiles={KPI_TILES} counts={counts}
      value="total" onChange={() => {}} loading={false}
      unreadCount={12} readStateReady
      {...props}
    />,
  );

  test('no WTD text appears anywhere in the strip', () => {
    const { container } = renderRow();
    expect(container.textContent).not.toMatch(/WTD/i);
    expect(container.textContent).not.toMatch(/week to date/i);
    expect(container.textContent).not.toMatch(/last week/i);
    expect(screen.queryByText(/No WTD change/i)).not.toBeInTheDocument();
  });

  test('no comparison placeholder survives in place of a delta', () => {
    const { container } = renderRow();
    expect(screen.queryByText(/Not comparable/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Historical data unavailable/i)).not.toBeInTheDocument();
    expect(container.querySelector('.kpi-delta')).toBeNull();
    expect(container.querySelector('.kpi-figures')).toBeNull();
  });

  test('no percentage and no direction arrow is rendered on any tile', () => {
    const { container } = renderRow();
    expect(container.textContent).not.toMatch(/%/);
    for (const tile of container.querySelectorAll('.kpi-tile')) {
      // One icon per tile: the tile's own KPI icon, never an up/down arrow.
      expect(tile.querySelectorAll('svg')).toHaveLength(1);
    }
  });

  test('a tile renders exactly its icon, its label and its count', () => {
    const { container } = renderRow();
    const total = screen.getByRole('radio', { name: /Total/ });
    expect(total.querySelector('.kpi-label')).toHaveTextContent('Total');
    expect(total.querySelector('.kpi-value')).toHaveTextContent('13');
    expect(total.querySelector('.kpi-head svg')).toBeInTheDocument();
    expect(total.textContent.replace(/\s+/g, '').trim()).toBe('Total13');
  });

  test('passing a stray deltas prop cannot put a comparison back on screen', () => {
    const { container } = renderRow({
      deltas: { total: { available: true, current: 3, prior: 2, delta: 1, percent: 50 } },
    });
    expect(container.textContent).not.toMatch(/WTD|%/);
  });

  test('the component source no longer contains delta rendering', () => {
    const source = fs.readFileSync(path.join(__dirname, 'KpiFilterRow.jsx'), 'utf8');
    expect(source).not.toMatch(/WTD|kpi-delta|function Delta|deltas/);
  });

  test('the stylesheet no longer carries delta rules', () => {
    const css = fs.readFileSync(path.join(__dirname, 'dashboardChrome.css'), 'utf8');
    expect(css).not.toMatch(/\.kpi-delta/);
    expect(css).not.toMatch(/\.kpi-figures/);
  });

  test('the client-side delta helpers are gone from aggregations', () => {
    const source = fs.readFileSync(path.join(__dirname, 'aggregations.js'), 'utf8');
    expect(source).not.toMatch(/kpiDeltas|DELTA_BASIS/);
  });

  test('counts still render while loading is false, dashes while loading', () => {
    const { container } = renderRow({ loading: true });
    expect(container.querySelectorAll('.kpi-value')[0]).toHaveTextContent('—');
  });
});

/* ============================================================================
   Unread is server state, rendered verbatim.
   ============================================================================ */
describe('KpiFilterRow — unread by you', () => {
  const renderRow = props => render(
    <KpiFilterRow
      tiles={KPI_TILES} counts={kpiCounts(BAR_FILTERED)}
      value="total" onChange={() => {}} loading={false}
      {...props}
    />,
  );

  test('renders the server count verbatim', () => {
    renderRow({ unreadCount: 10, readStateReady: true });
    const note = screen.getByTitle(/not opened yet/i);
    expect(note).toHaveTextContent('10 unread by you');
  });

  test('zero renders as 0 unread by you, never as a hidden or blank note', () => {
    renderRow({ unreadCount: 0, readStateReady: true });
    expect(screen.getByTitle(/not opened yet/i)).toHaveTextContent('0 unread by you');
  });

  test('before the server answers it says so rather than guessing zero', () => {
    renderRow({ unreadCount: 0, readStateReady: false });
    const note = screen.getByTitle(/not opened yet/i);
    expect(note).toHaveTextContent(/Loading read state/i);
    expect(note).not.toHaveTextContent('0 unread by you');
  });

  test('the unread note sits outside the radiogroup — it is not a filter', () => {
    renderRow({ unreadCount: 4, readStateReady: true });
    const group = screen.getByRole('radiogroup');
    expect(group).not.toContainElement(screen.getByTitle(/not opened yet/i));
  });
});
