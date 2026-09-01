/* ============================================================================
   "The reviewer queue changed" signal.

   Deliberately dependency-free. It lives here, not in useReviewQueue, because
   the navbar needs the same channel and useReviewQueue pulls in react-router,
   which the CRA jest resolver cannot resolve for react-router-dom v7. Sharing
   the constant is also the point: two hardcoded key strings would drift and the
   navbar would silently stop refreshing with the queue.

   Two channels, because one is not enough:

     localStorage  reaches OTHER tabs. The `storage` event deliberately does
                   not fire in the tab that wrote it, so this alone leaves the
                   originating tab stale — which is exactly the tab that just
                   marked an application read.
     CustomEvent   reaches THIS tab. Subscribing to both means a read receipt
                   written on the application page refreshes the dashboard's
                   unread count without waiting for the next poll or a real
                   window focus (an SPA back-navigation fires neither).
   ============================================================================ */

export const REFRESH_KEY = 'reviewer_queue_dirty';
export const REFRESH_EVENT = 'reviewer-queue-changed';

/** Signal every tab, this one included, that queue data changed. */
export function signalQueueChanged() {
  try { localStorage.setItem(REFRESH_KEY, String(Date.now())); } catch { /* private mode */ }
  try { window.dispatchEvent(new CustomEvent(REFRESH_EVENT)); } catch { /* no DOM */ }
}

/**
 * Subscribe to queue-changed signals from this tab and from other tabs.
 * @param {() => void} onChange
 * @returns {() => void} unsubscribe
 */
export function subscribeQueueChanged(onChange) {
  const onStorage = event => { if (event.key === REFRESH_KEY) onChange(); };
  window.addEventListener('storage', onStorage);
  window.addEventListener(REFRESH_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(REFRESH_EVENT, onChange);
  };
}
