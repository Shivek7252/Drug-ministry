/* ============================================================================
   Unread — the frontend half of the flow.

   The count itself is the server's answer (covered end to end by
   backend/tests/unreadCount.test.js). What this file holds is the client
   contract around it:

     - read state comes from the server payload, never from localStorage;
     - the hook exposes no unread number of its own to decrement;
     - marking read is optimistic but ALWAYS reconciled — rolled back when the
       receipt did not persist;
     - a successful receipt signals the queue changed, in this tab as well as
       in others, which is what makes the count refetch.

   react-router-dom v7's export map cannot be resolved by the CRA jest
   resolver, so it is virtual-mocked here. The hook under test is the real one.
   ============================================================================ */

import React from 'react';
import { render, screen, act, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

let mockSearchParams = new URLSearchParams();
jest.mock('react-router-dom', () => ({
  useSearchParams: () => [mockSearchParams, jest.fn()],
}), { virtual: true });

jest.mock('../api/applicationService', () => ({
  listReviewerApplications: jest.fn(),
  getReviewerFilterOptions: jest.fn(),
  markApplicationRead: jest.fn(),
}));

const {
  listReviewerApplications, getReviewerFilterOptions, markApplicationRead,
} = require('../api/applicationService');
const useReviewQueue = require('./useReviewQueue').default;
const { isUnread } = require('./useReviewQueue');
const { REFRESH_KEY, signalQueueChanged, subscribeQueueChanged } = require('../config/queueRefreshSignal');

const row = (n, isRead = false) => ({
  applicationNumber: `EXP-2026-${n}`,
  referenceNumber: `REF-${n}`,
  applicantOrganization: `Org ${n}`,
  state: 'Sikkim',
  exportCategory: 'Vaccines',
  destinationCountry: 'Poland',
  submittedAt: '2026-08-26T05:12:00.000Z',
  queryCount: 0,
  status: 'Submitted',
  isRead,
});

/* A stand-in for the server's own read receipts. The queue payload is derived
   from it, exactly as the real endpoint derives isRead from ApplicationRead —
   so a refetch after marking read reflects the receipt instead of contradicting
   it, and idempotency is observable rather than assumed. */
let serverRead = new Set();
let serverRows = [];

const queuePayload = () => ({
  success: true,
  applications: serverRows.map(app => ({ ...app, isRead: serverRead.has(app.applicationNumber) })),
  total: serverRows.length,
  totalPages: 1,
});

/** Unread as the server would report it: the whole set, minus receipts held. */
const serverUnreadCount = () =>
  serverRows.filter(app => !serverRead.has(app.applicationNumber)).length;

/* A probe that renders the hook's read state so assertions read like the UI. */
let hook = null;
let pollMs;
function Probe() {
  hook = useReviewQueue(pollMs ? { pollMs } : undefined);
  return (
    <ul>
      {hook.pageRows.map(app => (
        <li key={app.applicationNumber} data-testid={app.applicationNumber}>
          {app.applicationNumber}
          {isUnread(app, hook.readSet) ? ' UNREAD' : ' READ'}
        </li>
      ))}
    </ul>
  );
}

const stateOf = appNo => screen.getByTestId(appNo).textContent;

beforeEach(() => {
  jest.clearAllMocks();
  mockSearchParams = new URLSearchParams();
  hook = null;
  pollMs = undefined;
  localStorage.clear();
  serverRows = [row(1), row(2), row(3)];
  serverRead = new Set(['EXP-2026-2']);   // row 2 was opened in an earlier session
  getReviewerFilterOptions.mockResolvedValue({ success: true, countries: [], categories: [], states: [] });
  listReviewerApplications.mockImplementation(async () => queuePayload());
  markApplicationRead.mockImplementation(async appNo => {
    const alreadyRead = serverRead.has(appNo);
    serverRead.add(appNo);            // upsert: writing twice is writing once
    return { success: true, applicationNumber: appNo, alreadyRead };
  });
});

async function mount() {
  render(<Probe />);
  await waitFor(() => expect(hook.readStateReady).toBe(true));
}

/* ---- Read state is server state ------------------------------------------ */

describe('read state comes from the server, not the browser', () => {
  test('the initial unread badges follow isRead in the payload', async () => {
    await mount();
    expect(stateOf('EXP-2026-1')).toContain('UNREAD');
    expect(stateOf('EXP-2026-2')).toContain('READ');
    expect(stateOf('EXP-2026-3')).toContain('UNREAD');
  });

  test('workflow status never substitutes for the reviewer read receipt', async () => {
    serverRows = [row(1, false), row(2, true)];
    serverRead = new Set(['EXP-2026-2']);
    await mount();
    expect(serverRows.every(app => app.status === 'Submitted')).toBe(true);
    expect(stateOf('EXP-2026-1')).toContain('UNREAD');
    expect(stateOf('EXP-2026-2')).toContain('READ');
  });

  test('a stale localStorage read list cannot mark anything read', async () => {
    localStorage.setItem('reviewer_opened_apps', JSON.stringify(['EXP-2026-1', 'EXP-2026-3']));
    await mount();
    expect(stateOf('EXP-2026-1')).toContain('UNREAD');
    expect(stateOf('EXP-2026-3')).toContain('UNREAD');
  });

  test('the queue hook exposes no unread number of its own to decrement', async () => {
    await mount();
    expect(hook.unreadCount).toBeUndefined();
    expect(hook.unread).toBeUndefined();
  });

  test('a refetch re-derives read state from the new payload', async () => {
    await mount();
    expect(stateOf('EXP-2026-1')).toContain('UNREAD');

    serverRead.add('EXP-2026-1');     // another device opened it
    await act(async () => { await hook.reload({ background: true }); });
    expect(stateOf('EXP-2026-1')).toContain('READ');
  });

  test('a row the server calls unread stays unread even after a stale local hint', async () => {
    await mount();
    /* isUnread trusts an explicit server false over any local set. */
    expect(isUnread({ applicationNumber: 'X', isRead: false }, new Set(['X']))).toBe(true);
    expect(isUnread({ applicationNumber: 'X', isRead: true }, new Set())).toBe(false);
  });
});

/* ---- Marking read -------------------------------------------------------- */

describe('markOpened persists before it is believed', () => {
  test('the badge clears immediately and the receipt is posted', async () => {
    await mount();
    await act(async () => { await hook.markOpened('EXP-2026-1'); });
    expect(markApplicationRead).toHaveBeenCalledWith('EXP-2026-1');
    expect(stateOf('EXP-2026-1')).toContain('READ');
  });

  test('opening one application reduces the server unread count by exactly one', async () => {
    await mount();
    const before = serverUnreadCount();
    await act(async () => { await hook.markOpened('EXP-2026-1'); });
    expect(serverUnreadCount()).toBe(before - 1);
  });

  test('opening the same application twice does not reduce it twice', async () => {
    await mount();
    const before = serverUnreadCount();
    await act(async () => { await hook.markOpened('EXP-2026-1'); });
    const once = serverUnreadCount();
    const second = await act(async () => hook.markOpened('EXP-2026-1'));

    expect(once).toBe(before - 1);
    expect(serverUnreadCount()).toBe(once);
    expect(second.alreadyRead).toBe(true);
    expect(stateOf('EXP-2026-1')).toContain('READ');
  });

  test('opening every application produces zero unread', async () => {
    await mount();
    for (const n of [1, 2, 3]) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => { await hook.markOpened(`EXP-2026-${n}`); });
    }
    expect(serverUnreadCount()).toBe(0);
    for (const n of [1, 2, 3]) expect(stateOf(`EXP-2026-${n}`)).toContain('READ');
  });

  test('a successful receipt signals the queue changed so the count refetches', async () => {
    await mount();
    const seen = jest.fn();
    const unsubscribe = subscribeQueueChanged(seen);
    await act(async () => { await hook.markOpened('EXP-2026-1'); });
    expect(seen).toHaveBeenCalled();
    unsubscribe();
  });

  test('a failed receipt is rolled back — the row goes back to unread', async () => {
    await mount();
    markApplicationRead.mockResolvedValue({ success: false, error: 'HTTP 500' });
    await act(async () => { await hook.markOpened('EXP-2026-1'); });
    expect(stateOf('EXP-2026-1')).toContain('UNREAD');
    expect(serverUnreadCount()).toBe(2);   // nothing was persisted
  });

  test('a failed receipt refetches so the UI matches the server', async () => {
    await mount();
    const callsBefore = listReviewerApplications.mock.calls.length;
    markApplicationRead.mockResolvedValue({ success: false, error: 'HTTP 500' });
    await act(async () => { await hook.markOpened('EXP-2026-1'); });
    expect(listReviewerApplications.mock.calls.length).toBeGreaterThan(callsBefore);
  });

  test('a failed receipt does not signal the queue changed', async () => {
    await mount();
    const seen = jest.fn();
    const unsubscribe = subscribeQueueChanged(seen);
    markApplicationRead.mockResolvedValue({ success: false, error: 'HTTP 500' });
    await act(async () => { await hook.markOpened('EXP-2026-1'); });
    expect(seen).not.toHaveBeenCalled();
    unsubscribe();
  });

  test('a failure on an already-read row does not un-read it', async () => {
    await mount();
    markApplicationRead.mockResolvedValue({ success: false, error: 'HTTP 500' });
    await act(async () => { await hook.markOpened('EXP-2026-2'); });   // server said read
    expect(stateOf('EXP-2026-2')).toContain('READ');
  });

  test('markOpened resolves with the API result so callers can await it', async () => {
    await mount();
    let result;
    await act(async () => { result = await hook.markOpened('EXP-2026-1'); });
    expect(result.success).toBe(true);
  });
});

