import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { listReviewerApplications, getReviewerFilterOptions } from '../api/applicationService';
import {
  kpiCounts, kpiDeltas, isOverdue, turnaroundDays, daysBetween, KPI_TILES,
  ROWS_PER_PAGE_OPTIONS,
} from '../pages/reviewer/dashboard/aggregations';

export { KPI_TILES, ROWS_PER_PAGE_OPTIONS };

/* ============================================================================
   useReviewQueue — single source of truth for the reviewer console.

   The server applies the filters and we pull the whole matching set (the
   existing /reviewer endpoint caps pageSize at 100, so we page through it).
   That is what lets the table and the charts share one dataset: filtering the
   table filters the charts, because there is only one array.

   No new endpoints and no contract change — same route, same params.
   ============================================================================ */

const SERVER_PAGE_SIZE = 100;   // hard cap enforced by the API
const MAX_PAGES = 20;           // safety stop: 2000 rows of analytics
const OPENED_KEY = 'reviewer_opened_apps';

/* ---- reviewer-local "seen" tracking (unchanged behaviour) --------------- */
export function getOpenedApps() {
  try { return new Set(JSON.parse(localStorage.getItem(OPENED_KEY) || '[]')); }
  catch { return new Set(); }
}
export function markAppOpened(appNo) {
  const set = getOpenedApps();
  set.add(appNo);
  try { localStorage.setItem(OPENED_KEY, JSON.stringify([...set])); } catch { /* quota */ }
}
export function isNewUnseen(app, openedSet) {
  if (openedSet.has(app.applicationNumber)) return false;
  if (!app.submittedAt) return false;
  return Date.now() - new Date(app.submittedAt).getTime() < 48 * 60 * 60 * 1000;
}

/* ---- sorting ------------------------------------------------------------ */
const SORT_ACCESSORS = {
  application: a => a.applicationNumber || '',
  applicant: a => (a.applicantOrganization || a.applicantName || '').toLowerCase(),
  submitted: a => new Date(a.submittedAt || a.createdAt || 0).getTime(),
  age: a => daysBetween(a.submittedAt || a.createdAt) ?? -1,
  queries: a => a.queryCount || 0,
  status: a => a.status || '',
};

function sortRows(rows, key, dir) {
  const accessor = SORT_ACCESSORS[key];
  if (!accessor) return rows;
  const factor = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = accessor(a);
    const bv = accessor(b);
    if (av < bv) return -1 * factor;
    if (av > bv) return 1 * factor;
    return 0;
  });
}

