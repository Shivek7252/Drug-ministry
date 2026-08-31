import {
  kpiCounts, kpiDeltas, isOverdue, unknownStatusApps, tileForStatus, KPI_TILES,
} from './aggregations';
import { normalizeStatus, STATUS, SLA_DAYS, isTerminal, isNonTerminal } from './statusModel';

const D = 86400000;
const NOW = Date.parse('2026-08-31T12:00:00Z');
const at = daysAgo => new Date(NOW - daysAgo * D).toISOString();

const app = (o) => ({ applicationNumber: o.n, status: o.s, submittedAt: at(o.sub), ...o });

/* Mirrors the shape the reviewer list endpoint returns. */
const FIXTURE = [
  app({ n: 'A1', s: 'Submitted', sub: 1 }),
  app({ n: 'A2', s: 'Submitted', sub: 40 }),                       // overdue
  app({ n: 'A3', s: 'Under Review', sub: 30 }),                    // overdue
  app({ n: 'A4', s: 'Document Verification', sub: 3 }),            // normalises to IN_REVIEW
  app({ n: 'A5', s: 'Compliance Check', sub: 25 }),                // IN_REVIEW + overdue
  app({ n: 'A6', s: 'Query Raised', sub: 20, lastQueryRaisedAt: at(2) }),  // non-terminal, overdue
  app({ n: 'A7', s: 'Approved', sub: 60, approvedAt: at(3) }),
  app({ n: 'A8', s: 'Partially Approved', sub: 50, approvedAt: at(10) }),
  app({ n: 'A9', s: 'Rejected', sub: 45, rejectedAt: at(4), approvedAt: at(30) }), // stale approvedAt
  app({ n: 'A10', s: 'Teleported', sub: 5 }),                      // malformed
];

describe('status normalisation is canonical', () => {
  test('maps every persisted enum value', () => {
    expect(normalizeStatus('Submitted')).toBe(STATUS.SUBMITTED);
    expect(normalizeStatus('Under Review')).toBe(STATUS.IN_REVIEW);
    expect(normalizeStatus('Document Verification')).toBe(STATUS.IN_REVIEW);
    expect(normalizeStatus('Compliance Check')).toBe(STATUS.IN_REVIEW);
    expect(normalizeStatus('Query Raised')).toBe(STATUS.QUERY_RAISED);
    expect(normalizeStatus('Approved')).toBe(STATUS.APPROVED);
    expect(normalizeStatus('Partially Approved')).toBe(STATUS.PARTIALLY_APPROVED);
    expect(normalizeStatus('Rejected')).toBe(STATUS.REJECTED);
  });

  test('tolerates case, spacing and separators', () => {
    expect(normalizeStatus('  under_review ')).toBe(STATUS.IN_REVIEW);
    expect(normalizeStatus('QUERY-RAISED')).toBe(STATUS.QUERY_RAISED);
  });

  test('unknown and empty statuses are explicit, not silently dropped', () => {
    expect(normalizeStatus('Teleported')).toBe(STATUS.UNKNOWN);
    expect(normalizeStatus(undefined)).toBe(STATUS.UNKNOWN);
    expect(unknownStatusApps(FIXTURE).map(a => a.applicationNumber)).toEqual(['A10']);
  });
});

describe('KPI counts', () => {
  const c = kpiCounts(FIXTURE);

  test('Total counts every application in the filtered set', () => {
    expect(c.total).toBe(FIXTURE.length);
  });

  test('Submitted is a workflow status, not read state', () => {
    expect(c.submitted).toBe(2);            // A1, A2
  });

  test('In Review absorbs the mid-review stages', () => {
    expect(c.underReview).toBe(3);          // A3, A4, A5
  });

  test('Query counts only unresolved query holds', () => {
    expect(c.queryRaised).toBe(1);          // A6
  });

  test('Approved folds Partially Approved', () => {
    expect(c.approved).toBe(2);             // A7, A8
  });

  test('Rejected counts only rejected', () => {
    expect(c.rejected).toBe(1);             // A9
  });

  test('counts are unique per application — no double counting', () => {
    const perTile = KPI_TILES.filter(t => t.key !== 'total' && t.key !== 'overdue')
      .map(t => FIXTURE.filter(t.match).map(a => a.applicationNumber));
    const flat = perTile.flat();
    expect(new Set(flat).size).toBe(flat.length);
  });

  test('an unknown status is counted in Total but in no status tile', () => {
    const inAny = KPI_TILES.filter(t => t.key !== 'total')
      .some(t => t.match(FIXTURE.find(a => a.applicationNumber === 'A10')));
    expect(inAny).toBe(false);
    expect(c.total).toBe(10);
  });
});

