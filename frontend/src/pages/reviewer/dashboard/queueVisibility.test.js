/* ============================================================================
   Regression cover: "a submitted application does not appear in the Review
   Queue".

   The reported cause was NOT missing data. The application was in the database,
   in the reviewer API response, and in the DOM — it was painted underneath the
   sticky table header, which had been offset 57px down INTO the table.

   jsdom does not lay out or paint, so the paint bug itself cannot be asserted
   by rendering. What can be asserted, and is asserted here, is the CSS
   invariant that caused it, read from the stylesheet: while .rq-scroll is a
   scroll container, the sticky header's `top` is measured from .rq-scroll, so
   any non-zero `top` occludes the first data row.
   ============================================================================ */

import fs from 'fs';
import path from 'path';
import React, { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import ReviewQueueTable from './ReviewQueueTable';
import { buildNotifications } from '../../../hooks/useReviewerNotifications';
import { sortRows } from './aggregations';

const CSS = fs.readFileSync(path.join(__dirname, 'reviewQueueTable.css'), 'utf8');

/** Extract one declaration from the first rule whose selector matches. */
function decl(selector, prop) {
  const rule = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`);
  const body = CSS.match(rule);
  if (!body) return null;
  const hit = body[1].match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'm'));
  return hit ? hit[1].trim() : null;
}

describe('sticky header cannot cover the first row', () => {
  test('.rq-scroll is still a scroll container, so the scrollport is the table', () => {
    // If this ever stops being true the reasoning below has to be revisited.
    expect(decl('.rq-scroll', 'overflow-x')).toBe('auto');
    expect(decl('.rq-scroll', 'position')).toBe('relative');
  });

  test('the sticky header offset is exactly 0', () => {
    const top = decl('.rq-table thead th', 'top');
    expect(decl('.rq-table thead th', 'position')).toBe('sticky');
    expect(top).toBe('0');
  });

  test('the header offset does not reference the filter-bar height', () => {
    /* This is the exact regression: `top: var(--h-filterbar-actual)` resolved
       to 57px and pushed the header onto row 1, hiding the newest application.
       The filter bar's height is a viewport-space value and is meaningless in
       the table's own scrollport. */
    const top = decl('.rq-table thead th', 'top');
    expect(top).not.toMatch(/h-filterbar/);
    expect(top).not.toMatch(/var\(/);
  });
});

/* ---- The newest row actually reaches the rendered table ------------------- */

const rows = [
  { applicationNumber: 'EXP-2026-258744', referenceNumber: 'REF-733718', applicantOrganization: 'Newest Co',
    state: 'Sikkim', exportCategory: 'Homeopathic Products', destinationCountry: 'Poland',
    submittedAt: '2026-08-29T18:56:08.461Z', queryCount: 0, status: 'Submitted' },
  { applicationNumber: 'EXP-2026-504553', referenceNumber: 'REF-707936', applicantOrganization: 'Older Co',
    state: 'Telangana', exportCategory: 'Vaccines', destinationCountry: 'Iran, Islamic Republic of',
    submittedAt: '2026-08-25T21:54:24.911Z', queryCount: 1, status: 'Query Raised' },
  /* Same calendar day as the newest, three hours earlier: ordering must come
     from the full timestamp, not a truncated date. */
  { applicationNumber: 'EXP-2026-SAMEDAY', referenceNumber: 'REF-000001', applicantOrganization: 'Same Day Co',
    state: 'Kerala', exportCategory: 'Vaccines', destinationCountry: 'Japan',
    submittedAt: '2026-08-29T15:56:08.461Z', queryCount: 0, status: 'Submitted' },
];

function Harness({ data = rows }) {
  const [sort, setSort] = useState({ key: 'submitted', dir: 'desc' });
  return (
    <ReviewQueueTable
      rows={data} loading={false} error=""
      sort={sort} onSort={key => setSort({ key, dir: 'desc' })}
      page={1} pageCount={1} onPage={() => {}}
      rowsPerPage={10} onRowsPerPage={() => {}}
      totalRows={data.length}
      selected={new Set()} onToggleSelect={() => {}} onToggleSelectAll={() => {}}
      onClearSelection={() => {}}
      density="comfortable" onDensity={() => {}}
      onOpen={() => {}} isUnread={() => true}
      onBulkMarkInReview={() => {}} bulkBusy={false}
    />
  );
}

/* Read the dedicated application-number cell, not the whole row's text. */
const renderedOrder = () =>
  [...document.querySelectorAll('.rq-row .rq-appno')]
    .map(td => td.textContent.replace(/\s*NEW\s*$/, '').trim());

describe('the newest application reaches page 1', () => {
  test('it is rendered at all', () => {
    render(<Harness />);
    expect(screen.getByText('EXP-2026-258744')).toBeInTheDocument();
  });

  test('it is the first row when sorted by submitted descending', () => {
    /* Sort with the queue's real comparator, then render, so this covers the
       actual ordering path rather than the order the fixture happens to use. */
    const shuffled = [rows[1], rows[2], rows[0]];
    render(<Harness data={sortRows(shuffled, 'submitted', 'desc')} />);
    expect(renderedOrder()[0]).toBe('EXP-2026-258744');
  });

  test('same-day rows order by time, not by date alone', () => {
    const order = sortRows(rows, 'submitted', 'desc').map(r => r.applicationNumber);
    expect(order.indexOf('EXP-2026-258744')).toBeLessThan(order.indexOf('EXP-2026-SAMEDAY'));
  });

  test('sorting never drops or duplicates a row', () => {
    const sorted = sortRows(rows, 'submitted', 'desc');
    expect(sorted).toHaveLength(rows.length);
    expect(new Set(sorted.map(r => r.applicationNumber)).size).toBe(rows.length);
  });

  test('every row handed to the table is rendered — nothing is deduped away', () => {
    render(<Harness />);
    expect(document.querySelectorAll('.rq-row')).toHaveLength(rows.length);
  });

  test('the row carries its real submission date and time', () => {
    render(<Harness />);
    const row = screen.getByText('EXP-2026-258744').closest('tr');
    expect(within(row).getByText('30 Aug 2026')).toBeInTheDocument();
    expect(within(row).getByText('12:26 AM IST')).toBeInTheDocument();
  });
});

/* ---- Navbar / queue eligibility parity ----------------------------------- */

describe('navbar notifications agree with the queue', () => {
  const readSet = new Set();

  test('the mock NOTIFICATIONS source is gone', () => {
    const mock = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'data', 'mockData.js'), 'utf8');
    expect(mock).not.toMatch(/export const NOTIFICATIONS\s*=/);
  });

  test('the navbar does not import mock data', () => {
    const nav = fs.readFileSync(
      path.join(__dirname, '..', '..', '..', 'components', 'layout', 'Navbar.js'), 'utf8');
    expect(nav).not.toMatch(/from '\.\.\/\.\.\/data\/mockData'/);
    expect(nav).toMatch(/useReviewerNotifications/);
  });

  test('notifications are built from the same rows the queue shows', () => {
    const notes = buildNotifications(rows, readSet);
    expect(notes.map(n => n.applicationNumber)).toEqual(
      ['EXP-2026-258744', 'EXP-2026-SAMEDAY', 'EXP-2026-504553'],
    );
  });

  test('the newest submission is the first notification', () => {
    expect(buildNotifications(rows, readSet)[0].applicationNumber).toBe('EXP-2026-258744');
  });

  test('read receipts mark a notification read; nothing else does', () => {
    const notes = buildNotifications(rows, new Set(['EXP-2026-258744']));
    expect(notes.find(n => n.applicationNumber === 'EXP-2026-258744').read).toBe(true);
    expect(notes.find(n => n.applicationNumber === 'EXP-2026-504553').read).toBe(false);
  });

  test('a notification names a real application and a real submission time', () => {
    const note = buildNotifications(rows, readSet)[0];
    expect(note.msg).toContain('EXP-2026-258744');
    expect(note.time).toBe('30 Aug 2026, 12:26 AM IST');
  });

  test('status drives the notification kind', () => {
    const byNo = Object.fromEntries(buildNotifications(rows, readSet).map(n => [n.applicationNumber, n]));
    expect(byNo['EXP-2026-258744'].title).toBe('New Application Submitted');
    expect(byNo['EXP-2026-504553'].title).toBe('Query Raised');
    expect(byNo['EXP-2026-504553'].type).toBe('warning');
  });

  test('an empty queue produces no notifications — never a phantom', () => {
    expect(buildNotifications([], readSet)).toEqual([]);
  });

  test('a missing submittedAt is reported, not replaced with the current time', () => {
    const note = buildNotifications(
      [{ applicationNumber: 'EXP-NO-DATE', status: 'Submitted' }], readSet)[0];
    expect(note.time).toBe('Submission time unavailable');
  });
});
