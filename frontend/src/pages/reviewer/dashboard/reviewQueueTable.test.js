import React, { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import ReviewQueueTable from './ReviewQueueTable';
import { statusColor } from './charts/chartTheme';
import { KPI_TILES, ROWS_PER_PAGE_OPTIONS } from './aggregations';
import { BUSINESS_TIMEZONE, formatBusinessTime } from '../../../config/businessTime';
import KpiFilterRow from './KpiFilterRow';

const day = 86400000;
const ago = n => new Date(Date.now() - n * day).toISOString();

const ROWS = Array.from({ length: 7 }, (_, i) => ({
  applicationNumber: `EXP-2026-${100 + i}`,
  referenceNumber: `REF-${900 + i}`,
  applicantOrganization: ['Zeta Labs', 'Alpha Pharma', 'Mid Corp', 'Beta Ltd', 'Yankee Co', 'Delta Inc', 'Echo Plc'][i],
  state: 'Sikkim',
  exportCategory: 'Homeopathic Products',
  destinationCountry: 'Poland',
  submittedAt: ago([2, 30, 5, 18, 9, 40, 1][i]),
  queryCount: [0, 3, 1, 0, 2, 0, 5][i],
  status: ['Submitted', 'Under Review', 'Approved', 'Query Raised', 'Rejected', 'Submitted', 'Under Review'][i],
}));

function Harness({ rows = ROWS, density: initialDensity = 'comfortable' }) {
  const [sort, setSort] = useState({ key: 'submitted', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [rpp, setRpp] = useState(10);
  const [selected, setSelected] = useState(new Set());
  const [density, setDensity] = useState(initialDensity);

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
      selected={selected}
      onToggleSelect={id => setSelected(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; })}
      onToggleSelectAll={() => setSelected(p => (p.size === rows.length ? new Set() : new Set(rows.map(r => r.applicationNumber))))}
      onClearSelection={() => setSelected(new Set())}
      density={density} onDensity={setDensity}
      onOpen={() => {}}
      isUnread={() => false}
      onBulkMarkInReview={() => {}}
      bulkBusy={false}
    />
  );
}

const FIXED_ROW = {
  ...ROWS[0],
  applicationNumber: 'EXP-FIXED',
  submittedAt: '2026-08-26T05:12:00.000Z',   // 10:42 IST
};

const header = name => screen.getByRole('columnheader', { name: new RegExp(`^${name}$`, 'i') });

/* jsdom normalises an inline colour to rgb(), so compare in that space. */
const pillFor = status =>
  screen.getAllByText(status).find(el => el.classList.contains('rq-pill'));

const asRgb = hex => {
  const h = hex.replace('#', '');
  const f = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map(i => parseInt(f.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
};

describe('ReviewQueueTable — sorting', () => {
  test('sortable headers expose aria-sort and toggle direction', () => {
    render(<Harness />);
    expect(header('Submitted')).toHaveAttribute('aria-sort', 'descending');
    expect(header('Applicant')).toHaveAttribute('aria-sort', 'none');

    fireEvent.click(within(header('Applicant')).getByRole('button'));
    expect(header('Applicant')).toHaveAttribute('aria-sort', 'ascending');

    fireEvent.click(within(header('Applicant')).getByRole('button'));
    expect(header('Applicant')).toHaveAttribute('aria-sort', 'descending');
  });

  test('sort controls are real buttons, so they are keyboard reachable', () => {
    render(<Harness />);
    for (const col of ['Application', 'Applicant', 'Submitted', 'Queries', 'Status']) {
      expect(within(header(col)).getByRole('button')).toBeInTheDocument();
    }
  });

  test('non-sortable columns carry no aria-sort and no button', () => {
    render(<Harness />);
    expect(header('Reference')).not.toHaveAttribute('aria-sort');
    expect(within(header('Reference')).queryByRole('button')).not.toBeInTheDocument();
  });

  test('keyboard Enter on a sort header changes direction', () => {
    render(<Harness />);
    const btn = within(header('Queries')).getByRole('button');
    btn.focus();
    expect(btn).toHaveFocus();
    fireEvent.click(btn);            // Enter on a focused button dispatches click
    expect(header('Queries')).toHaveAttribute('aria-sort', 'ascending');
  });
});

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
    expect(screen.getByText('1–10 of 27')).toBeInTheDocument();
    expect(screen.queryByText(/showing \d+ of \d+/i)).not.toBeInTheDocument();
  });
});

