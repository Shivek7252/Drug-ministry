import React, { useRef } from 'react';
import Icon from '../../../components/ui/Icon';
import { SLA_DESCRIPTION } from './statusModel';

/* ============================================================================
   KpiFilterRow — the KPI strip is the primary filter affordance.

   A tile carries exactly three things: its icon, its label and its current
   count. There is no week-to-date comparison, arrow, percentage or "not
   comparable" placeholder — those were removed, along with the client-side
   delta helpers that fed them.

   Counts come from barFiltered (filter bar only), NEVER from the tile
   selection, so choosing a tile never changes the numbers on the tiles.

   ARIA: single-select, so this is a genuine radiogroup — role="radio" with
   aria-checked and a roving tabindex.

   NOTE: an earlier draft of the spec asked for aria-pressed. That was
   superseded: aria-pressed is invalid on role="radio" and the pair announces
   incorrectly. Radiogroup is the agreed contract — do not "restore"
   aria-pressed here.
   ============================================================================ */

const TILE_ICON = {
  total: 'layers',
  submitted: 'sparkle',
  underReview: 'search',
  queryRaised: 'helpCircle',
  approved: 'checkCircle',
  rejected: 'xCircle',
  overdue: 'clock',
};

const TILE_HINT = {
  total: 'All applications matching the current filters',
  submitted: 'Workflow status is Submitted — awaiting first review',
  underReview: 'Under review, including document verification and compliance check',
  queryRaised: 'Held pending applicant response',
  approved: 'Approved or partially approved',
  rejected: 'Rejected',
  overdue: SLA_DESCRIPTION,
};

export default function KpiFilterRow({
  tiles, counts, value, onChange, loading,
  unreadCount = 0, readStateReady = false, unknownCount = 0,
  unavailable = false,
}) {
  const refs = useRef([]);

  const move = (from, to) => {
    const next = (to + tiles.length) % tiles.length;
    onChange(tiles[next].key);
    refs.current[next]?.focus();
  };

  const onKeyDown = (e, index) => {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault(); move(index, index + 1); break;
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault(); move(index, index - 1); break;
      case 'Home':
        e.preventDefault(); move(index, 0); break;
      case 'End':
        e.preventDefault(); move(index, tiles.length - 1); break;
      default:
        break;
    }
  };

  /* Clicking the already-selected tile clears back to "all". */
  const select = key => onChange(key === value && key !== 'total' ? 'total' : key);

  return (
    <>
      <div
        className="kpi-row"
        role="radiogroup"
        aria-label="Filter applications by status"
      >
      {tiles.map((tile, i) => {
        const active = tile.key === value;
        return (
          <button
            key={tile.key}
            type="button"
            ref={el => { refs.current[i] = el; }}
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            title={TILE_HINT[tile.key]}
            className={`kpi-tile kpi-${tile.token}${active ? ' is-active' : ''}`}
            onClick={() => select(tile.key)}
            onKeyDown={e => onKeyDown(e, i)}
          >
            <span className="kpi-head">
              <Icon name={TILE_ICON[tile.key]} size={16} />
              <span className="kpi-label">{tile.label}</span>
            </span>
            <span className="kpi-value tnum">
              {loading || unavailable ? '—' : (counts?.[tile.key] ?? 0)}
            </span>
          </button>
        );
      })}
      </div>

      {/* Reviewer read state and data-quality notices sit outside the
          radiogroup: neither is a workflow status and neither filters. */}
      <div className="kpi-notes">
        <span className="kpi-unread" title="Applications you have not opened yet">
          <Icon name="sparkle" size={14} />
          {readStateReady
            ? <><strong className="tnum">{unreadCount}</strong> unread by you</>
            : 'Loading read state…'}
        </span>
        {unknownCount > 0 && (
          <span className="kpi-unknown" title="Status value not recognised by the workflow model">
            <Icon name="alertTriangle" size={14} />
            <strong className="tnum">{unknownCount}</strong> with an unrecognised status
          </span>
        )}
      </div>
    </>
  );
}
