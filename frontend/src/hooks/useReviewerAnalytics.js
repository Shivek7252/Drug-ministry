/* ============================================================================
   Reviewer analytics: server-computed KPI counts and the reviewer's unread
   total, both aggregated over the COMPLETE filtered dataset.

   Why the server owns these rather than the browser:

     - The client only ever sees the pages it fetched, so any client-side total
       is really "totals of what I happened to load". Unread in particular must
       count the whole filtered set, not the current page.
     - Read receipts are per-reviewer rows in the database. Only the server can
       join them against the filtered applications.

   The server owns the numbers. This hook owns fetching them safely: one
   in-flight request at a time, aborted on unmount and on filter change,
   polling that pauses while the tab is hidden, and no flicker — the previous
   payload stays on screen while the next one loads.
   ============================================================================ */

import { useState, useEffect, useRef, useCallback } from 'react';
import { getReviewerAnalytics } from '../api/applicationService';
import { subscribeQueueChanged } from '../config/queueRefreshSignal';

/* Background refresh cadence while the tab is visible. Long enough not to
   hammer the API, short enough that a decision made by another reviewer on
   another device shows up without anyone touching this tab. */
export const POLL_INTERVAL_MS = 60000;

export default function useReviewerAnalytics(filters, { enabled = true, pollMs = POLL_INTERVAL_MS } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [stale, setStale] = useState(false);

  /* Serialised so the effect re-runs on VALUE change, not identity change. */
  const key = JSON.stringify(filters || {});

  const abortRef = useRef(null);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);
  /* Guards against an older response landing after a newer one. */
  const seqRef = useRef(0);

  const load = useCallback(async ({ background = false } = {}) => {
    if (!enabled) return;
    /* One request at a time. A second trigger while one is open is dropped
       rather than queued — the open one is already fetching current data. */
    if (inFlightRef.current && background) return;
    inFlightRef.current = true;
    const seq = ++seqRef.current;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (!background) setLoading(true);
    try {
      const res = await getReviewerAnalytics(JSON.parse(key), { signal: controller.signal });
      /* Ignore a stale response from a superseded request. */
      if (!mountedRef.current || seq !== seqRef.current) return;
      if (res.aborted) return;   // superseded or unmounted: not a failure
      if (res.success) {
        setData(res);
        setError(null);
        setStale(false);
      } else {
        setError(res.error || 'Analytics could not be loaded.');
        setStale(true);   // keep showing the last good payload, marked stale
      }
    } catch (err) {
      if (err.name === 'AbortError') return;
      if (!mountedRef.current || seq !== seqRef.current) return;
      setError(err.message || 'Analytics could not be loaded.');
      setStale(true);
    } finally {
      if (seq === seqRef.current) {
        inFlightRef.current = false;
        if (mountedRef.current) setLoading(false);
      }
    }
  }, [key, enabled]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  /* Filters changed: foreground load. */
  useEffect(() => { load(); }, [load]);

  /* Background refresh. Paused while hidden — a background tab polling every
     minute is wasted requests and a wasted battery. Resumed on becoming
     visible, with an immediate catch-up fetch. */
  useEffect(() => {
    if (!enabled) return undefined;
    let timer = null;
    const start = () => {
      stop();
      timer = setInterval(() => {
        if (document.visibilityState === 'visible') load({ background: true });
      }, pollMs);
    };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') { load({ background: true }); start(); }
      else stop();
    };
    const onFocus = () => load({ background: true });
    const unsubscribe = subscribeQueueChanged(() => load({ background: true }));

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
      unsubscribe();
    };
  }, [load, enabled, pollMs]);

  return {
    analytics: data,
    serverCounts: data?.current || null,
    unread: data?.unread || null,
    generatedAt: data?.generatedAt || null,
    windows: data?.windows || null,
    sla: data?.sla || null,
    history: data?.history || null,
    loading,
    error,
    stale,
    reload: load,
  };
}
