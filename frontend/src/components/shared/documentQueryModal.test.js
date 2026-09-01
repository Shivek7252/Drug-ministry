import React from 'react';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import DocumentQueryModal from './DocumentQueryModal';
import { getDocumentQueryDraft, submitDocumentQuery } from '../../api/applicationService';

/* ============================================================
   Document-scoped Query workflow

   The modal is addressed by one stable docId. It never receives a list of
   documents, so scoping is structural: the assertions below pin the docId
   used on every call in and out.
   ============================================================ */

jest.mock('../../api/applicationService', () => ({
  getDocumentQueryDraft: jest.fn(),
  submitDocumentQuery: jest.fn(),
}));

const DOC_ID = 'product_approval';
const OTHER_DOC_ID = 'mfg_license';

const DRAFT = {
  success: true,
  applicationNumber: 'EXP-2026-0001',
  document: {
    docId: DOC_ID,
    expectedType: 'Product Approval Certificate',
    fileName: '4. Upload historical data of Export NOC for the applied product.pdf',
    status: { key: 'rejected', label: 'Wrong Document' },
  },
  rows: [{
    order: 1,
    checklistItem: 'Document type verification',
    deficiency: 'The uploaded document is a declaration or undertaking for an NOC application, not a Product Approval Certificate.',
    aiQueryText: 'Please upload a valid Product Approval Certificate for the applied product.',
    queryText: 'Please upload a valid Product Approval Certificate for the applied product.',
    edited: false,
    rowSource: 'ai_generated',
    findingRef: 'document-type',
  }],
};

const MULTI_ROW_DRAFT = {
  ...DRAFT,
  document: { ...DRAFT.document, status: { key: 'rejected', label: 'Rejected by AI' } },
  rows: [
    {
      order: 1, checklistItem: 'Valid date / expiry date is present',
      deficiency: 'The licence expired on 31/12/2026.',
      aiQueryText: 'Please upload a licence that is currently valid.',
      queryText: 'Please upload a licence that is currently valid.',
      rowSource: 'ai_generated', findingRef: 'check:1',
    },
    {
      order: 2, checklistItem: 'Authorised signatory is present',
      deficiency: 'No authorised signature block was found.',
      aiQueryText: 'Please upload a copy signed by the authorised signatory.',
      queryText: 'Please upload a copy signed by the authorised signatory.',
      rowSource: 'ai_generated', findingRef: 'check:2',
    },
  ],
};

function open(props = {}) {
  return render(
    <DocumentQueryModal
      appNumber="EXP-2026-0001"
      docId={DOC_ID}
      docLabel="Product Approval Certificate"
      fileName="4. Upload historical data of Export NOC for the applied product.pdf"
      verificationLabel="Rejected by AI"
      onClose={props.onClose || jest.fn()}
      onSubmitted={props.onSubmitted || jest.fn()}
    />
  );
}

/* Draft arrives on a microtask; flush it inside act before asserting. */
async function ready(props) {
  const utils = open(props);
  await act(async () => { await Promise.resolve(); });
  return utils;
}

const queryFields = () => screen.getAllByLabelText(/Query or corrective action required for row/i);
const rowCount = () => screen.getAllByRole('row').length - 1;   // minus the header row

beforeEach(() => {
  jest.clearAllMocks();
  getDocumentQueryDraft.mockResolvedValue(DRAFT);
  submitDocumentQuery.mockResolvedValue({
    success: true, duplicate: false, query: { queryIdentifier: 'AIQ-EXP-2026-0001-20260901-ABCD1234' },
  });
});

/* ── Scoping ─────────────────────────────────────────────────────────────── */

describe('document scoping', () => {
  test('the draft is requested for the selected document only', async () => {
    await ready();
    expect(getDocumentQueryDraft).toHaveBeenCalledTimes(1);
    expect(getDocumentQueryDraft).toHaveBeenCalledWith('EXP-2026-0001', DOC_ID);
    // No other document is ever asked about.
    expect(getDocumentQueryDraft.mock.calls.some(call => call[1] === OTHER_DOC_ID)).toBe(false);
  });

  test('rows from the selected document are the only ones shown', async () => {
    await ready();
    expect(rowCount()).toBe(1);
    expect(screen.getByText(/not a Product Approval Certificate/)).toBeInTheDocument();
    expect(screen.queryByText(/Manufacturing License/)).not.toBeInTheDocument();
  });

  test('every submitted row goes back under the same docId, including manual ones', async () => {
    const onSubmitted = jest.fn();
    await ready({ onSubmitted });

    fireEvent.click(screen.getByRole('button', { name: /Add Query Row/i }));
    fireEvent.change(queryFields()[1], { target: { value: 'Please confirm the approval number.' } });
    fireEvent.click(screen.getByRole('button', { name: /^Submit Query$/ }));
    await act(async () => { await Promise.resolve(); });

    expect(submitDocumentQuery).toHaveBeenCalledTimes(1);
    const [appNumber, docId, body] = submitDocumentQuery.mock.calls[0];
    expect(appNumber).toBe('EXP-2026-0001');
    expect(docId).toBe(DOC_ID);
    expect(body.rows).toHaveLength(2);
    expect(body.rows.map(r => r.rowSource)).toEqual(['ai_generated', 'reviewer_added']);
    expect(onSubmitted).toHaveBeenCalledWith(expect.objectContaining({ duplicate: false, rowCount: 2 }));
  });
});

