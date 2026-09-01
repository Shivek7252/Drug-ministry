import React from 'react';
import { render, screen, fireEvent, act, within } from '@testing-library/react';
import ApplicationReviewModal from './ApplicationReviewModal';
import { getApplicationReviewSnapshot, submitUnderReview } from '../../api/applicationService';

/* ============================================================
   Application-level Under Review modal

   Whole-application scope: the snapshot arrives from one server call that
   covers every section. The observation table is internal; only the separate
   applicant message is ever sent onward.
   ============================================================ */

jest.mock('../../api/applicationService', () => ({
  getApplicationReviewSnapshot: jest.fn(),
  submitUnderReview: jest.fn(),
}));

const DEFAULT_MESSAGE =
  'Your application has been taken up for review. The submitted information and supporting '
  + 'documents are currently being examined. No action is required unless a separate query is raised.';

const SNAPSHOT = {
  success: true,
  application: {
    applicationNumber: 'EXP-2026-627966',
    referenceNumber: 'REF-706385',
    applicant: 'Dicta at cupidatat i',
    submittedAt: '2026-08-31T09:00:00.000Z',
    currentStatus: 'Submitted',
  },
  metrics: {
    compliancePercent: 14, complianceComplete: 1, complianceTotal: 7,
    documentsUploaded: 6, aiVerified: 6, aiFlagged: 1, shipments: 1,
    openQueries: 2, totalQueries: 3,
  },
  transition: { allowed: true, alreadyUnderReview: false, reason: '' },
  existingReview: null,
  applicantMessage: DEFAULT_MESSAGE,
  rows: [
    {
      order: 1, area: 'Compliance', item: 'Manufacturing licence', entityId: 'requirement-mfg_license',
      severity: 'high', aiObservation: 'No file has been uploaded against this requirement.',
      aiNote: 'Request the required document or confirm that it is not applicable.',
      note: 'Request the required document or confirm that it is not applicable.',
      edited: false, rowSource: 'ai_generated',
    },
    {
      order: 2, area: 'Product', item: 'Nimulid', entityId: 'medicine-p1',
      severity: 'high', aiObservation: 'Nimesulide',
      aiNote: 'Review the cited notification before making a decision.',
      note: 'Review the cited notification before making a decision.',
      edited: false, rowSource: 'ai_generated',
    },
    {
      order: 3, area: 'Query', item: 'Unresolved queries', entityId: 'queries',
      severity: 'high', aiObservation: '2 raised queries are still awaiting an applicant response.',
      aiNote: 'Confirm whether the outstanding queries block this review.',
      note: 'Confirm whether the outstanding queries block this review.',
      edited: false, rowSource: 'ai_generated',
    },
  ],
};

function open(props = {}) {
  return render(
    <ApplicationReviewModal
      appNumber="EXP-2026-627966"
      onClose={props.onClose || jest.fn()}
      onCompleted={props.onCompleted || jest.fn()}
    />
  );
}

async function ready(props) {
  const utils = open(props);
  await act(async () => { await Promise.resolve(); });
  return utils;
}

const noteFields = () => screen.getAllByLabelText(/Reviewer note or next action for observation/i);
const rowCount = () => (screen.queryAllByRole('row').length ? screen.getAllByRole('row').length - 1 : 0);
const messageBox = () => screen.getByLabelText(/Message to Applicant/i);
const submitBtn = () => screen.getByRole('button', { name: /^Mark as Under Review$/ });

beforeEach(() => {
  jest.clearAllMocks();
  getApplicationReviewSnapshot.mockResolvedValue(SNAPSHOT);
  submitUnderReview.mockResolvedValue({ success: true, duplicate: false, statusChanged: true, status: 'Under Review' });
});

/* ── Scope ───────────────────────────────────────────────────────────────── */

