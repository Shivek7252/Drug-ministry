/* ============================================================================
   Reviewer navbar notifications.

   These used to come from a hardcoded NOTIFICATIONS array in data/mockData.js.
   That array named applications that do not exist in the database
   (EXP-2026-000141 …) and its unread count was a constant 2, so the navbar
   claimed "new entries" whether or not anything had been submitted, and never
   reflected a real submission. That is precisely a phantom notification.

   Eligibility here is not re-derived. It comes from calling the SAME endpoint
   the Review Queue calls, with NO filters, so the server applies the identical
   rule (buildReviewerFilter -> { isDraft: false }). Drafts, and anything else
   the queue excludes, are therefore excluded here by construction rather than
   by a second list of rules that can drift.

   Unread is the same signal the queue's NEW badge uses: the server-backed
   read receipts in /reviewer/read-state, keyed by reviewer + applicationNumber.
   ============================================================================ */

import { useState, useEffect, useCallback } from 'react';
import { listReviewerApplications, getReviewerAnalytics } from '../api/applicationService';
import { subscribeQueueChanged } from '../config/queueRefreshSignal';
import { normalizeStatus, STATUS } from '../pages/reviewer/dashboard/statusModel';
import { formatBusinessDateTime } from '../config/businessTime';

/* Newest first, and only as many as the panel can usefully show. */
const PANEL_LIMIT = 8;

/* Status -> notification dot class. Unknown statuses fall back to info rather
   than throwing away the notification. */
const DOT_BY_STATUS = {
  [STATUS.APPROVED]: 'success',
  [STATUS.PARTIALLY_APPROVED]: 'success',
  [STATUS.REJECTED]: 'danger',
  [STATUS.QUERY_RAISED]: 'warning',
  [STATUS.IN_REVIEW]: 'info',
  [STATUS.SUBMITTED]: 'info',
};

const TITLE_BY_STATUS = {
  [STATUS.APPROVED]: 'NOC Approved',
  [STATUS.PARTIALLY_APPROVED]: 'NOC Partially Approved',
  [STATUS.REJECTED]: 'Application Rejected',
  [STATUS.QUERY_RAISED]: 'Query Raised',
  [STATUS.IN_REVIEW]: 'Application Under Review',
  [STATUS.SUBMITTED]: 'New Application Submitted',
};

/** Build the panel rows from real applications + real read receipts. */
export function buildNotifications(applications, readSet, limit = PANEL_LIMIT) {
  return [...applications]
    /* Same order the queue uses by default: newest submission first. */
    .sort((a, b) => new Date(b.submittedAt || 0) - new Date(a.submittedAt || 0))
    .slice(0, limit)
    .map(app => {
      const status = normalizeStatus(app.status);
      const { date, time } = formatBusinessDateTime(app.submittedAt);
      return {
        id: app.applicationNumber,
        applicationNumber: app.applicationNumber,
        type: DOT_BY_STATUS[status] || 'info',
        title: TITLE_BY_STATUS[status] || 'Application Update',
        msg: `${app.applicationNumber} — ${app.applicantOrganization || app.applicantName || 'Applicant'}`,
        time: date ? `${date}${time ? `, ${time}` : ''}` : 'Submission time unavailable',
        read: readSet.has(app.applicationNumber),
      };
    });
}

/**
 * Live reviewer notifications. Returns an empty, quiet result for anyone who is
 * not a reviewer — an applicant must never be shown the reviewer queue, and
 * showing them mock rows instead is what created the phantom in the first place.
 */
export default function useReviewerNotifications({ enabled = true } = {}) {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!enabled) { setNotifications([]); setUnreadCount(0); return; }
    try {
      /* No filters: the server applies the queue's own eligibility rule. */
      const [res, analytics] = await Promise.all([
        listReviewerApplications({}, { pageSize: PANEL_LIMIT, sort: 'submitted', direction: 'desc' }),
        getReviewerAnalytics(),
      ]);
      const apps = res.applications || [];
      const readSet = new Set(apps.filter(app => app.isRead).map(app => app.applicationNumber));
      setNotifications(buildNotifications(apps, readSet));
      setUnreadCount(analytics.unread?.count || 0);
      setError(null);
    } catch (err) {
      /* A failed fetch must not invent notifications. Show none. */
      setError(err);
      setNotifications([]);
      setUnreadCount(0);
    }
  }, [enabled]);

  useEffect(() => { load(); }, [load]);

  /* Same refresh contract as the queue: focus, tab visibility, and the
     queue-changed signal written when read state changes — in this tab as
     well as in others. */
  useEffect(() => {
    if (!enabled) return undefined;
    const onVisible = () => { if (!document.hidden) load(); };
    const unsubscribe = subscribeQueueChanged(load);
    window.addEventListener('focus', load);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', load);
      document.removeEventListener('visibilitychange', onVisible);
      unsubscribe();
    };
  }, [enabled, load]);

  return { notifications, unreadCount, error, reload: load };
}
