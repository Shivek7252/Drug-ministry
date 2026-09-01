/* ============================================================================
   Regression cover: "a submitted application does not appear in the Review
   Queue".

   The reported cause was NOT missing data. The application was in the database,
   in the reviewer API response, and in the DOM — it was painted underneath the
   sticky table header, which had been offset 57px down INTO the table.

   jsdom does not lay out or paint, so the paint bug itself cannot be asserted
   by rendering. What can be asserted, and is asserted here, is the CSS
   invariant that made it possible, read from the stylesheet. The queue has
   since been rebuilt with no scroll container and no sticky header at all,
   which removes the whole class of bug — so these tests now hold that stronger
   invariant: nothing in the queue can occlude a row, and nothing in it can
   push the page sideways.
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

const escape = selector => selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Extract one declaration from the first rule whose selector matches. */
function decl(selector, prop) {
  const body = CSS.match(new RegExp(`(?:^|})\\s*${escape(selector)}\\s*\\{([^}]*)\\}`, 'm'));
  if (!body) return null;
  const hit = body[1].match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'm'));
  return hit ? hit[1].trim() : null;
}

describe('nothing in the queue can cover the first row', () => {
  test('the table header is not sticky, so it has no offset to get wrong', () => {
    expect(decl('.rq-table thead th', 'position')).toBeNull();
    expect(CSS).not.toMatch(/position\s*:\s*sticky/);
  });

  test('the header offset never references the filter-bar height again', () => {
    /* This was the exact regression: `top: var(--h-filterbar-actual)` resolved
       to 57px and pushed the header onto row 1, hiding the newest application.
       The filter bar's height is a viewport-space value and was meaningless in
       the table's own scrollport. */
    expect(CSS).not.toMatch(/h-filterbar/);
    expect(decl('.rq-table thead th', 'top')).toBeNull();
  });

  test('the queue is no longer a scroll container, so the page owns scrolling', () => {
    expect(CSS).not.toMatch(/\.rq-scroll/);
    expect(CSS).not.toMatch(/overflow(-x|-y)?\s*:\s*(auto|scroll)/);
  });

  test('the table cannot be wider than the page it sits on', () => {
    expect(decl('.rq-table', 'width')).toBe('100%');
    expect(decl('.rq-table', 'table-layout')).toBe('fixed');
    expect(decl('.rq-table', 'min-width')).toBeNull();
    expect(CSS).not.toMatch(/min-width\s*:\s*\d{3,}px/);
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
      onOpen={() => {}} isUnread={() => true}
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