describe('application scope', () => {
  test('the snapshot is requested for the whole application, not a document', async () => {
    await ready();
    expect(getApplicationReviewSnapshot).toHaveBeenCalledTimes(1);
    expect(getApplicationReviewSnapshot).toHaveBeenCalledWith('EXP-2026-627966');
    // No docId is involved anywhere in this flow.
    expect(getApplicationReviewSnapshot.mock.calls[0]).toHaveLength(1);
  });

  test('findings from every application section are shown together', async () => {
    await ready();
    const areas = screen.getAllByRole('row').slice(1)
      .map(row => within(row).getAllByRole('cell')[1].textContent);
    expect(areas).toEqual(expect.arrayContaining(['Compliance', 'Product', 'Query']));
    expect(rowCount()).toBe(3);
  });

  test('the header shows application identity and status, and there is no decision dropdown', async () => {
    await ready();
    expect(screen.getByRole('heading', { name: /Mark Application as Under Review/i })).toBeInTheDocument();
    expect(screen.getByText('EXP-2026-627966')).toBeInTheDocument();
    expect(screen.getByText('Dicta at cupidatat i')).toBeInTheDocument();
    // "Submitted" is both a field label (dt) and the status value (dd).
    expect(screen.getByText('Current status')).toBeInTheDocument();
    expect(screen.getByText('Submitted', { selector: 'dd' })).toBeInTheDocument();
    // The redundant Decision dropdown is gone; only the manual-row area select
    // can exist, and no manual row has been added yet.
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  test('summary metrics carry the successful checks', async () => {
    await ready();
    expect(screen.getByText('14%')).toBeInTheDocument();
    expect(screen.getByText('1/7 checklist items OK')).toBeInTheDocument();
    expect(screen.getByText('matching their expected type')).toBeInTheDocument();
    expect(screen.getByText('need reviewer attention')).toBeInTheDocument();
  });
});

/* ── Reviewer controls ───────────────────────────────────────────────────── */

describe('reviewer controls', () => {
  test('a generated note is editable and keeps its source, flagged as edited', async () => {
    await ready();
    fireEvent.change(noteFields()[0], { target: { value: 'Escalated to the senior reviewer.' } });

    const row = screen.getAllByRole('row')[1];
    expect(within(row).getByText('AI Generated')).toBeInTheDocument();
    expect(within(row).getByText('edited')).toBeInTheDocument();

    fireEvent.click(submitBtn());
    await act(async () => { await Promise.resolve(); });
    const sent = submitUnderReview.mock.calls[0][1].rows[0];
    expect(sent.rowSource).toBe('ai_generated');
    expect(sent.aiNote).toBe('Request the required document or confirm that it is not applicable.');
    expect(sent.note).toBe('Escalated to the senior reviewer.');
  });

  test('manual observations can be added and deleted', async () => {
    await ready();
    fireEvent.click(screen.getByRole('button', { name: /Add Observation/i }));
    expect(rowCount()).toBe(4);
    expect(screen.getByText('Added by Reviewer')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Delete observation 4/i }));
    expect(rowCount()).toBe(3);
    expect(screen.queryByText('Added by Reviewer')).not.toBeInTheDocument();
  });

  test('a manual row carries its own review area selector', async () => {
    await ready();
    fireEvent.click(screen.getByRole('button', { name: /Add Observation/i }));
    const select = screen.getByLabelText(/Review area for observation 4/i);
    fireEvent.change(select, { target: { value: 'Shipment' } });
    fireEvent.change(noteFields()[3], { target: { value: 'Verify the consignee address.' } });

    fireEvent.click(submitBtn());
    await act(async () => { await Promise.resolve(); });
    const manual = submitUnderReview.mock.calls[0][1].rows[3];
    expect(manual).toMatchObject({ area: 'Shipment', rowSource: 'reviewer_added', note: 'Verify the consignee address.' });
  });

  test('a clean application shows the positive empty state instead of a table', async () => {
    getApplicationReviewSnapshot.mockResolvedValue({ ...SNAPSHOT, rows: [] });
    await ready();
    expect(screen.getByText(/No significant exceptions were identified/i)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    // A clean application can still be marked Under Review.
    expect(submitBtn()).toBeEnabled();
  });
});

/* ── Applicant-facing message ────────────────────────────────────────────── */

describe('applicant message', () => {
  test('the neutral default is prefilled and editable', async () => {
    await ready();
    expect(messageBox()).toHaveValue(DEFAULT_MESSAGE);
    fireEvent.change(messageBox(), { target: { value: 'Your application is under examination.' } });
    expect(messageBox()).toHaveValue('Your application is under examination.');

    fireEvent.click(submitBtn());
    await act(async () => { await Promise.resolve(); });
    expect(submitUnderReview.mock.calls[0][1].applicantMessage).toBe('Your application is under examination.');
  });

  test('internal observations never leak into the applicant message', async () => {
    await ready();
    const message = messageBox().value;
    for (const row of SNAPSHOT.rows) {
      expect(message).not.toContain(row.aiObservation);
      expect(message).not.toContain(row.note);
    }
    // The table is explicitly labelled internal, the message explicitly visible.
    expect(screen.getByText(/Not shown to the applicant/i)).toBeInTheDocument();
    expect(screen.getByText(/Visible to the applicant/i)).toBeInTheDocument();
  });

  test('only the message field is submitted as applicant-facing text', async () => {
    await ready();
    fireEvent.click(submitBtn());
    await act(async () => { await Promise.resolve(); });
    const body = submitUnderReview.mock.calls[0][1];
    expect(Object.keys(body).sort()).toEqual(['applicantMessage', 'rows', 'submissionId']);
  });
});

/* ── Validation and submission ───────────────────────────────────────────── */

describe('submission', () => {
  test('a kept row with an emptied note is refused beside that row', async () => {
    await ready();
    fireEvent.change(noteFields()[1], { target: { value: '   ' } });
    fireEvent.click(submitBtn());

    expect(submitUnderReview).not.toHaveBeenCalled();
    const row = screen.getAllByRole('row')[2];
    expect(within(row).getByRole('alert')).toHaveTextContent(/Enter a reviewer note/i);
    expect(noteFields()[1]).toHaveAttribute('aria-invalid', 'true');
  });

  test('a blank manual row is dropped rather than blocking submission', async () => {
    await ready();
    fireEvent.click(screen.getByRole('button', { name: /Add Observation/i }));
    fireEvent.click(submitBtn());
    await act(async () => { await Promise.resolve(); });
    expect(submitUnderReview.mock.calls[0][1].rows).toHaveLength(3);
  });

  test('submission reports the new status back to the page', async () => {
    const onCompleted = jest.fn();
    await ready({ onCompleted });
    fireEvent.click(submitBtn());
    await act(async () => { await Promise.resolve(); });
    expect(onCompleted).toHaveBeenCalledWith(expect.objectContaining({
      status: 'Under Review', duplicate: false, statusChanged: true, rowCount: 3,
    }));
  });

  test('Submit is disabled in flight, so a double click cannot duplicate', async () => {
    let release;
    submitUnderReview.mockReturnValue(new Promise(resolve => { release = resolve; }));
    await ready();

    const button = submitBtn();
    fireEvent.click(button);
    expect(button).toBeDisabled();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(submitUnderReview).toHaveBeenCalledTimes(1);

    await act(async () => {
      release({ success: true, duplicate: false, statusChanged: true, status: 'Under Review' });
      await Promise.resolve();
    });
  });

  test('the same submissionId is reused across retries so the server deduplicates', async () => {
    submitUnderReview
      .mockResolvedValueOnce({ success: false, error: 'Network error.' })
      .mockResolvedValueOnce({ success: true, duplicate: true, status: 'Under Review' });
    await ready();

    fireEvent.click(submitBtn());
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText('Network error.')).toBeInTheDocument();

    fireEvent.click(submitBtn());
    await act(async () => { await Promise.resolve(); });
    const [first, second] = submitUnderReview.mock.calls;
    expect(second[1].submissionId).toBe(first[1].submissionId);
  });
});

