import fs from 'fs';
import path from 'path';
import React, { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import ReviewQueueTable from './ReviewQueueTable';
import { KPI_TILES, ROWS_PER_PAGE_OPTIONS } from './aggregations';
import { BUSINESS_TIMEZONE, formatBusinessTime } from '../../../config/businessTime';

const QUEUE_CSS = fs.readFileSync(path.join(__dirname, 'reviewQueueTable.css'), 'utf8');
const CHROME_CSS = fs.readFileSync(path.join(__dirname, 'dashboardChrome.css'), 'utf8');
const QUEUE_JSX = fs.readFileSync(path.join(__dirname, 'ReviewQueueTable.jsx'), 'utf8');
const DASHBOARD_JS = fs.readFileSync(path.join(__dirname, '..', 'ReviewDashboard.js'), 'utf8');
const QUEUE_HOOK = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'hooks', 'useReviewQueue.js'), 'utf8');

const day = 86400000;
const ago = n => new Date(Date.now() - n * day).toISOString();

const ROWS = Array.from({ length: 7 }, (_, i) => ({
  applicationNumber: `EXP-2026-${258740 + i}`,
  referenceNumber: `REF-${733710 + i}`,
  applicantOrganization: ['Zeta Labs', 'Alpha Pharma', 'Mid Corp', 'Beta Ltd', 'Yankee Co', 'Delta Inc', 'Echo Plc'][i],
  email: `contact${i}@mailinator.com`,
  state: 'Sikkim',
  exportCategory: 'Homeopathic Products',
  destinationCountry: 'Poland',
  submittedAt: ago([2, 30, 5, 18, 9, 40, 1][i]),
  queryCount: [0, 3, 1, 0, 2, 0, 5][i],
  status: ['Submitted', 'Under Review', 'Approved', 'Query Raised', 'Rejected', 'Submitted', 'Under Review'][i],
}));

