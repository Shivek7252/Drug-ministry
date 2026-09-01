import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import DocViewerModal from './DocViewerModal';

/* ============================================================
   Reviewer inspection panel — decision actions

   A document the AI classified as the wrong type has already failed
   verification, so the panel withholds its Reject button. Every other
   document keeps it, and no other action changes in either case.
   ============================================================ */

/* pdfjs-dist ships ESM that jest cannot parse, and no page ever renders here. */
jest.mock('pdfjs-dist', () => ({
  version: '6.0.0',
  GlobalWorkerOptions: {},
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 0,
      getPage: () => Promise.resolve({ getViewport: () => ({ width: 600, height: 800 }) }),
    }),
  }),
}));

/* The document query modal owns its own suite; here it only needs to open.
   CRA's jest config sets resetMocks, so implementations are set per test. */
jest.mock('../../api/applicationService', () => ({
  getDocumentQueryDraft: jest.fn(),
  submitDocumentQuery: jest.fn(),
}));

const WRONG_DOCUMENT = {
  documentTypeMatch: false,
  documentTypeReason: 'The document is a manufacturing license, not a product information sheet.',
  expectedDocumentType: 'Product Information Sheet',
  detectedDocumentType: 'Manufacturing License',
  suggestedCorrectiveAction: 'Upload the prescribing information for this product.',
  results: [],
  summary: { total: 0, present: 0, missing: 0, unknown: 0, score: 0 },
};

/* Right document type, one failing content check — rejected by AI, but not a
   wrong document. This is the case that must keep its Reject button. */
const FAILED_CHECK = {
  documentTypeMatch: true,
  results: [{
    item: 'Valid approval date', present: false, note: 'The approval expired on 01/01/2025.',
  }],
  summary: { total: 1, present: 0, missing: 1, unknown: 0, score: 0 },
};

const CORRECT_DOCUMENT = {
  documentTypeMatch: true,
  results: [{ item: 'Licence number', present: true, evidence: 'Licence 123' }],
  summary: { total: 1, present: 1, missing: 0, unknown: 0, score: 100 },
};

function openInspection(payload) {
  global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(payload) }));
  return render(
    <DocViewerModal
      docId="product_info"
      docType="product_info"
      docLabel="Product Information Sheet"
      fileUrl="blob:doc"
      fileName="3. Copy of Manufacturing License.pdf"
      fileType="application/pdf"
      appNumber="EXP-2026-0001"
      reviewerMode
      onReviewerDecision={jest.fn()}
      onClose={jest.fn()}
    />
  );
}

const reject = () => screen.queryByRole('button', { name: /^Reject$/ });

/* Waits for the AI verdict to reach the panel header, then flushes the footer
   re-render that the panel's onVerificationChange triggers. That update is
   scheduled on a macrotask, so a bare microtask flush would race it and every
   assertion below would see the pre-verdict footer. */
async function settled(statusLabel) {
  expect(await screen.findByText(statusLabel)).toBeInTheDocument();
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
}

afterEach(() => { delete global.fetch; });

test('a wrong document loses its Reject button but keeps every other action', async () => {
  openInspection(WRONG_DOCUMENT);
  await settled('Rejected by AI');

  expect(reject()).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^Approve$/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^Query$/ })).toBeInTheDocument();
  // Close carries no accessible name, so it is matched by its class.
  expect(document.querySelector('.dv-close-btn')).toBeInTheDocument();
  expect(screen.getByText(/classified this upload as the wrong document type/i)).toBeInTheDocument();
});

test('the Wrong Document status, reason and verification detail all stay visible', async () => {
  openInspection(WRONG_DOCUMENT);
  await settled('Rejected by AI');

  expect(screen.getByText('Rejection Details')).toBeInTheDocument();
  expect(screen.getByText(WRONG_DOCUMENT.documentTypeReason)).toBeInTheDocument();
  expect(screen.getByText('Manufacturing License')).toBeInTheDocument();
  expect(screen.getByText(WRONG_DOCUMENT.suggestedCorrectiveAction)).toBeInTheDocument();
});

test('a document rejected only on a failed check keeps its Reject button', async () => {
  openInspection(FAILED_CHECK);
  await settled('Rejected by AI');

  expect(reject()).toBeInTheDocument();
  expect(screen.getByText(/Select a reviewer decision/i)).toBeInTheDocument();
});

test('a correct document keeps its Reject button', async () => {
  openInspection(CORRECT_DOCUMENT);
  await settled('AI Verified');

  expect(reject()).toBeInTheDocument();
});

test('Query opens the document-scoped query modal for this document only', async () => {
  const { getDocumentQueryDraft } = require('../../api/applicationService');
  getDocumentQueryDraft.mockResolvedValue({
    success: true,
    document: {
      docId: 'product_info', expectedType: 'Product Information Sheet',
      fileName: 'doc.pdf', status: { key: 'rejected', label: 'Wrong Document' },
    },
    rows: [],
  });
  openInspection(WRONG_DOCUMENT);
  await settled('Rejected by AI');

  fireEvent.click(screen.getByRole('button', { name: /^Query$/ }));
  await act(async () => { await Promise.resolve(); });

  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: /Raise a document query/i })).toBeInTheDocument();
  // Scoped by docId — the same one the inspector was opened with.
  expect(getDocumentQueryDraft).toHaveBeenCalledWith('EXP-2026-0001', 'product_info');
  // The application-level decision dialog is NOT what opened.
  expect(screen.queryByText(/Raise a query/i, { selector: 'h3' })).not.toBeInTheDocument();
});

test('Approve still opens the unchanged application-level decision dialog', async () => {
  openInspection(CORRECT_DOCUMENT);
  await settled('AI Verified');

  fireEvent.click(screen.getByRole('button', { name: /^Approve$/ }));
  expect(screen.getByText('Approve this application?')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /Confirm Approval/i })).toBeInTheDocument();
});

test('a pending verification keeps its Reject button', async () => {
  // Never resolves — the panel stays in its loading state.
  global.fetch = jest.fn(() => new Promise(() => {}));
  render(
    <DocViewerModal
      docId="product_info" docType="product_info" docLabel="Product Information Sheet"
      fileUrl="blob:doc" fileName="doc.pdf" fileType="application/pdf"
      appNumber="EXP-2026-0001" reviewerMode
      onReviewerDecision={jest.fn()} onClose={jest.fn()}
    />
  );

  await settled('Verification Pending');
  expect(reject()).toBeInTheDocument();
});
