import React from 'react';
import { render, screen, act, within } from '@testing-library/react';
import NocChecklistPage from './NocChecklistPage';
import { getChecklist } from '../../api/applicationService';

/* ============================================================
   Applicant + reviewer view of document-specific queries

   Queries raised from a document's Open & Inspect view are grouped under the
   document they were raised against — keyed on the stable docId, never on the
   filename or document type, which can repeat across uploads.
   ============================================================ */

jest.mock('../../api/applicationService', () => ({
  getChecklist: jest.fn(),
  raiseChecklistQuery: jest.fn(),
  replyChecklistQuery: jest.fn(),
  verifyChecklistFile: jest.fn(),
}));

jest.mock('../../context/AppContext', () => ({ useApp: () => ({ currentUser: 'applicant' }) }));

const CHECKLIST = { preItems: [], postItems: [], approvalSection: null };

const PRODUCT_APPROVAL_QUERY = {
  queryIdentifier: 'AIQ-EXP-2026-0001-20260901071500-A1B2C3D4',
  raisedAt: '2026-09-01T07:15:00.000Z',
  status: 'Open',
  reviewer: 'reviewer1',
  expectedType: 'Product Approval Certificate',
  fileName: '4. Upload historical data of Export NOC for the applied product.pdf',
  rows: [{
    order: 1,
    checklistItem: 'Document type verification',
    deficiency: 'The uploaded document is a declaration or undertaking for an NOC application, not a Product Approval Certificate.',
    queryText: 'Please upload a valid Product Approval Certificate for the applied product.',
    rowSource: 'ai_generated',
  }],
};

/* A second document with a confusingly similar filename — it must never absorb
   the first document's rows. */
const MFG_LICENSE_QUERY = {
  queryIdentifier: 'AIQ-EXP-2026-0001-20260901071900-E5F6A7B8',
  raisedAt: '2026-09-01T07:19:00.000Z',
  status: 'Responded',
  reviewer: 'reviewer1',
  expectedType: 'Manufacturing License',
  fileName: '4. Upload historical data of Export NOC for the applied product.pdf',
  applicantResponse: 'Revised licence uploaded.',
  responseAt: '2026-09-02T09:00:00.000Z',
  rows: [
    { order: 1, checklistItem: 'Valid date / expiry date is present', deficiency: 'The licence expired on 31/12/2026.', queryText: 'Please upload a licence that is currently valid.', rowSource: 'ai_generated' },
    { order: 2, checklistItem: 'Batch size', deficiency: '', queryText: 'Please confirm the approved batch size.', rowSource: 'reviewer_added' },
  ],
};

async function renderPage(documentQueries) {
  getChecklist.mockResolvedValue({
    success: true,
    applicationNumber: 'EXP-2026-0001',
    referenceNumber: 'REF-1',
    status: 'Query Raised',
    checklist: CHECKLIST,
    documents: {},
    documentQueries,
  });
  const utils = render(<NocChecklistPage applicationNumber="EXP-2026-0001" role="applicant" />);
  await act(async () => { await Promise.resolve(); });
  return utils;
}

const group = name => screen.getByRole('region', { name: `Queries for ${name}` });

test('each query renders as a table under its own document, not one paragraph', async () => {
  await renderPage({ product_approval: [PRODUCT_APPROVAL_QUERY] });

  const section = group('Product Approval Certificate');
  const table = within(section).getByRole('table');
  const [, row] = within(table).getAllByRole('row');

  expect(within(row).getByText('Document type verification')).toBeInTheDocument();
  expect(within(row).getByText(/not a Product Approval Certificate/)).toBeInTheDocument();
  expect(within(row).getByText('Please upload a valid Product Approval Certificate for the applied product.')).toBeInTheDocument();
});

test('the AIQ identifier and the submission date are shown', async () => {
  await renderPage({ product_approval: [PRODUCT_APPROVAL_QUERY] });
  const section = group('Product Approval Certificate');
  expect(within(section).getByText(PRODUCT_APPROVAL_QUERY.queryIdentifier)).toBeInTheDocument();
  expect(within(section).getByText(/^Raised /)).toBeInTheDocument();
  expect(within(section).getByText('Open')).toBeInTheDocument();
});

test('rows stay grouped under the correct document even when filenames collide', async () => {
  await renderPage({
    product_approval: [PRODUCT_APPROVAL_QUERY],
    mfg_license: [MFG_LICENSE_QUERY],
  });

  const approval = group('Product Approval Certificate');
  const licence = group('Manufacturing License');

  // One row under the certificate, two under the licence — no cross-contamination.
  expect(within(approval).getAllByRole('row')).toHaveLength(2);      // header + 1
  expect(within(licence).getAllByRole('row')).toHaveLength(3);       // header + 2
  expect(within(approval).queryByText(/licence expired/i)).not.toBeInTheDocument();
  expect(within(licence).queryByText(/not a Product Approval Certificate/)).not.toBeInTheDocument();
});

test('the existing response workflow is preserved in the display', async () => {
  await renderPage({ mfg_license: [MFG_LICENSE_QUERY] });
  const section = group('Manufacturing License');
  expect(within(section).getByText('Responded')).toBeInTheDocument();
  expect(within(section).getByText('Your response')).toBeInTheDocument();
  expect(within(section).getByText('Revised licence uploaded.')).toBeInTheDocument();
});

test('reviewer-added rows appear alongside AI rows under the same document', async () => {
  await renderPage({ mfg_license: [MFG_LICENSE_QUERY] });
  const section = group('Manufacturing License');
  expect(within(section).getByText('Please confirm the approved batch size.')).toBeInTheDocument();
  expect(within(section).getByText('Batch size')).toBeInTheDocument();
});

test('nothing is rendered when no document queries exist', async () => {
  await renderPage({});
  expect(screen.queryByText('Document-Specific Queries')).not.toBeInTheDocument();
});

test('a legacy checklist payload without documentQueries still renders', async () => {
  await renderPage(undefined);
  expect(screen.getByText('Export NOC Check List Query Page')).toBeInTheDocument();
  expect(screen.queryByText('Document-Specific Queries')).not.toBeInTheDocument();
});