/* ---- The refresh signal reaches this tab too ------------------------------ */

describe('queue-changed signal', () => {
  test('a subscriber in the signalling tab is notified', () => {
    const seen = jest.fn();
    const unsubscribe = subscribeQueueChanged(seen);
    signalQueueChanged();
    expect(seen).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  test('it also writes the cross-tab key for other tabs', () => {
    signalQueueChanged();
    expect(localStorage.getItem(REFRESH_KEY)).toBeTruthy();
  });

  test('a storage event from another tab is still honoured', () => {
    const seen = jest.fn();
    const unsubscribe = subscribeQueueChanged(seen);
    window.dispatchEvent(new StorageEvent('storage', { key: REFRESH_KEY }));
    expect(seen).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  test('an unrelated storage key does not trigger a refetch', () => {
    const seen = jest.fn();
    const unsubscribe = subscribeQueueChanged(seen);
    window.dispatchEvent(new StorageEvent('storage', { key: 'something_else' }));
    expect(seen).not.toHaveBeenCalled();
    unsubscribe();
  });

  test('unsubscribing detaches both channels', () => {
    const seen = jest.fn();
    subscribeQueueChanged(seen)();
    signalQueueChanged();
    window.dispatchEvent(new StorageEvent('storage', { key: REFRESH_KEY }));
    expect(seen).not.toHaveBeenCalled();
  });

  test('the queue refetches when another tab signals a change', async () => {
    await mount();
    const callsBefore = listReviewerApplications.mock.calls.length;
    await act(async () => {
      window.dispatchEvent(new StorageEvent('storage', { key: REFRESH_KEY }));
    });
    await waitFor(() =>
      expect(listReviewerApplications.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  test('visible polling brings a new submission into the queue without manual refresh', async () => {
    jest.useFakeTimers();
    pollMs = 1000;
    try {
      render(<Probe />);
      await act(async () => { await Promise.resolve(); });
      expect(stateOf('EXP-2026-1')).toContain('UNREAD');

      serverRows = [row(4), ...serverRows];
      await act(async () => {
        jest.advanceTimersByTime(1000);
        await Promise.resolve();
      });

      expect(stateOf('EXP-2026-4')).toContain('UNREAD');
    } finally {
      jest.useRealTimers();
    }
  });
});
