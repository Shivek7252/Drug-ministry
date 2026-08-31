/* ============================================================================
   Cross-tab "the reviewer queue changed" signal.

   Deliberately dependency-free. It lives here, not in useReviewQueue, because
   the navbar needs the same channel and useReviewQueue pulls in react-router,
   which the CRA jest resolver cannot resolve for react-router-dom v7. Sharing
   the constant is also the point: two hardcoded key strings would drift and the
   navbar would silently stop refreshing with the queue.
   ============================================================================ */

export const REFRESH_KEY = 'reviewer_queue_dirty';

/** Signal other tabs that queue data changed, so their KPIs and badges refetch. */
export function signalQueueChanged() {
  try { localStorage.setItem(REFRESH_KEY, String(Date.now())); } catch { /* private mode */ }
}