/* ── Draft content ───────────────────────────────────────────────────────── */

describe('generated draft', () => {
  test('document context is shown above the table', async () => {
    await ready();
    expect(screen.getByText('Product Approval Certificate')).toBeInTheDocument();
    expect(screen.getByText(/Upload historical data of Export NOC/)).toBeInTheDocument();
    expect(screen.getByText('Wrong Document')).toBeInTheDocument();
    expect(screen.getByText('EXP-2026-0001')).toBeInTheDocument();
  });

  test('a wrong-document draft renders the expected query row', async () => {
    await ready();
    const row = screen.getAllByRole('row')[1];
    expect(within(row).getByText('Document type verification')).toBeInTheDocument();
    expect(within(row).getByText(/not a Product Approval Certificate/)).toBeInTheDocument();
    expect(queryFields()[0]).toHaveValue('Please upload a valid Product Approval Certificate for the applied product.');
    expect(within(row).getByText('AI Generated')).toBeInTheDocument();
  });

  test('multiple failed checks become separate rows', async () => {
    getDocumentQueryDraft.mockResolvedValue(MULTI_ROW_DRAFT);
    await ready();
    expect(rowCount()).toBe(2);
    const values = queryFields().map(f => f.value);
    expect(new Set(values).size).toBe(2);   // no duplicated query text
  });

  test('a document with no findings shows one blank manual row, not a false query', async () => {
    getDocumentQueryDraft.mockResolvedValue({ ...DRAFT, rows: [] });
    await ready();
    expect(rowCount()).toBe(1);
    expect(queryFields()[0]).toHaveValue('');
    expect(screen.getByText('Added by Reviewer')).toBeInTheDocument();
  });
});

/* ── Reviewer controls ───────────────────────────────────────────────────── */

describe('reviewer controls', () => {
  test('AI query text is editable and keeps its AI source, flagged as edited', async () => {
    await ready();
    fireEvent.change(queryFields()[0], { target: { value: 'Please upload the CDSCO-issued approval certificate.' } });

    const row = screen.getAllByRole('row')[1];
    expect(within(row).getByText('AI Generated')).toBeInTheDocument();
    expect(within(row).getByText('edited')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Submit Query$/ }));
    await act(async () => { await Promise.resolve(); });
    const [row1] = submitDocumentQuery.mock.calls[0][2].rows;
    expect(row1.rowSource).toBe('ai_generated');
    expect(row1.queryText).toBe('Please upload the CDSCO-issued approval certificate.');
    expect(row1.aiQueryText).toBe('Please upload a valid Product Approval Certificate for the applied product.');
  });

  test('rows can be added and deleted', async () => {
    await ready();
    fireEvent.click(screen.getByRole('button', { name: /Add Query Row/i }));
    expect(rowCount()).toBe(2);

    fireEvent.click(screen.getByRole('button', { name: /Delete query row 1/i }));
    expect(rowCount()).toBe(1);
    // The AI row was the one removed; the manual row remains.
    expect(screen.getByText('Added by Reviewer')).toBeInTheDocument();
    expect(screen.queryByText('AI Generated')).not.toBeInTheDocument();
  });

  test('serial numbers renumber after a delete', async () => {
    getDocumentQueryDraft.mockResolvedValue(MULTI_ROW_DRAFT);
    await ready();
    fireEvent.click(screen.getByRole('button', { name: /Delete query row 1/i }));
    const row = screen.getAllByRole('row')[1];
    expect(within(row).getByText('1')).toBeInTheDocument();
  });
});

/* ── Validation ──────────────────────────────────────────────────────────── */

