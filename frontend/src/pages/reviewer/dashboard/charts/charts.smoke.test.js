import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import PipelineFunnel from './PipelineFunnel';
import ProcessingTime from './ProcessingTime';
import CategoryMix from './CategoryMix';
import { AnalyticsContext } from './ChartCard';

/* recharts measures its container; jsdom reports 0x0. Give ResponsiveContainer
   a fixed size so children mount. */
jest.mock('recharts', () => {
  const actual = jest.requireActual('recharts');
  const R = jest.requireActual('react');   // jest.mock is hoisted above imports
  return {
    ...actual,
    ResponsiveContainer: ({ children, height = 240 }) =>
      R.createElement(
        'div',
        { style: { width: 800, height } },
        R.cloneElement(children, { width: 800, height })
      ),
  };
});

const day = 86400000;
const ago = n => new Date(Date.now() - n * day).toISOString();

const APPS = [
  { status: 'Submitted', submittedAt: ago(2), exportCategory: 'Vaccines' },
  { status: 'Submitted', submittedAt: ago(20), exportCategory: 'Vaccines' },
  { status: 'Under Review', submittedAt: ago(5), exportCategory: 'Vaccines' },
  { status: 'Document Verification', submittedAt: ago(9), exportCategory: 'Medical Devices' },
  { status: 'Compliance Check', submittedAt: ago(12), exportCategory: 'Medical Devices' },
  { status: 'Query Raised', submittedAt: ago(18), exportCategory: 'Homeopathic Products' },
  { status: 'Approved', submittedAt: ago(30), approvedAt: ago(25), exportCategory: 'Vaccines' },
  { status: 'Rejected', submittedAt: ago(16), rejectedAt: ago(10), exportCategory: 'Vaccines' },
];

const withCtx = (ui, truncated = false) => render(
  <AnalyticsContext.Provider value={{ truncated }}>{ui}</AnalyticsContext.Provider>
);

describe('PipelineFunnel', () => {
  test('renders the query-hold footnote reconciling the cumulative counts', () => {
    withCtx(<PipelineFunnel apps={APPS} loading={false} />);
    // Requirement, not literal copy: the count and the reconciliation rule must
    // both appear. The share in between is allowed to change.
    expect(
      screen.getByText(/Includes 1 application.*currently held at query, counted at the stages they have cleared/i)
    ).toBeInTheDocument();
  });

  test('states the cumulative definition in the subtitle', () => {
    withCtx(<PipelineFunnel apps={APPS} loading={false} />);
    // Guards the requirement (the cumulative rule is stated), not the exact
    // wording, so copy edits do not break it while omission still does.
    expect(
      screen.getByText(/cumulative.*each stage counts applications that reached it or moved past it/i)
    ).toBeInTheDocument();
  });

  test('never renders Query Raised as a funnel stage', () => {
    withCtx(<PipelineFunnel apps={APPS} loading={false} />);
    fireEvent.click(screen.getByRole('button', { name: /view as table/i }));
    const table = screen.getByRole('table');
    expect(within(table).queryByText('Query Raised')).not.toBeInTheDocument();
    expect(within(table).getByText('Decided')).toBeInTheDocument();
  });

  test('table alternative carries the same reconciliation rule as the chart', () => {
    withCtx(<PipelineFunnel apps={APPS} loading={false} />);
    fireEvent.click(screen.getByRole('button', { name: /view as table/i }));
    expect(
      screen.getByText(/Query Raised is not itself a pipeline stage/i)
    ).toBeInTheDocument();
  });

  test('footnote is withheld when nothing is held at query', () => {
    withCtx(<PipelineFunnel apps={APPS.filter(a => a.status !== 'Query Raised')} loading={false} />);
    expect(screen.queryByText(/currently held at query/i)).not.toBeInTheDocument();
  });
});

describe('truncation lockout', () => {
  test('View as table is disabled for every chart while truncated', () => {
    withCtx(<CategoryMix apps={APPS} loading={false} />, true);
    const toggle = screen.getByRole('button', { name: /view as table/i });
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute('title', expect.stringMatching(/truncated/i));
  });

  test('View as table is enabled when figures are complete', () => {
    withCtx(<CategoryMix apps={APPS} loading={false} />, false);
    expect(screen.getByRole('button', { name: /view as table/i })).toBeEnabled();
  });
});

describe('ChartCard states', () => {
  test('skeleton announces loading and suppresses the footnote', () => {
    withCtx(<PipelineFunnel apps={APPS} loading />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText(/currently held at query/i)).not.toBeInTheDocument();
  });

  test('empty state shows when no applications match', () => {
    withCtx(<CategoryMix apps={[]} loading={false} />);
    expect(screen.getByText(/No applications match the current filters\./i)).toBeInTheDocument();
  });
});

describe('ProcessingTime', () => {
  test('reports median turnaround in the footnote', () => {
    withCtx(<ProcessingTime apps={APPS} loading={false} />);
    expect(screen.getByText(/Median turnaround \d+ days? across \d+ applications?\./i)).toBeInTheDocument();
  });
});
