import React, { useEffect, useRef, useState } from 'react';
import Icon from '../../../components/ui/Icon';

/* ============================================================================
   FilterBar — sticky under the page header. The KPI row scrolls away above it.

   Status is deliberately absent: the KPI tiles own status selection, and a
   second status control would be the same filter twice (audit item 8).

   The result count is announced politely and on a debounce, so typing in the
   search box does not fire an announcement per keystroke.
   ============================================================================ */

const DATE_PRESETS = [
  { value: 'all', label: 'All dates' },
  { value: 'today', label: 'Today' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'custom', label: 'Custom range' },
];

const ANNOUNCE_DELAY = 700;

export default function FilterBar({
  searchQ, onSearch,
  filterCat, onCategory, categories,
  country, onCountry, countries,
  datePreset, onDatePreset,
  startDate, onStartDate,
  endDate, onEndDate,
  hasFilters, onClearAll,
  resultCount, loading,
}) {
  const [announced, setAnnounced] = useState('');
  const barRef = useRef(null);

  /* The bar wraps to two or three rows at high zoom, so the table header's
     sticky offset cannot be a fixed 56px — measured 188px at 400% zoom, which
     put the header 29px underneath the bar.

     Published to --h-filterbar-actual, NOT --h-filterbar: the latter sets this
     bar's own min-height, so writing to it created a feedback loop that grew
     the bar on every observation (measured 422 -> 478 -> 556px). */
  useEffect(() => {
    const el = barRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const publish = () => {
      document.documentElement.style.setProperty(
        '--h-filterbar-actual', `${Math.round(el.getBoundingClientRect().height)}px`
      );
    };
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (loading) return undefined;
    const t = setTimeout(() => {
      setAnnounced(
        `${resultCount.toLocaleString('en-IN')} application${resultCount === 1 ? '' : 's'} match the current filters.`
      );
    }, ANNOUNCE_DELAY);
    return () => clearTimeout(t);
  }, [resultCount, loading]);

  return (
    <div className="fb" ref={barRef}>
      <div className="fb-inner">
        <div className="fb-search">
          <Icon name="search" size={16} />
          <input
            type="search"
            value={searchQ}
            onChange={e => onSearch(e.target.value)}
            placeholder="Search by application no., reference, applicant, email or licence"
            aria-label="Search applications"
          />
        </div>

        <label className="fb-field">
          <span>Category</span>
          <select value={filterCat} onChange={e => onCategory(e.target.value)}>
            <option value="All">All</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>

        <label className="fb-field">
          <span>Country</span>
          <select value={country} onChange={e => onCountry(e.target.value)}>
            <option value="All">All</option>
            {countries.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>

        <label className="fb-field">
          <span>Submitted</span>
          <select value={datePreset} onChange={e => onDatePreset(e.target.value)}>
            {DATE_PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </label>

        {datePreset === 'custom' && (
          <>
            <label className="fb-field">
              <span>From</span>
              <input type="date" value={startDate} onChange={e => onStartDate(e.target.value)} />
            </label>
            <label className="fb-field">
              <span>To</span>
              <input type="date" value={endDate} onChange={e => onEndDate(e.target.value)} />
            </label>
          </>
        )}

        {hasFilters && (
          <button type="button" className="fb-clear" onClick={onClearAll}>
            <Icon name="x" size={14} />
            Clear all
          </button>
        )}
      </div>

      {/* Debounced so a search keystroke does not announce on every character. */}
      <p className="sr-only" role="status" aria-live="polite">{announced}</p>
    </div>
  );
}
