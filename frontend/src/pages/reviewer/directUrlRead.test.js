/* ============================================================================
   Opening an application by direct URL must mark it read.

   The queue's Review button used to be the only thing that wrote a read
   receipt, so a reviewer who opened an application from a bookmark, a link, or
   a second browser tab left it unread forever and the dashboard kept counting
   it. Reaching this page IS opening the application, however the reviewer got
   here.

   ReviewApplicationPage is a large component with many collaborators; they are
   all mocked here so the assertions are about the read receipt alone.
   react-router-dom v7 cannot be resolved by the CRA jest resolver, so it is
   virtual-mocked too.
   ============================================================================ */

import React from 'react';
import { render, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';

const mockParams = { appNumber: 'EXP-2026-258744' };
jest.mock('react-router-dom', () => ({
  useParams: () => mockParams,
  useNavigate: () => jest.fn(),
  useLocation: () => ({ pathname: '/review/application/EXP-2026-258744', search: '' }),
}), { virtual: true });

jest.mock('../../context/AppContext', () => ({
  useApp: () => ({ currentUser: 'reviewer', isLoggedIn: true }),
}));

jest.mock('../../api/applicationService', () => ({
  getApplicationFull: jest.fn(),
  getQueryHistory: jest.fn(),
  getChecklist: jest.fn(),
  preVerifyDocs: jest.fn(),
  reviewerAction: jest.fn(),
  shipmentAction: jest.fn(),
  markApplicationRead: jest.fn(),
}));

jest.mock('../../data/approvedDrugs', () => ({ loadApprovedDrugs: jest.fn().mockResolvedValue([]) }));
jest.mock('../../data/bannedDrugs', () => ({ loadBannedDrugs: jest.fn().mockResolvedValue([]) }));
jest.mock('../../hooks/useCdscoLookup', () => ({ resolveSeverity: () => null }));
jest.mock('../../components/shared/DocViewerModal', () => () => null);
jest.mock('../../components/wizard/DrugComplianceAlert', () => () => null);
jest.mock('./ShipmentsTab', () => () => null);
jest.mock('./SummaryPanel', () => () => null);

const {
  getApplicationFull, getQueryHistory, getChecklist, preVerifyDocs, markApplicationRead,
} = require('../../api/applicationService');
const { REFRESH_KEY, subscribeQueueChanged } = require('../../config/queueRefreshSignal');
const ReviewApplicationPage = require('./ReviewApplicationPage').default;

const APPLICATION = {
  applicationNumber: 'EXP-2026-258744',
  referenceNumber: 'REF-733718',
  applicantOrganization: 'Doloribus atque veni',
  status: 'Submitted',
  submittedAt: '2026-08-26T05:12:00.000Z',
  destinationCountry: 'Poland',
  exportCategory: 'Vaccines',
  products: [],
  documents: [],
};

/* The page also fetches the approved-drugs list straight from the API. It is
   irrelevant here, and letting jsdom attempt a real request only produces CORS
   noise, so it is stubbed. */
const realFetch = global.fetch;
beforeAll(() => { global.fetch = jest.fn().mockResolvedValue({ json: async () => ({ drugs: [] }) }); });
afterAll(() => { global.fetch = realFetch; });

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch.mockResolvedValue({ json: async () => ({ drugs: [] }) });
  localStorage.clear();
  mockParams.appNumber = 'EXP-2026-258744';
  getApplicationFull.mockResolvedValue({ success: true, application: APPLICATION });
  getQueryHistory.mockResolvedValue({ success: true, queries: [] });
  getChecklist.mockResolvedValue({ success: false });
  preVerifyDocs.mockResolvedValue({ success: false });
  markApplicationRead.mockResolvedValue({ success: true, applicationNumber: APPLICATION.applicationNumber });
});

test('reaching the page by URL writes a read receipt for that application', async () => {
  render(<ReviewApplicationPage />);
  await waitFor(() => expect(markApplicationRead).toHaveBeenCalledWith('EXP-2026-258744'));
});

test('the receipt is written once per application, not once per render', async () => {
  const { rerender } = render(<ReviewApplicationPage />);
  await waitFor(() => expect(markApplicationRead).toHaveBeenCalledTimes(1));
  rerender(<ReviewApplicationPage />);
  rerender(<ReviewApplicationPage />);
  await waitFor(() => expect(markApplicationRead).toHaveBeenCalledTimes(1));
});

test('a successful receipt signals the queue changed so the dashboard refetches', async () => {
  const seen = jest.fn();
  const unsubscribe = subscribeQueueChanged(seen);
  render(<ReviewApplicationPage />);
  await waitFor(() => expect(seen).toHaveBeenCalled());
  expect(localStorage.getItem(REFRESH_KEY)).toBeTruthy();
  unsubscribe();
});

test('an application that fails to load is never marked read', async () => {
  getApplicationFull.mockResolvedValue({ success: false, error: 'HTTP 404' });
  render(<ReviewApplicationPage />);
  await waitFor(() => expect(getApplicationFull).toHaveBeenCalled());
  /* Give the effect every chance to fire before asserting it did not. */
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(markApplicationRead).not.toHaveBeenCalled();
});

test('a failed receipt does not signal the queue changed', async () => {
  markApplicationRead.mockResolvedValue({ success: false, error: 'HTTP 500' });
  const seen = jest.fn();
  const unsubscribe = subscribeQueueChanged(seen);
  render(<ReviewApplicationPage />);
  await waitFor(() => expect(markApplicationRead).toHaveBeenCalled());
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(seen).not.toHaveBeenCalled();
  unsubscribe();
});

test('the receipt names the application that loaded, not the one in the URL', async () => {
  /* A redirect or a reference-number lookup can resolve to a different
     application number than the URL segment. The receipt must follow the
     application that actually loaded. */
  mockParams.appNumber = 'REF-733718';
  render(<ReviewApplicationPage />);
  await waitFor(() => expect(markApplicationRead).toHaveBeenCalledWith('EXP-2026-258744'));
});