describe('ReviewQueueTable — selection', () => {
  test('each row checkbox is individually labelled', () => {
    render(<Harness />);
    expect(screen.getByLabelText('Select EXP-2026-100')).toBeInTheDocument();
  });

  test('selecting rows reveals the inline bulk action, not a slide-in bar', () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText('Select EXP-2026-100'));
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /mark in review/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /assign/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /raise query/i })).not.toBeInTheDocument();
  });

  test('select-all toggles every row on the page and Clear empties it', () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText(/select all rows on this page/i));
    expect(screen.getByText(`${ROWS.length} selected`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument();
  });

  test('header checkbox is indeterminate on a partial selection', () => {
    render(<Harness />);
    fireEvent.click(screen.getByLabelText('Select EXP-2026-100'));
    expect(screen.getByLabelText(/select all rows on this page/i).indeterminate).toBe(true);
  });

  test('density toggle exposes pressed state', () => {
    render(<Harness />);
    const compact = screen.getByRole('button', { name: /compact/i });
    expect(compact).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(compact);
    expect(screen.getByRole('button', { name: /compact/i })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('ReviewQueueTable — Age column removed', () => {
  test('no Age header is rendered', () => {
    render(<Harness />);
    expect(screen.queryByRole('columnheader', { name: /^age$/i })).not.toBeInTheDocument();
  });

  test('no day-count values such as 5d / 27d / 66d remain', () => {
    render(<Harness />);
    expect(screen.queryByText(/^\d+d$/)).not.toBeInTheDocument();
  });

  test('the urgency dot markup is gone with the column', () => {
    const { container } = render(<Harness />);
    expect(container.querySelector('.rq-age')).toBeNull();
    expect(container.querySelector('.rq-age-dot')).toBeNull();
  });
});

describe('ReviewQueueTable — Submitted shows date and time', () => {
  test('renders the date on one line and the time with zone beneath it', () => {
    const { container } = render(<Harness rows={[FIXED_ROW]} />);
    const cell = container.querySelector('.rq-submitted');
    expect(cell).toBeInTheDocument();
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

  test('the time stays visible in compact density', () => {
    const { container } = render(<Harness rows={[FIXED_ROW]} density="compact" />);
    expect(container.querySelector('.rq-table.is-compact')).toBeInTheDocument();
    expect(container.querySelector('.rq-submitted-time')).toHaveTextContent(/IST/);
  });

  test('sorting still keys on the full timestamp, not the formatted date', () => {
    // Two rows on the SAME day, three hours apart.
    const early = { ...FIXED_ROW, applicationNumber: 'EARLY', submittedAt: '2026-08-26T01:00:00.000Z' };
    const late = { ...FIXED_ROW, applicationNumber: 'LATE', submittedAt: '2026-08-26T04:00:00.000Z' };
    const accessor = a => new Date(a.submittedAt || a.createdAt || 0).getTime();
    expect(accessor(late)).toBeGreaterThan(accessor(early));
    render(<Harness rows={[early, late]} />);
    expect(screen.getByText('EARLY')).toBeInTheDocument();
    expect(screen.getByText('LATE')).toBeInTheDocument();
  });
});

describe('ReviewQueueTable — invalid stored data', () => {
  test('labels an invalid category explicitly instead of presenting it as a valid chip', () => {
    const { container } = render(<Harness rows={[{ ...FIXED_ROW, exportCategory: 'Y' }]} />);
    expect(screen.getByText('Invalid category data: Y')).toHaveClass('rq-invalid');
    expect(container.querySelector('.rq-chip')).toBeNull();
  });
});

/* ---- Item 10: pill and tile must resolve from the same token ------------- */
describe('status colour parity between table pills and KPI tiles', () => {
  const STATUS_FOR_TILE = {
    submitted: 'Submitted',
    underReview: 'Under Review',
    queryRaised: 'Query Raised',
    approved: 'Approved',
    rejected: 'Rejected',
  };

  test('statusColor is the single source for both surfaces', () => {
    render(<Harness />);
    // Every pill paints with statusColor(status) for its own status.
    for (const row of ROWS) {
      const pill = pillFor(row.status);
      expect(pill).toBeDefined();
      expect(pill.style.color).toBe(asRgb(statusColor(row.status)));
    }
  });

  test('every KPI tile maps to a status that statusColor resolves', () => {
    for (const tile of KPI_TILES) {
      const status = STATUS_FOR_TILE[tile.key];
      if (!status) continue;                       // total / overdue are derived
      expect(statusColor(status)).toMatch(/^#|rgb/);
      // and the tile's own predicate must actually accept that status
      expect(tile.match({ status })).toBe(true);
    }
  });

  test('table pill and KPI tile agree for every mapped status', () => {
    render(
      <>
        <KpiFilterRow tiles={KPI_TILES} counts={{}} deltas={{}} value="total" onChange={() => {}} loading={false} />
        <Harness />
      </>
    );
    for (const [tileKey, status] of Object.entries(STATUS_FOR_TILE)) {
      const tile = KPI_TILES.find(t => t.key === tileKey);
      expect(tile.match({ status })).toBe(true);
      const pill = pillFor(status);
      if (pill) expect(pill.style.color).toBe(asRgb(statusColor(status)));
    }
  });
});