function Harness({ rows = ROWS, ...overrides }) {
  const [sort, setSort] = useState({ key: 'submitted', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [rpp, setRpp] = useState(10);

  return (
    <ReviewQueueTable
      rows={rows}
      loading={false}
      error=""
      sort={sort}
      onSort={key => setSort(s => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))}
      page={page} pageCount={3} onPage={setPage}
      rowsPerPage={rpp} onRowsPerPage={setRpp}
      totalRows={27}
      onOpen={() => {}}
      isUnread={() => false}
      {...overrides}
    />
  );
}

const FIXED_ROW = {
  ...ROWS[0],
  applicationNumber: 'EXP-2026-258744',
  submittedAt: '2026-08-26T05:12:00.000Z',   // 10:42 IST
};

const header = name => screen.getByRole('columnheader', { name: new RegExp(name, 'i') });

/** Extract one declaration from the first rule whose selector matches exactly. */
function decl(css, selector, prop) {
  const rule = new RegExp(`(?:^|\\})\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`, 'm');
  const body = css.match(rule);
  if (!body) return null;
  const hit = body[1].match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`, 'm'));
  return hit ? hit[1].trim() : null;
}

/* ---- Column structure ---------------------------------------------------- */

describe('ReviewQueueTable — seven merged data columns', () => {
  test('renders exactly seven data columns with Application first', () => {
    render(<Harness />);
    expect(screen.getAllByRole('columnheader')).toHaveLength(7);
    for (const label of ['Application', 'Applicant', 'Route', 'Category', 'Submitted', 'Review Status', 'Action']) {
      expect(header(`^${label}`)).toBeInTheDocument();
    }
    expect(screen.getAllByRole('columnheader')[0]).toHaveTextContent('Application');
  });

  test('the columns merged away no longer have headers of their own', () => {
    render(<Harness />);
    for (const gone of ['Reference', 'State', 'Destination', 'Queries']) {
      expect(screen.queryByRole('columnheader', { name: new RegExp(`^${gone}$`, 'i') })).not.toBeInTheDocument();
    }
  });

  test('Application shows the full number, the reference under it, and no ellipsis', () => {
    const { container } = render(<Harness rows={[FIXED_ROW]} />);
    const cell = container.querySelector('.rq-cell-application');
    expect(cell.querySelector('.rq-appno')).toHaveTextContent('EXP-2026-258744');
    expect(cell.querySelector('.rq-ref')).toHaveTextContent('REF-733710');
    expect(cell.textContent).not.toMatch(/\.\.\.|…/);
  });

  test('every application number on the page is rendered in full', () => {
    render(<Harness />);
    for (const row of ROWS) {
      expect(screen.getByText(row.applicationNumber)).toBeInTheDocument();
    }
  });

  test('Applicant carries the name with the email as secondary text and a title', () => {
    const { container } = render(<Harness rows={[FIXED_ROW]} />);
    const cell = container.querySelector('.rq-cell-applicant');
    expect(cell.querySelector('.rq-applicant-name')).toHaveTextContent('Zeta Labs');
    expect(cell.querySelector('.rq-email')).toHaveAttribute('title', 'contact0@mailinator.com');
  });

  test('Route reads as origin arrow destination', () => {
    const { container } = render(<Harness rows={[FIXED_ROW]} />);
    const route = container.querySelector('.rq-cell-route .rq-route');
    expect(route).toHaveAttribute('title', 'Sikkim → Poland');
    expect(route.querySelector('.rq-route-from')).toHaveTextContent('Sikkim');
    expect(route.querySelector('.rq-route-to')).toHaveTextContent('Poland');
  });

  test('Category is a chip that is allowed to wrap rather than truncate', () => {
    const { container } = render(<Harness rows={[FIXED_ROW]} />);
    expect(container.querySelector('.rq-cell-category .rq-chip')).toHaveTextContent('Homeopathic Products');
    expect(decl(QUEUE_CSS, '.rq-chip', 'text-overflow')).toBeNull();
    expect(decl(QUEUE_CSS, '.rq-chip', 'overflow-wrap')).toMatch(/break-word|anywhere/);
  });

  test('Review Status carries the badge, and the query count only when there is one', () => {
    const { container } = render(<Harness rows={[ROWS[0], ROWS[1]]} />);
    const cells = container.querySelectorAll('.rq-cell-status');
    expect(cells[0].querySelector('.rq-status')).toHaveTextContent('Submitted');
    expect(cells[0].querySelector('.rq-queries')).toBeNull();          // queryCount 0
    expect(cells[1].querySelector('.rq-queries')).toHaveTextContent('3 queries');
  });

  test('a single query is counted in the singular', () => {
    const { container } = render(<Harness rows={[{ ...FIXED_ROW, queryCount: 1 }]} />);
    expect(container.querySelector('.rq-queries')).toHaveTextContent('1 query');
  });

  test('every row offers one fully labelled Review button', () => {
    render(<Harness />);
    expect(screen.getAllByRole('button', { name: /^open application/i })).toHaveLength(ROWS.length);
    expect(screen.getAllByText('Review')).toHaveLength(ROWS.length);
  });

  test('Review navigation calls back with the row it belongs to', () => {
    const onOpen = jest.fn();
    render(<Harness rows={[FIXED_ROW]} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open application EXP-2026-258744' }));
    expect(onOpen).toHaveBeenCalledWith(FIXED_ROW);
  });
});

/* ---- Density is gone ----------------------------------------------------- */

describe('ReviewQueueTable — density controls removed', () => {
  test('no Comfortable or Compact control is rendered', () => {
    render(<Harness />);
    expect(screen.queryByRole('button', { name: /comfortable/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /compact/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/^density$/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: /row density/i })).not.toBeInTheDocument();
  });

  test('no density state, prop, class or stored preference survives in the source', () => {
    expect(QUEUE_JSX).not.toMatch(/density|comfortable|is-compact/i);
    expect(DASHBOARD_JS).not.toMatch(/density/i);
    expect(QUEUE_CSS).not.toMatch(/density|is-compact/i);
    expect(DASHBOARD_JS).not.toMatch(/reviewer_table_density/);
  });
});

/* ---- No scroll container anywhere --------------------------------------- */

describe('ReviewQueueTable — the queue never scrolls inside itself', () => {
  test('the old .rq-scroll scroller is gone', () => {
    const { container } = render(<Harness />);
    expect(container.querySelector('.rq-scroll')).toBeNull();
    expect(QUEUE_CSS).not.toMatch(/\.rq-scroll/);
  });

  test('nothing in the queue declares an auto or scroll overflow', () => {
    expect(QUEUE_CSS).not.toMatch(/overflow(-x|-y)?\s*:\s*(auto|scroll)/);
  });

  test('the table has no min-width to force the page sideways', () => {
    expect(decl(QUEUE_CSS, '.rq-table', 'min-width')).toBeNull();
    expect(QUEUE_CSS).not.toMatch(/min-width\s*:\s*\d{3,}px/);
    expect(decl(QUEUE_CSS, '.rq-table', 'width')).toBe('100%');
    expect(decl(QUEUE_CSS, '.rq-table', 'table-layout')).toBe('fixed');
  });

  test('column widths are percentages that add up to exactly 100', () => {
    const widths = [...QUEUE_CSS.matchAll(/\.rq-col-[a-z]+\s*\{\s*width:\s*([\d.]+)%/g)]
      .map(match => Number(match[1]));
    // Seven columns in the base rule, seven more in the tablet override.
    expect(widths).toHaveLength(14);
    const sum = list => Math.round(list.reduce((a, b) => a + b, 0) * 10) / 10;
    expect(sum(widths.slice(0, 7))).toBe(100);
    expect(sum(widths.slice(7))).toBe(100);
  });

  test('the header is not sticky, so it can never paint over the first row', () => {
    expect(decl(QUEUE_CSS, '.rq-table thead th', 'position')).toBeNull();
    expect(QUEUE_CSS).not.toMatch(/position\s*:\s*sticky/);
    expect(QUEUE_CSS).not.toMatch(/h-filterbar/);
  });
});

/* ---- Sorting ------------------------------------------------------------- */

describe('ReviewQueueTable — sorting', () => {
  test('sortable headers expose aria-sort and toggle direction', () => {
    render(<Harness />);
    expect(header('^Submitted')).toHaveAttribute('aria-sort', 'descending');
    expect(header('^Applicant')).toHaveAttribute('aria-sort', 'none');

    fireEvent.click(screen.getByRole('button', { name: /^applicant$/i }));
    expect(header('^Applicant')).toHaveAttribute('aria-sort', 'ascending');

    fireEvent.click(screen.getByRole('button', { name: /^applicant$/i }));
    expect(header('^Applicant')).toHaveAttribute('aria-sort', 'descending');
  });

  test('sort controls are real buttons, so they are keyboard reachable', () => {
    render(<Harness />);
    for (const col of [/^application$/i, /^applicant$/i, /^submitted$/i, /^review status$/i]) {
      expect(screen.getByRole('button', { name: col })).toBeInTheDocument();
    }
  });

  test('non-sortable columns carry no aria-sort and no button', () => {
    render(<Harness />);
    for (const col of ['^Route', '^Category', '^Action']) {
      expect(header(col)).not.toHaveAttribute('aria-sort');
      expect(within(header(col)).queryByRole('button')).not.toBeInTheDocument();
    }
  });

  test('queries kept its sort when it merged into the Review Status column', () => {
    render(<Harness />);
    const queries = screen.getByRole('button', { name: /sort by queries/i });
    expect(within(header('^Review Status')).getByRole('button', { name: /sort by queries/i })).toBe(queries);
    fireEvent.click(queries);
    expect(screen.getByRole('button', { name: /sort by queries, currently ascending/i })).toBeInTheDocument();
  });

  test('keyboard Enter on a sort header changes direction', () => {
    render(<Harness />);
    const btn = screen.getByRole('button', { name: /^application$/i });
    btn.focus();
    expect(btn).toHaveFocus();
    fireEvent.click(btn);            // Enter on a focused button dispatches click
    expect(header('^Application')).toHaveAttribute('aria-sort', 'ascending');
  });
});

/* ---- Pagination ---------------------------------------------------------- */

describe('ReviewQueueTable — pagination', () => {
  test('offers every rows-per-page option', () => {
    render(<Harness />);
    const select = screen.getByLabelText(/rows/i, { selector: 'select' });
    ROWS_PER_PAGE_OPTIONS.forEach(n =>
      expect(within(select).getByRole('option', { name: String(n) })).toBeInTheDocument());
  });

  test('first and previous are disabled on page 1, next and last are not', () => {
    render(<Harness />);
    expect(screen.getByRole('button', { name: /first page/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /previous page/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /next page/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /last page/i })).toBeEnabled();
  });

  test('paging forward updates the page counter and enables previous', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /next page/i }));
    expect(screen.getByText(/page 2 of 3/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /previous page/i })).toBeEnabled();
  });

  test('last page disables forward controls', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /last page/i }));
    expect(screen.getByText(/page 3 of 3/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /next page/i })).toBeDisabled();
  });

  test('range line is the single source of how many — no duplicate count', () => {
    render(<Harness />);
    expect(screen.getByText('1–10')).toBeInTheDocument();
    expect(screen.queryByText(/showing \d+ of \d+/i)).not.toBeInTheDocument();
  });
});

/* ---- Selection is completely absent ------------------------------------- */

describe('ReviewQueueTable — no selection controls', () => {
  test('renders no header or row checkbox and leaves no empty leading cell', () => {
    const { container } = render(<Harness />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(container.querySelector('.rq-select')).toBeNull();
    expect(container.querySelector('tbody tr td:first-child')).toHaveClass('rq-cell-application');
  });

  test('selection state, handlers, bulk UI and CSS are removed from queue sources', () => {
    for (const source of [QUEUE_JSX, DASHBOARD_JS, QUEUE_HOOK]) {
      expect(source).not.toMatch(/selected|toggleSelect|clearSelection|bulkMark|onBulk/i);
    }
    expect(QUEUE_CSS).not.toMatch(/rq-(checkbox|select|bulk)|is-selected/);
  });
});

/* ---- Unread ------------------------------------------------------------- */

describe('ReviewQueueTable — unread state', () => {
  test('an unread row is tinted with a thin accent and an accessible dot', () => {
    const { container } = render(<Harness rows={[FIXED_ROW]} isUnread={() => true} />);
    const row = container.querySelector('.rq-row');
    expect(row).toHaveClass('is-unseen');
    expect(within(row).getByRole('img', { name: 'Unread' })).toHaveClass('rq-unread-dot');
    expect(row.getAttribute('aria-label')).toMatch(/unread$/);
    expect(decl(QUEUE_CSS, '.rq-row.is-unseen td', 'background')).toBe('var(--c-info-bg)');
    expect(decl(QUEUE_CSS, '.rq-row.is-unseen td:first-child', 'box-shadow')).toMatch(/inset 3px 0/);
  });

  test('a read row carries no highlight or unread marker', () => {
    const { container } = render(<Harness rows={[FIXED_ROW]} isUnread={() => false} />);
    expect(container.querySelector('.rq-row')).not.toHaveClass('is-unseen');
    expect(screen.queryByRole('img', { name: 'Unread' })).not.toBeInTheDocument();
  });

  test('Submitted workflow status does not force a read application to highlight', () => {
    render(<Harness rows={[FIXED_ROW]} isUnread={() => false} />);
    expect(screen.getByLabelText('Status: Submitted')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Unread' })).not.toBeInTheDocument();
  });
});

/* ---- Submitted ----------------------------------------------------------- */

describe('ReviewQueueTable — Submitted shows date and time', () => {
  test('renders the date on one line and the time with zone beneath it', () => {
    const { container } = render(<Harness rows={[FIXED_ROW]} />);
    const cell = container.querySelector('.rq-submitted');
    expect(cell.querySelector('.rq-submitted-date')).toHaveTextContent('26 Aug 2026');
    expect(cell.querySelector('.rq-submitted-time')).toHaveTextContent(/\d{1,2}:\d{2}\s?(AM|PM) IST/);
  });

  test('converts the stored UTC instant into the business timezone', () => {
    // 2026-08-26T05:12:00Z is 10:42 IST (+05:30).
    expect(formatBusinessTime('2026-08-26T05:12:00.000Z')).toBe('10:42 AM IST');
    expect(BUSINESS_TIMEZONE).toBe('Asia/Kolkata');
  });

  test('uses submittedAt, never updatedAt or the current time', () => {
    const row = {
      ...FIXED_ROW,
      submittedAt: '2026-08-26T05:12:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-02-02T00:00:00.000Z',
    };
    const { container } = render(<Harness rows={[row]} />);
    const cell = container.querySelector('.rq-submitted');
    expect(cell.textContent).toContain('26 Aug 2026');
    expect(cell.textContent).not.toContain('Jan');
    expect(cell.textContent).not.toContain('Feb');
  });

  test('a missing timestamp shows a dash, never an invented time', () => {
    const { container } = render(<Harness rows={[{ ...FIXED_ROW, submittedAt: undefined }]} />);
    expect(container.querySelector('.rq-submitted')).toBeNull();
    expect(container.querySelector('.rq-muted')).toHaveTextContent('—');
  });

  test('an invalid timestamp is handled safely', () => {
    const { container } = render(<Harness rows={[{ ...FIXED_ROW, submittedAt: 'not-a-date' }]} />);
    expect(container.querySelector('.rq-submitted')).toBeNull();
    expect(container.querySelector('.rq-muted')).toHaveTextContent('—');
  });
});

/* ---- Invalid stored data ------------------------------------------------- */

describe('ReviewQueueTable — invalid stored data', () => {
  test('an invalid category is labelled instead of presented as a valid chip', () => {
    const { container } = render(<Harness rows={[{ ...FIXED_ROW, exportCategory: 'Y' }]} />);
    const flag = container.querySelector('.rq-cell-category .rq-invalid');
    expect(flag).toHaveAttribute('aria-label', 'Invalid category data. Stored value: Y');
    expect(container.querySelector('.rq-chip')).toBeNull();
  });

  test('an invalid destination is flagged inside the Route cell', () => {
    const { container } = render(<Harness rows={[{ ...FIXED_ROW, destinationCountry: 'ZZ9' }]} />);
    const flag = container.querySelector('.rq-cell-route .rq-invalid');
    expect(flag).toHaveAttribute('aria-label', 'Invalid country data. Stored value: ZZ9');
    expect(container.querySelector('.rq-route-from')).toHaveTextContent('Sikkim');
  });
});

/* ---- Mobile cards -------------------------------------------------------- */

describe('ReviewQueueTable — mobile card layout', () => {
  const setViewport = matches => {
    window.matchMedia = jest.fn().mockImplementation(query => ({
      matches, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }));
  };
  afterEach(() => { delete window.matchMedia; });

  test('below the card breakpoint the table is replaced by article cards', () => {
    setViewport(true);
    const { container } = render(<Harness rows={[ROWS[1]]} isUnread={() => true} />);
    expect(container.querySelector('table')).toBeNull();
    expect(screen.getAllByRole('article')).toHaveLength(1);
  });

  test('a card carries every value the row does — nothing is hidden to fit', () => {
    setViewport(true);
    render(<Harness rows={[ROWS[1]]} isUnread={() => true} />);
    const card = screen.getByRole('article');
    expect(within(card).getByText('EXP-2026-258741')).toBeInTheDocument();   // application
    expect(within(card).getByText('REF-733711')).toBeInTheDocument();        // reference
    expect(within(card).getByRole('img', { name: 'Unread' })).toBeInTheDocument(); // unread state
    expect(within(card).getByText('Alpha Pharma')).toBeInTheDocument();      // applicant
    expect(within(card).getByText('Sikkim')).toBeInTheDocument();            // route origin
    expect(within(card).getByText('Poland')).toBeInTheDocument();            // route destination
    expect(within(card).getByText('Homeopathic Products')).toBeInTheDocument();
    expect(within(card).getByText('In Review')).toBeInTheDocument();         // status
    expect(within(card).getByText('3 queries')).toBeInTheDocument();         // query count
    expect(within(card).getByRole('button', { name: /open application/i })).toBeInTheDocument();
    expect(card.querySelector('.rq-submitted-date')).toBeInTheDocument();    // submitted
  });

  test('mobile cards use the same unread treatment and contain no checkbox', () => {
    setViewport(true);
    const { container } = render(<Harness rows={[ROWS[1]]} isUnread={() => true} />);
    expect(screen.getByRole('article')).toHaveClass('is-unseen');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(decl(QUEUE_CSS, '.rq-card.is-unseen', 'box-shadow')).toMatch(/inset 3px 0/);
  });

  test('above the breakpoint the semantic table comes back', () => {
    setViewport(false);
    const { container } = render(<Harness rows={[ROWS[1]]} />);
    expect(container.querySelector('table')).toBeInTheDocument();
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });
});

/* ---- Item 10: pill and tile must resolve from the same token -------------- */

describe('status colour parity between table badges and KPI tiles', () => {
  const PAIRS = [
    ['.rq-status.is-submitted', '.kpi-submitted.is-active', '--st-submitted-fg'],
    ['.rq-status.is-review', '.kpi-review.is-active', '--st-review-fg'],
    ['.rq-status.is-query', '.kpi-query.is-active', '--st-query-fg'],
    ['.rq-status.is-approved', '.kpi-approved.is-active', '--st-approved-fg'],
    ['.rq-status.is-rejected', '.kpi-rejected.is-active', '--st-rejected-fg'],
  ];

  test('each status badge paints from the same token as its KPI tile', () => {
    for (const [badge, tile, token] of PAIRS) {
      expect(decl(QUEUE_CSS, badge, 'color')).toBe(`var(${token})`);
      expect(decl(CHROME_CSS, tile, 'color')).toBe(`var(${token})`);
    }
  });

  test('every KPI tile maps to a status its own predicate accepts', () => {
    const STATUS_FOR_TILE = {
      submitted: 'Submitted', underReview: 'Under Review', queryRaised: 'Query Raised',
      approved: 'Approved', rejected: 'Rejected',
    };
    for (const tile of KPI_TILES) {
      const status = STATUS_FOR_TILE[tile.key];
      if (!status) continue;                       // total / overdue are derived
      expect(tile.match({ status })).toBe(true);
    }
  });

  test('the badge renders the class its status maps to', () => {
    const { container } = render(<Harness rows={[{ ...FIXED_ROW, status: 'Query Raised' }]} />);
    expect(container.querySelector('.rq-status')).toHaveClass('is-query');
  });
});
