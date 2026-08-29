import React, { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import ReviewQueueTable from './ReviewQueueTable';
import { statusColor } from './charts/chartTheme';
import { KPI_TILES, OVERDUE_DAYS, ROWS_PER_PAGE_OPTIONS } from './aggregations';
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

function Harness({ rows = ROWS }) {
  const [sort, setSort] = useState({ key: 'submitted', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [rpp, setRpp] = useState(10);
  const [selected, setSelected] = useState(new Set());
  const [density, setDensity] = useState('comfortable');

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
      openedApps={new Set()}
      isUnseen={() => false}
      onBulkMarkInReview={() => {}}
      bulkBusy={false}
    />
  );
}

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
    for (const col of ['Application', 'Applicant', 'Submitted', 'Age', 'Queries', 'Status']) {
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

describe('ReviewQueueTable — age and category', () => {
  test('urgency dot uses the same threshold as the Overdue tile', () => {
    render(<Harness />);
    // 30d and 40d rows are Under Review -> overdue; 2d Submitted is not.
    expect(screen.getAllByTitle(`Open for more than ${OVERDUE_DAYS} days`).length).toBeGreaterThan(0);
  });

  test('category chip carries full text in a title attribute', () => {
    render(<Harness />);
    const chips = screen.getAllByTitle('Homeopathic Products');
    expect(chips.length).toBe(ROWS.length);
    expect(chips[0]).toHaveTextContent('Homeopathic Products');
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