export default function useReviewQueue() {
  const [searchParams, setSearchParams] = useSearchParams();

  /* ---- server-side filters (unchanged params) -------------------------- */
  const [searchQ, setSearchQ] = useState(() => searchParams.get('q') || '');
  const [debouncedQ, setDebouncedQ] = useState(() => searchParams.get('q') || '');
  const [filterCat, setFilterCat] = useState(() => searchParams.get('category') || 'All');
  const [country, setCountry] = useState(() => searchParams.get('country') || 'All');
  const [datePreset, setDatePreset] = useState(() => searchParams.get('datePreset') || 'all');
  const [startDate, setStartDate] = useState(() => searchParams.get('startDate') || '');
  const [endDate, setEndDate] = useState(() => searchParams.get('endDate') || '');

  /* ---- client-side view state ------------------------------------------ */
  const [kpiFilter, setKpiFilter] = useState(() => searchParams.get('kpi') || 'total');
  const [sort, setSort] = useState({ key: 'submitted', dir: 'desc' });
  const [page, setPage] = useState(1);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [selected, setSelected] = useState(() => new Set());

  /* ---- data --------------------------------------------------------------
     Two derived sets, named so the distinction can never be misread:

       barFiltered   filter bar only (search, category, country, submitted).
                     KPI tile counts and deltas read THIS, so selecting a tile
                     never zeroes the others.
       viewFiltered  barFiltered narrowed by the active KPI tile. The table,
                     the charts and the analytics scope line read THIS.
     -------------------------------------------------------------------- */
  const [barFiltered, setAllRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [countries, setCountries] = useState([]);
  const [categories, setCategories] = useState([]);
  const [openedApps, setOpenedApps] = useState(getOpenedApps);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    const baseParams = {
      pageSize: SERVER_PAGE_SIZE,
      q: debouncedQ,
      status: 'All',            // status is filtered client-side by the KPI tiles
      category: filterCat,
      country,
      datePreset,
      ...(datePreset === 'custom' ? { startDate, endDate } : {}),
    };

    const first = await listReviewerApplications({ ...baseParams, page: 1 });
    if (!first.success) {
      setAllRows([]);
      setError(first.error || 'Applications could not be loaded.');
      setLoading(false);
      return;
    }

    let rows = first.applications || [];
    const pages = Math.min(first.totalPages || 1, MAX_PAGES);
    if (pages > 1) {
      const rest = await Promise.all(
        Array.from({ length: pages - 1 }, (_, i) =>
          listReviewerApplications({ ...baseParams, page: i + 2 })
        )
      );
      for (const res of rest) if (res.success) rows = rows.concat(res.applications || []);
    }

    setTruncated((first.totalPages || 1) > MAX_PAGES);
    setAllRows(rows);
    setLoading(false);
  }, [debouncedQ, filterCat, country, datePreset, startDate, endDate]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQ(searchQ.trim()); }, 350);
    return () => clearTimeout(t);
  }, [searchQ]);

  useEffect(() => {
    getReviewerFilterOptions().then(res => {
      if (res.success) {
        setCountries(res.countries || []);
        setCategories(res.categories || []);
      }
    });
  }, []);

  /* Reset paging and selection whenever the result set changes shape. */
  useEffect(() => { setPage(1); setSelected(new Set()); },
    [debouncedQ, filterCat, country, datePreset, startDate, endDate, kpiFilter, rowsPerPage]);

  /* ---- URL sync (adds ?kpi=, keeps every existing param) --------------- */
  useEffect(() => {
    const next = new URLSearchParams();
    if (debouncedQ) next.set('q', debouncedQ);
    if (filterCat !== 'All') next.set('category', filterCat);
    if (country !== 'All') next.set('country', country);
    if (datePreset !== 'all') next.set('datePreset', datePreset);
    if (datePreset === 'custom' && startDate) next.set('startDate', startDate);
    if (datePreset === 'custom' && endDate) next.set('endDate', endDate);
    if (kpiFilter !== 'total') next.set('kpi', kpiFilter);
    setSearchParams(next, { replace: true });
  }, [debouncedQ, filterCat, country, datePreset, startDate, endDate, kpiFilter, setSearchParams]);

  /* ---- derived: one filtered array feeds BOTH table and charts --------- */
  const tile = KPI_TILES.find(t => t.key === kpiFilter) || KPI_TILES[0];
  const viewFiltered = useMemo(() => barFiltered.filter(tile.match), [barFiltered, tile]);

  const sortedRows = useMemo(
    () => sortRows(viewFiltered, sort.key, sort.dir), [viewFiltered, sort]);

  const pageCount = Math.max(1, Math.ceil(sortedRows.length / rowsPerPage));
  const safePage = Math.min(page, pageCount);
  const pageRows = useMemo(
    () => sortedRows.slice((safePage - 1) * rowsPerPage, safePage * rowsPerPage),
    [sortedRows, safePage, rowsPerPage]);

  /* Counts read barFiltered, NOT viewFiltered: filter to Vaccines and the
     tiles show Vaccines counts; then click "Query" and the tiles keep showing
     Vaccines counts while the table and charts narrow to Query. */
  const counts = useMemo(() => kpiCounts(barFiltered), [barFiltered]);
  const deltas = useMemo(() => kpiDeltas(barFiltered, { days: 7 }), [barFiltered]);

  const toggleSort = useCallback(key => {
    setSort(s => s.key === key
      ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: key === 'submitted' || key === 'age' || key === 'queries' ? 'desc' : 'asc' });
  }, []);

  const toggleSelect = useCallback(appNo => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(appNo)) next.delete(appNo); else next.add(appNo);
      return next;
    });
  }, []);

  const toggleSelectAllOnPage = useCallback(() => {
    setSelected(prev => {
      const ids = pageRows.map(r => r.applicationNumber);
      const allOn = ids.length > 0 && ids.every(id => prev.has(id));
      const next = new Set(prev);
      ids.forEach(id => (allOn ? next.delete(id) : next.add(id)));
      return next;
    });
  }, [pageRows]);

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  const markOpened = useCallback(appNo => {
    markAppOpened(appNo);
    setOpenedApps(getOpenedApps());
  }, []);

  const resetFilters = useCallback(() => {
    setSearchQ(''); setDebouncedQ('');
    setFilterCat('All'); setCountry('All');
    setDatePreset('all'); setStartDate(''); setEndDate('');
    setKpiFilter('total');
  }, []);

  const hasFilters = kpiFilter !== 'total' || filterCat !== 'All' || country !== 'All'
    || datePreset !== 'all' || debouncedQ !== '';

  return {
    // data — barFiltered feeds the tiles, viewFiltered feeds table + charts
    barFiltered, viewFiltered, sortedRows, pageRows,
    loading, error, truncated, reload: load,
    // options
    countries, categories,
    // server filters
    searchQ, setSearchQ,
    filterCat, setFilterCat,
    country, setCountry,
    datePreset, setDatePreset,
    startDate, setStartDate, endDate, setEndDate,
    hasFilters, resetFilters,
    // kpi filter
    kpiFilter, setKpiFilter, counts, deltas, tiles: KPI_TILES,
    // sorting
    sort, toggleSort,
    // pagination
    page: safePage, setPage, pageCount, rowsPerPage, setRowsPerPage,
    // selection
    selected, toggleSelect, toggleSelectAllOnPage, clearSelection,
    // misc
    openedApps, markOpened,
    helpers: { turnaroundDays, daysBetween, isOverdue },
  };
}