describe('Overdue excludes completed work', () => {
  test('terminal statuses are never overdue however old', () => {
    for (const n of ['A7', 'A8', 'A9']) {
      const a = FIXTURE.find(x => x.applicationNumber === n);
      expect(isTerminal(a)).toBe(true);
      expect(isOverdue(a)).toBe(false);
    }
  });

  test('non-terminal past the SLA is overdue, including a query hold', () => {
    expect(isOverdue(FIXTURE.find(a => a.applicationNumber === 'A2'))).toBe(true);
    const held = FIXTURE.find(a => a.applicationNumber === 'A6');
    expect(isNonTerminal(held)).toBe(true);
    expect(isOverdue(held)).toBe(true);
  });

  test('non-terminal within the SLA is not overdue', () => {
    expect(isOverdue(FIXTURE.find(a => a.applicationNumber === 'A1'))).toBe(false);
    expect(isOverdue(FIXTURE.find(a => a.applicationNumber === 'A4'))).toBe(false);
  });

  test('the SLA boundary is exclusive', () => {
    expect(isOverdue({ status: 'Submitted', submittedAt: at(SLA_DAYS) }, NOW)).toBe(false);
    expect(isOverdue({ status: 'Submitted', submittedAt: at(SLA_DAYS + 1) }, NOW)).toBe(true);
  });

  test('an unknown status is not assumed overdue', () => {
    expect(isOverdue(FIXTURE.find(a => a.applicationNumber === 'A10'))).toBe(false);
  });
});

describe('week-over-week deltas use each metric own timestamp', () => {
  const d = kpiDeltas(FIXTURE, { days: 7, now: NOW });

  test('approvals are measured on approvedAt, not submittedAt', () => {
    expect(d.approved.basis).toBe('approvedAt');
    expect(d.approved.current).toBe(1);     // A7 approved 3d ago
    expect(d.approved.prior).toBe(1);       // A8 approved 10d ago
    expect(d.approved.delta).toBe(0);
  });

  test('rejections are measured on rejectedAt and ignore a stale approvedAt', () => {
    expect(d.rejected.basis).toBe('rejectedAt');
    expect(d.rejected.current).toBe(1);     // A9 rejected 4d ago
    expect(d.rejected.delta).toBe(1);
  });

  test('queries are measured on the query-raised timestamp', () => {
    expect(d.queryRaised.basis).toBe('lastQueryRaisedAt');
    expect(d.queryRaised.current).toBe(1);  // A6 raised 2d ago
  });

  test('submissions are measured on submittedAt', () => {
    expect(d.submitted.basis).toBe('submittedAt');
    expect(d.total.basis).toBe('submittedAt');
  });

  test('In Review reports unavailable rather than guessing from updatedAt', () => {
    expect(d.underReview.available).toBe(false);
    expect(d.underReview.reason).toMatch(/status-history/i);
  });

  test('Overdue reports unavailable — it is a point-in-time measure', () => {
    expect(d.overdue.available).toBe(false);
  });

  test('an approval outside both windows contributes to neither', () => {
    const old = [app({ n: 'Z', s: 'Approved', sub: 90, approvedAt: at(60) })];
    const dd = kpiDeltas(old, { days: 7, now: NOW });
    expect(dd.approved.current).toBe(0);
    expect(dd.approved.prior).toBe(0);
    expect(dd.approved.delta).toBe(0);
  });

  test('week windows are half-open [from, to): the boundary belongs to current', () => {
    const edge = [
      app({ n: 'E1', s: 'Approved', sub: 20, approvedAt: new Date(NOW - 7 * D).toISOString() }),
      app({ n: 'E2', s: 'Approved', sub: 20, approvedAt: new Date(NOW - 7 * D - 1000).toISOString() }),
    ];
    const dd = kpiDeltas(edge, { days: 7, now: NOW });
    expect(dd.approved.current).toBe(1);    // E1 sits exactly on now-7d
    expect(dd.approved.prior).toBe(1);      // E2 is one second earlier
  });
});

describe('tile filtering does not recalculate other tiles', () => {
  test('counts read the unfiltered set, so selecting one tile zeroes none', () => {
    const before = kpiCounts(FIXTURE);
    const queryTile = KPI_TILES.find(t => t.key === 'queryRaised');
    const narrowed = FIXTURE.filter(queryTile.match);
    expect(narrowed).toHaveLength(1);
    expect(kpiCounts(FIXTURE)).toEqual(before);   // unchanged by the narrowing
  });

  test('a donut segment maps to the tile whose predicate covers it', () => {
    expect(tileForStatus('Compliance Check')).toBe('underReview');
    expect(tileForStatus('Partially Approved')).toBe('approved');
    expect(tileForStatus('Teleported')).toBe('total');
  });
});