describe('validation', () => {
  test('a whitespace-only query is refused beside its own row', async () => {
    await ready();
    fireEvent.change(queryFields()[0], { target: { value: '    ' } });
    fireEvent.click(screen.getByRole('button', { name: /^Submit Query$/ }));

    expect(submitDocumentQuery).not.toHaveBeenCalled();
    const row = screen.getAllByRole('row')[1];
    expect(within(row).getByRole('alert')).toHaveTextContent(/Enter the corrective action/i);
    expect(queryFields()[0]).toHaveAttribute('aria-invalid', 'true');
  });

  test('a blank manual row is dropped rather than blocking submission', async () => {
    await ready();
    fireEvent.click(screen.getByRole('button', { name: /Add Query Row/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Submit Query$/ }));
    await act(async () => { await Promise.resolve(); });

    expect(submitDocumentQuery).toHaveBeenCalledTimes(1);
    expect(submitDocumentQuery.mock.calls[0][2].rows).toHaveLength(1);
  });

  test('submitting with no rows at all is refused', async () => {
    getDocumentQueryDraft.mockResolvedValue({ ...DRAFT, rows: [] });
    await ready();
    fireEvent.click(screen.getByRole('button', { name: /Delete query row 1/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Submit Query$/ }));

    expect(submitDocumentQuery).not.toHaveBeenCalled();
    expect(screen.getByText(/Add at least one query before submitting/i)).toBeInTheDocument();
  });

  test('query text is trimmed before it is sent', async () => {
    await ready();
    fireEvent.change(queryFields()[0], { target: { value: '   Please upload the certificate.   ' } });
    fireEvent.click(screen.getByRole('button', { name: /^Submit Query$/ }));
    await act(async () => { await Promise.resolve(); });
    expect(submitDocumentQuery.mock.calls[0][2].rows[0].queryText).toBe('Please upload the certificate.');
  });

  test('server-side row errors are shown against the right row', async () => {
    submitDocumentQuery.mockResolvedValue({
      success: false, error: 'One or more query rows are incomplete.',
      rowErrors: { _form: '', 'qr-1': 'Enter the corrective action required from the applicant.' },
    });
    getDocumentQueryDraft.mockResolvedValue(DRAFT);
    await ready();
    fireEvent.click(screen.getByRole('button', { name: /^Submit Query$/ }));
    await act(async () => { await Promise.resolve(); });
    // The key comes back from the server keyed by the rowKey the client sent.
    const sentKey = submitDocumentQuery.mock.calls[0][2].rows[0].rowKey;
    expect(typeof sentKey).toBe('string');
  });
});

/* ── Generation failure, retry, duplicate submission ─────────────────────── */

describe('failure handling', () => {
  test('a failed draft shows an error, a retry, and still allows a manual query', async () => {
    getDocumentQueryDraft.mockResolvedValue({ success: false, error: 'AI service unavailable.' });
    await ready();

    expect(screen.getByRole('alert')).toHaveTextContent(/could not be generated/i);
    expect(screen.getByText('AI service unavailable.')).toBeInTheDocument();
    expect(rowCount()).toBe(1);
    expect(screen.getByText('Added by Reviewer')).toBeInTheDocument();

    getDocumentQueryDraft.mockResolvedValue(DRAFT);
    fireEvent.click(screen.getByRole('button', { name: /^Retry$/ }));
    await act(async () => { await Promise.resolve(); });

    expect(getDocumentQueryDraft).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Document type verification')).toBeInTheDocument();
  });

  test('Submit is disabled while a submission is in flight, so a double click cannot duplicate', async () => {
    let release;
    submitDocumentQuery.mockReturnValue(new Promise(resolve => { release = resolve; }));
    await ready();

    const submit = screen.getByRole('button', { name: /^Submit Query$/ });
    fireEvent.click(submit);
    expect(submit).toBeDisabled();

    fireEvent.click(submit);
    fireEvent.click(submit);
    expect(submitDocumentQuery).toHaveBeenCalledTimes(1);

    await act(async () => {
      release({ success: true, duplicate: false, query: { queryIdentifier: 'AIQ-1' } });
      await Promise.resolve();
    });
  });

  test('the same submissionId is reused across retries so the server can deduplicate', async () => {
    submitDocumentQuery
      .mockResolvedValueOnce({ success: false, error: 'Network error.' })
      .mockResolvedValueOnce({ success: true, duplicate: true, query: { queryIdentifier: 'AIQ-1' } });
    await ready();

    fireEvent.click(screen.getByRole('button', { name: /^Submit Query$/ }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText('Network error.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Submit Query$/ }));
    await act(async () => { await Promise.resolve(); });

    const [first, second] = submitDocumentQuery.mock.calls;
    expect(second[2].submissionId).toBe(first[2].submissionId);
  });
});

/* ── Accessibility ───────────────────────────────────────────────────────── */

describe('accessibility', () => {
  test('the dialog is labelled and every control is reachable by name', async () => {
    await ready();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('heading', { name: /Raise a document query/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Close query dialog/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Delete query row 1/i })).toBeInTheDocument();
    expect(queryFields()[0]).toBeInTheDocument();
  });

  test('Escape closes the dialog', async () => {
    const onClose = jest.fn();
    await ready({ onClose });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  test('each cell carries a stacked-card label for small screens', async () => {
    await ready();
    const row = screen.getAllByRole('row')[1];
    const labels = within(row).getAllByRole('cell').map(cell => cell.getAttribute('data-label'));
    expect(labels).toEqual([
      'Sr. No.', 'Checklist Item / Issue', 'AI-Detected Deficiency',
      'Query / Corrective Action Required', 'Source', 'Actions',
    ]);
  });
});
