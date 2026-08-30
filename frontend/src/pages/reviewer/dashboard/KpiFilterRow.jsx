import React, { useRef } from 'react';
import Icon from '../../../components/ui/Icon';
import { OVERDUE_DAYS } from './aggregations';

/* ============================================================================
   KpiFilterRow — the KPI strip is the primary filter affordance.

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
  submitted: 'Awaiting first review',
  underReview: 'Under review, including document verification and compliance check',
  queryRaised: 'Held pending applicant response',
  approved: 'Approved or partially approved',
  rejected: 'Rejected',
  overdue: `Submitted or in review (including document verification and compliance check) for more than ${OVERDUE_DAYS} days`,
};

function Delta({ delta }) {
  if (!delta || delta.delta === 0) {
    return <span className="kpi-delta is-flat tnum">No change this week</span>;
  }
  const up = delta.delta > 0;
  return (
    <span className={`kpi-delta ${up ? 'is-up' : 'is-down'} tnum`}>
      <Icon name={up ? 'arrowUp' : 'arrowDown'} size={12} />
      {up ? '+' : ''}{delta.delta} this week
    </span>
  );
}

export default function KpiFilterRow({ tiles, counts, deltas, value, onChange, loading }) {
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
            <span className="kpi-figures">
              <span className="kpi-value tnum">
                {loading ? '—' : (counts?.[tile.key] ?? 0)}
              </span>
              {!loading && <Delta delta={deltas?.[tile.key]} />}
            </span>
          </button>
        );
      })}
    </div>
  );
}
