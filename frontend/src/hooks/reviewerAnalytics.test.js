/* ============================================================================
   Reviewer analytics hook + KPI delta rendering.

   Covers the refresh contract the dashboard depends on: background polling
   that pauses while hidden, one request at a time, cancellation on unmount,
   stale-response rejection, and an error path that keeps the last good numbers
   on screen rather than blanking or inventing new ones.
   ============================================================================ */

import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

jest.mock('../api/applicationService', () => ({
  getReviewerAnalytics: jest.fn(),
}));

const { getReviewerAnalytics } = require('../api/applicationService');
const useReviewerAnalytics = require('./useReviewerAnalytics').default;
const { POLL_INTERVAL_MS } = require('./useReviewerAnalytics');
const { REFRESH_KEY } = require('../config/queueRefreshSignal');

const payload = (over = {}) => ({
  success: true,
  generatedAt: '2026-08-31T03:00:00.000Z',
  timezone: 'Asia/Kolkata',
  windows: {
    current: { from: '2026-08-30T18:30:00.000Z', to: '2026-08-31T03:00:00.000Z' },
    prior: { from: '2026-08-23T18:30:00.000Z', to: '2026-08-30T18:30:00.000Z' },
    weekStartsOn: 'Monday',
    currentWeekComplete: false,
  },
  current: { total: 13, submitted: 10, underReview: 1, queryRaised: 1, approved: 1, rejected: 0, overdue: 10 },
  comparison: {
    total: { available: true, current: 0, prior: 2, delta: -2, percent: -100, direction: 'down' },
  },
  unread: { count: 12, applicationNumbers: [] },
  ...over,
});

/* A component that surfaces the hook's state for assertions. */
function Probe({ filters = { country: 'All' }, pollMs }) {
  const a = useReviewerAnalytics(filters, pollMs ? { pollMs } : undefined);
  return (
    <div>
      <output data-testid="total">{a.serverCounts ? a.serverCounts.total : 'none'}</output>
      <output data-testid="unread">{a.unread ? a.unread.count : 'none'}</output>
      <output data-testid="loading">{String(a.loading)}</output>
      <output data-testid="stale">{String(a.stale)}</output>
      <output data-testid="error">{a.error || ''}</output>
    </div>
  );
}

let visibility = 'visible';

beforeEach(() => {
  jest.useFakeTimers();
  getReviewerAnalytics.mockReset();
  getReviewerAnalytics.mockResolvedValue(payload());
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', {
    configurable: true, get: () => visibility,
  });
});
afterEach(() => { jest.runOnlyPendingTimers(); jest.useRealTimers(); });

const flush = async () => { await act(async () => { await Promise.resolve(); }); };

describe('fetching', () => {
  test('loads once on mount and exposes the server numbers', async () => {
    render(<Probe />);
    await flush();
    expect(getReviewerAnalytics).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('total')).toHaveTextContent('13');
    expect(screen.getByTestId('unread')).toHaveTextContent('12');
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
  });

  test('the filters given to the hook are the filters sent to the server', async () => {
    render(<Probe filters={{ country: 'Japan', category: 'Vaccines' }} />);
    await flush();
    expect(getReviewerAnalytics).toHaveBeenCalledWith(
      { country: 'Japan', category: 'Vaccines' }, expect.anything(),
    );
  });

  test('a filter change refetches; an unchanged filter object does not', async () => {
    const { rerender } = render(<Probe filters={{ country: 'All' }} />);
    await flush();
    expect(getReviewerAnalytics).toHaveBeenCalledTimes(1);

    /* New object, same values: must NOT refetch. */
    rerender(<Probe filters={{ country: 'All' }} />);
    await flush();
    expect(getReviewerAnalytics).toHaveBeenCalledTimes(1);

    rerender(<Probe filters={{ country: 'Japan' }} />);
    await flush();
    expect(getReviewerAnalytics).toHaveBeenCalledTimes(2);
  });
});

