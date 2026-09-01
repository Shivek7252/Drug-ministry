import React from 'react';
import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import ReviewApplicationPage from './ReviewApplicationPage';
import {
  getApplicationFull, getQueryHistory, getChecklist,
  preVerifyDocs, markApplicationRead,
} from '../../api/applicationService';

/* ============================================================
   Pre-verify sweep — the permanent "Checking…" regression.

   The sweep used to be cancelled by its own effect cleanup while a ref
   recorded that it had already been attempted. Under StrictMode's
   mount → cleanup → mount cycle the only run was abandoned and the second
   pass returned early, so `aiCheckLoading` stayed true forever and the
   document cards showed "Checking…" indefinitely — even though the backend
   had completed and persisted every verdict.
   ============================================================ */

jest.mock('../../api/applicationService', () => ({
  getApplicationFull: jest.fn(),
  getQueryHistory: jest.fn(),
  getChecklist: jest.fn(),
  preVerifyDocs: jest.fn(),
  markApplicationRead: jest.fn(),
  reviewerAction: jest.fn(),
  shipmentAction: jest.fn(),
}));

/* react-router-dom v7 is not resolvable by the CRA jest resolver. */
jest.mock('react-router-dom', () => ({
  useParams: () => ({ appNumber: 'EXP-2026-296866' }),
  useNavigate: () => jest.fn(),
  useLocation: () => ({ pathname: '/review/application/EXP-2026-296866', search: '' }),
}), { virtual: true });

jest.mock('../../context/AppContext', () => ({ useApp: () => ({ currentUser: 'reviewer' }) }));
jest.mock('../../components/shared/DocViewerModal', () => () => null);
jest.mock('../../components/shared/ApplicationReviewModal', () => () => null);
jest.mock('../../components/wizard/DrugComplianceAlert', () => () => null);
jest.mock('../../hooks/useCdscoLookup', () => ({ resolveSeverity: () => null }));
jest.mock('../../data/approvedDrugs', () => ({ loadApprovedDrugs: () => Promise.resolve([]) }));
jest.mock('../../data/bannedDrugs', () => ({ loadBannedDrugs: () => Promise.resolve([]) }));
jest.mock('./ShipmentsTab', () => () => null);
jest.mock('./SummaryPanel', () => () => null);

const APP_NO = 'EXP-2026-296866';

const doc = (name, typeMatch) => ({
  name, size: 1024, type: 'application/pdf', uploadedAt: '12:40 PM',
  validated: typeMatch !== undefined,
  validationResult: typeMatch === undefined
    ? null
    : { state: 'completed', documentTypeMatch: typeMatch, documentTypeReason: 'reason', verifiedAt: '2026-09-01T12:41:26.000Z' },
});

/* Three settled, three not yet verified — the state in the reported screenshot. */
const PARTIAL = {
  applicationNumber: APP_NO, referenceNumber: 'REF-1', status: 'Submitted',
  applicantName: 'Test', documents: {
    mfg_license: doc('a.pdf', true),
    product_approval: doc('b.pdf', false),
    export_auth: doc('c.pdf', false),
    qa_cert: doc('d.pdf'),
    batch_analysis: doc('e.pdf'),
    product_info: doc('f.pdf'),
  },
};

/* What the backend actually holds once the sweep finishes. */
const COMPLETE = {
  ...PARTIAL,
  documents: {
    ...PARTIAL.documents,
    qa_cert: doc('d.pdf', false),
    batch_analysis: doc('e.pdf', false),
    product_info: doc('f.pdf', true),
  },
};

function renderPage() {
  return render(<ReviewApplicationPage />);
}


/* Models the real backend: /full returns the partial state until the sweep
   completes, and the complete state afterwards. Robust to StrictMode calling
   load() twice, which a mockResolvedValueOnce chain is not. */
function mockBackend({ sweepResult = { success: true, results: {} }, sweepRejects = false } = {}) {
  let swept = false;
  getApplicationFull.mockImplementation(async () => ({
    success: true, application: swept ? COMPLETE : PARTIAL,
  }));
  preVerifyDocs.mockImplementation(async () => {
    swept = true;
    if (sweepRejects) throw new Error('network down');
    return sweepResult;
  });
}

const settle = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });
const checkingBadges = () => screen.queryAllByText(/Checking…/i);

beforeEach(() => {
  jest.clearAllMocks();
  getQueryHistory.mockResolvedValue({ success: true, queries: [] });
  getChecklist.mockResolvedValue({ success: true, checklist: {} });
  markApplicationRead.mockResolvedValue({ success: true });
});

test('a completed sweep clears every "Checking…" badge without a page refresh', async () => {
  mockBackend();

  renderPage();
  await settle();
  await settle();

  expect(preVerifyDocs).toHaveBeenCalledWith(APP_NO);
  // The refreshed application replaced the partial one, so nothing is pending.
  expect(checkingBadges()).toHaveLength(0);
});

test('StrictMode double-mount does not strand the sweep in "Checking…"', async () => {
  mockBackend();

  render(
    <React.StrictMode>
      <ReviewApplicationPage />
    </React.StrictMode>
  );
  await settle();
  await settle();

  // The regression: the cancelled first run left this stuck forever.
  expect(checkingBadges()).toHaveLength(0);
  // And the sweep is not fired twice for the same application.
  expect(preVerifyDocs).toHaveBeenCalledTimes(1);
});

test('a failed or timed-out sweep still shows the verdicts that did land', async () => {
  // The 4-minute client timeout aborts the sweep, but the backend still settled.
  mockBackend({ sweepResult: { success: false, error: 'The operation was aborted.' } });

  renderPage();
  await settle();
  await settle();

  // Previously no refresh happened unless res.success was true.
  expect(getApplicationFull).toHaveBeenCalledTimes(2);
  expect(checkingBadges()).toHaveLength(0);
});

test('a rejected sweep promise does not leave the page loading forever', async () => {
  mockBackend({ sweepRejects: true });

  renderPage();
  await settle();
  await settle();

  expect(checkingBadges()).toHaveLength(0);
});

test('documents already settled never trigger a sweep at all', async () => {
  getApplicationFull.mockResolvedValue({ success: true, application: COMPLETE });

  renderPage();
  await settle();
  await settle();

  expect(preVerifyDocs).not.toHaveBeenCalled();
  expect(checkingBadges()).toHaveLength(0);
});

test('a document that stays unverified does not loop the sweep endlessly', async () => {
  // The backend genuinely could not settle one document.
  getApplicationFull.mockResolvedValue({ success: true, application: PARTIAL });
  preVerifyDocs.mockResolvedValue({ success: true, results: {} });

  renderPage();
  await settle();
  await settle();
  await settle();

  // One sweep only — the `done` marker stops it re-running on every refresh.
  expect(preVerifyDocs).toHaveBeenCalledTimes(1);
});
