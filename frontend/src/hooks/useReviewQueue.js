import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { REFRESH_KEY, signalQueueChanged, subscribeQueueChanged } from '../config/queueRefreshSignal';
import {
  listReviewerApplications, getReviewerFilterOptions, markApplicationRead,
} from '../api/applicationService';
import { KPI_TILES, ROWS_PER_PAGE_OPTIONS } from '../pages/reviewer/dashboard/aggregations';
import { canonicalReviewerFilters } from '../config/reviewerFilters';

export { KPI_TILES, ROWS_PER_PAGE_OPTIONS, REFRESH_KEY, signalQueueChanged };

export const QUEUE_POLL_INTERVAL_MS = 60000;

export function isUnread(app, readSet = new Set()) {
  return app.isRead === false || (!app.isRead && !readSet.has(app.applicationNumber));
}

export default function useReviewQueue({ pollMs = QUEUE_POLL_INTERVAL_MS } = {}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialSearch = searchParams.get('search') || searchParams.get('q') || '';
  const [searchQ, setSearchQ] = useState(initialSearch);
  const [debouncedQ, setDebouncedQ] = useState(initialSearch);
  const [filterCat, setFilterCat] = useState(searchParams.get('category') || 'All');
  const [country, setCountry] = useState(searchParams.get('country') || 'All');
  const [state, setState] = useState(searchParams.get('state') || 'All States');
  const [datePreset, setDatePreset] = useState(searchParams.get('datePreset') || 'all');
  const [startDate, setStartDate] = useState(searchParams.get('startDate') || '');
  const [endDate, setEndDate] = useState(searchParams.get('endDate') || '');
  const [kpiFilter, setKpiFilter] = useState(searchParams.get('workflowStatus') || searchParams.get('kpi') || 'total');
  const [sort, setSort] = useState({ key: searchParams.get('sort') || 'submitted', dir: searchParams.get('direction') || 'desc' });
  const [page, setPage] = useState(Number(searchParams.get('page')) || 1);
  const [rowsPerPage, setRowsPerPage] = useState(Number(searchParams.get('pageSize')) || 25);
  const [rows, setRows] = useState([]);
  const [totalRows, setTotalRows] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState('');
  const [countries, setCountries] = useState([]);
  const [categories, setCategories] = useState([]);
  const [states, setStates] = useState([]);
  const [readSet, setReadSet] = useState(() => new Set());
  const [readStateReady, setReadStateReady] = useState(false);
  const prevCountry = useRef(country);
  /* Mirrors readSet for markOpened's rollback, so the callback identity does
     not change every time a row is opened. */
  const readSetRef = useRef(readSet);
  useEffect(() => { readSetRef.current = readSet; }, [readSet]);

  const serverFilters = useMemo(() => canonicalReviewerFilters({
    search: debouncedQ, category: filterCat, country, state,
    status: 'All', workflowStatus: 'total', datePreset,
    ...(datePreset === 'custom' ? { startDate, endDate } : { startDate: '', endDate: '' }),
  }), [debouncedQ, filterCat, country, state, datePreset, startDate, endDate]);

  const queueFilters = useMemo(() => ({ ...serverFilters, workflowStatus: kpiFilter }),
    [serverFilters, kpiFilter]);

  const load = useCallback(async ({ background = false } = {}) => {
    if (background) setRefreshing(true);
    else setLoading(true);
    setError('');
    const res = await listReviewerApplications(queueFilters, {
      page, pageSize: rowsPerPage, sort: sort.key, direction: sort.dir,
    });
    if (!res.success) {
      setError(res.error || 'Applications could not be loaded.');
      if (!background) setRows([]);
      setStale(background);
      setRefreshing(false);
      setLoading(false);
      return;
    }
    const nextRows = res.applications || [];
    setRows(nextRows);
    setTotalRows(res.total || 0);
    setPageCount(Math.max(1, res.totalPages || 1));
    setReadSet(new Set(nextRows.filter(app => app.isRead).map(app => app.applicationNumber)));
    setReadStateReady(true);
    setStale(false);
    setRefreshing(false);
    setLoading(false);
  }, [queueFilters, page, rowsPerPage, sort]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let timer = null;
    const refresh = () => load({ background: true });
    const stopPolling = () => {
      if (timer) clearInterval(timer);
      timer = null;
    };
    const startPolling = () => {
      stopPolling();
      timer = setInterval(() => {
        if (document.visibilityState === 'visible') refresh();
      }, pollMs);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        refresh();
        startPolling();
      } else stopPolling();
    };
    const unsubscribe = subscribeQueueChanged(refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisible);
    if (document.visibilityState === 'visible') startPolling();
    return () => {
      stopPolling();
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisible);
      unsubscribe();
    };
  }, [load, pollMs]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQ(searchQ.trim()), 350);
    return () => clearTimeout(timer);
  }, [searchQ]);

  useEffect(() => {
    getReviewerFilterOptions().then(res => {
      if (!res.success) return;
      setCountries(res.countries || []);
      setCategories(res.categories || []);
      setStates(res.states || []);
    });
  }, []);

  useEffect(() => {
    setPage(1);
  }, [debouncedQ, filterCat, country, state, datePreset, startDate, endDate, kpiFilter, rowsPerPage]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (debouncedQ) next.set('search', debouncedQ);
    if (filterCat !== 'All') next.set('category', filterCat);
    if (country !== 'All') next.set('country', country);
    if (state !== 'All States') next.set('state', state);
    if (datePreset !== 'all') next.set('datePreset', datePreset);
    if (datePreset === 'custom' && startDate) next.set('startDate', startDate);
    if (datePreset === 'custom' && endDate) next.set('endDate', endDate);
    if (kpiFilter !== 'total') next.set('workflowStatus', kpiFilter);
    if (sort.key !== 'submitted') next.set('sort', sort.key);
    if (sort.dir !== 'desc') next.set('direction', sort.dir);
    if (page !== 1) next.set('page', String(page));
    if (rowsPerPage !== 25) next.set('pageSize', String(rowsPerPage));
    const countryChanged = prevCountry.current !== country;
    prevCountry.current = country;
    setSearchParams(next, { replace: !countryChanged });
  }, [debouncedQ, filterCat, country, state, datePreset, startDate, endDate,
    kpiFilter, sort, page, rowsPerPage, setSearchParams]);

  const toggleSort = useCallback(key => {
    setSort(current => current.key === key
      ? { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: ['submitted', 'queries'].includes(key) ? 'desc' : 'asc' });
    setPage(1);
  }, []);

  /* Optimistic, then reconciled — never a blind decrement.

     The badge disappears immediately, but the number the dashboard shows comes
     from the server. On success we signal the queue changed, which makes the
     analytics hook refetch the authoritative unread count for the current
     filters. On failure the optimistic edit is rolled back so the row does not
     claim to be read when no receipt was persisted.

     Awaited by callers, so a navigation-triggered refresh cannot race ahead of
     the receipt it is supposed to observe. */
  const markOpened = useCallback(async appNo => {
    const wasRead = readSetRef.current.has(appNo);
    setReadSet(current => new Set(current).add(appNo));
    setRows(current => current.map(row => (
      row.applicationNumber === appNo ? { ...row, isRead: true } : row
    )));

    const res = await markApplicationRead(appNo);
    if (!res.success) {
      if (!wasRead) {
        setReadSet(current => {
          const next = new Set(current);
          next.delete(appNo);
          return next;
        });
        setRows(current => current.map(row => (
          row.applicationNumber === appNo ? { ...row, isRead: false } : row
        )));
      }
      await load({ background: true });
      return res;
    }
    signalQueueChanged();
    return res;
  }, [load]);

  const resetFilters = useCallback(() => {
    setSearchQ(''); setDebouncedQ(''); setFilterCat('All'); setCountry('All');
    setState('All States'); setDatePreset('all'); setStartDate(''); setEndDate('');
    setKpiFilter('total'); setPage(1);
  }, []);

  const hasFilters = kpiFilter !== 'total' || filterCat !== 'All' || country !== 'All'
    || state !== 'All States' || datePreset !== 'all' || debouncedQ !== '';

  return {
    pageRows: rows, sortedRows: rows, barFiltered: rows, viewFiltered: rows,
    loading, refreshing, stale, error, truncated: false, reload: load,
    totalRows, countries, categories, states,
    serverFilters, queueFilters,
    searchQ, setSearchQ, filterCat, setFilterCat, country, setCountry,
    state, setState, datePreset, setDatePreset, startDate, setStartDate, endDate, setEndDate,
    hasFilters, resetFilters,
    kpiFilter, setKpiFilter, tiles: KPI_TILES,
    sort, toggleSort,
    page, setPage, pageCount, rowsPerPage, setRowsPerPage,
    readSet, readStateReady, markOpened,
  };
}