describe('background polling', () => {
  test('refetches on the interval while the tab is visible', async () => {
    render(<Probe />);
    await flush();
    expect(getReviewerAnalytics).toHaveBeenCalledTimes(1);

    await act(async () => { jest.advanceTimersByTime(POLL_INTERVAL_MS); });
    await flush();
    expect(getReviewerAnalytics).toHaveBeenCalledTimes(2);
  });

  test('polling stops while the tab is hidden and resumes when it returns', async () => {
    render(<Probe />);
    await flush();
    const afterMount = getReviewerAnalytics.mock.calls.length;

    visibility = 'hidden';
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await act(async () => { jest.advanceTimersByTime(POLL_INTERVAL_MS * 3); });
    await flush();
    expect(getReviewerAnalytics).toHaveBeenCalledTimes(afterMount);

    visibility = 'visible';
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await flush();
    expect(getReviewerAnalytics.mock.calls.length).toBeGreaterThan(afterMount);
  });

  test('a remote change signalled from another tab triggers a refetch', async () => {
    render(<Probe />);
    await flush();
    const before = getReviewerAnalytics.mock.calls.length;
    await act(async () => {
      window.dispatchEvent(Object.assign(new Event('storage'), { key: REFRESH_KEY }));
    });
    await flush();
    expect(getReviewerAnalytics.mock.calls.length).toBe(before + 1);
  });

  test('an unrelated storage key does not trigger a refetch', async () => {
    render(<Probe />);
    await flush();
    const before = getReviewerAnalytics.mock.calls.length;
    await act(async () => {
      window.dispatchEvent(Object.assign(new Event('storage'), { key: 'something_else' }));
    });
    await flush();
    expect(getReviewerAnalytics.mock.calls.length).toBe(before);
  });

  test('window focus refetches', async () => {
    render(<Probe />);
    await flush();
    const before = getReviewerAnalytics.mock.calls.length;
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await flush();
    expect(getReviewerAnalytics.mock.calls.length).toBe(before + 1);
  });
});

describe('races and cancellation', () => {
  test('overlapping triggers do not produce duplicate in-flight requests', async () => {
    let release;
    getReviewerAnalytics.mockImplementation(() => new Promise(r => { release = r; }));
    render(<Probe />);
    await flush();
    expect(getReviewerAnalytics).toHaveBeenCalledTimes(1);

    /* Three more triggers while the first is still open. */
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('focus'));
      jest.advanceTimersByTime(POLL_INTERVAL_MS);
    });
    expect(getReviewerAnalytics).toHaveBeenCalledTimes(1);

    await act(async () => { release(payload()); });
    await flush();
    expect(screen.getByTestId('total')).toHaveTextContent('13');
  });

  test('the request is aborted on unmount', async () => {
    let captured = null;
    getReviewerAnalytics.mockImplementation((_f, opts) => {
      captured = opts.signal;
      return new Promise(() => {});   // never resolves
    });
    const { unmount } = render(<Probe />);
    await flush();
    expect(captured.aborted).toBe(false);
    unmount();
    expect(captured.aborted).toBe(true);
  });

  test('an aborted result is not reported as an error', async () => {
    getReviewerAnalytics.mockResolvedValue({ success: false, aborted: true, error: 'aborted' });
    render(<Probe />);
    await flush();
    expect(screen.getByTestId('error')).toHaveTextContent('');
    expect(screen.getByTestId('stale')).toHaveTextContent('false');
  });
});

describe('error and stale handling', () => {
  test('a failed refresh keeps the last good numbers and marks them stale', async () => {
    render(<Probe />);
    await flush();
    expect(screen.getByTestId('total')).toHaveTextContent('13');

    getReviewerAnalytics.mockResolvedValue({ success: false, error: 'HTTP 500' });
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await flush();

    /* Numbers must NOT blank out or reset to zero — that would read as real. */
    expect(screen.getByTestId('total')).toHaveTextContent('13');
    expect(screen.getByTestId('stale')).toHaveTextContent('true');
    expect(screen.getByTestId('error')).toHaveTextContent('HTTP 500');
  });

  test('recovery clears the stale flag', async () => {
    getReviewerAnalytics.mockResolvedValue({ success: false, error: 'boom' });
    render(<Probe />);
    await flush();
    expect(screen.getByTestId('stale')).toHaveTextContent('true');

    getReviewerAnalytics.mockResolvedValue(payload({ current: { total: 14 } }));
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await flush();
    await waitFor(() => expect(screen.getByTestId('stale')).toHaveTextContent('false'));
    expect(screen.getByTestId('total')).toHaveTextContent('14');
  });

  test('before the first response the counts are absent, not zero', async () => {
    getReviewerAnalytics.mockImplementation(() => new Promise(() => {}));
    render(<Probe />);
    expect(screen.getByTestId('total')).toHaveTextContent('none');
    expect(screen.getByTestId('loading')).toHaveTextContent('true');
  });
});