/* ── Status rules and failure handling ───────────────────────────────────── */

describe('status rules', () => {
  test('a refused transition is explained and submission is blocked', async () => {
    getApplicationReviewSnapshot.mockResolvedValue({
      ...SNAPSHOT,
      application: { ...SNAPSHOT.application, currentStatus: 'Approved' },
      transition: { allowed: false, alreadyUnderReview: false, reason: 'An application that is Approved cannot be moved back to Under Review.' },
    });
    await ready();
    expect(screen.getByText(/cannot be moved back to Under Review/i)).toBeInTheDocument();
    expect(submitBtn()).toBeDisabled();
  });

  test('an application already Under Review says no second status change is recorded', async () => {
    getApplicationReviewSnapshot.mockResolvedValue({
      ...SNAPSHOT,
      application: { ...SNAPSHOT.application, currentStatus: 'Under Review' },
      transition: { allowed: true, alreadyUnderReview: true, reason: '' },
      existingReview: { reviewedAt: '2026-09-01T07:00:00.000Z', reviewer: 'reviewer1', rowCount: 3 },
    });
    await ready();
    expect(screen.getByText(/No second status change will be recorded/i)).toBeInTheDocument();
    expect(screen.getByText(/3 observations recorded by reviewer1/i)).toBeInTheDocument();
    expect(submitBtn()).toBeEnabled();
  });

  test('a failed snapshot offers retry and still allows a manual observation', async () => {
    getApplicationReviewSnapshot.mockResolvedValue({ success: false, error: 'Summary service unavailable.' });
    await ready();

    expect(screen.getByRole('alert')).toHaveTextContent(/could not be generated/i);
    expect(screen.getByText('Summary service unavailable.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Add Observation/i }));
    expect(rowCount()).toBe(1);

    getApplicationReviewSnapshot.mockResolvedValue(SNAPSHOT);
    fireEvent.click(screen.getByRole('button', { name: /^Retry$/ }));
    await act(async () => { await Promise.resolve(); });
    expect(getApplicationReviewSnapshot).toHaveBeenCalledTimes(2);
    expect(rowCount()).toBe(3);
  });
});

/* ── Accessibility ───────────────────────────────────────────────────────── */

describe('accessibility', () => {
  test('the dialog is labelled and controls are reachable by name', async () => {
    await ready();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(within(dialog).getByRole('heading', { name: /Mark Application as Under Review/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Close review dialog/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Delete observation 1/i })).toBeInTheDocument();
    expect(messageBox()).toBeInTheDocument();
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
      'Sr. No.', 'Review Area', 'Item', 'AI Observation',
      'Reviewer Note / Next Action', 'Source', 'Actions',
    ]);
  });
});
