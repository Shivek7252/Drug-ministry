import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from '../../../components/ui/Icon';
import { ALL_COUNTRIES, canonicalName, searchCountries } from '../../../data/countries';

/* ============================================================================
   CountrySelect — searchable country combobox for the reviewer filter bar.

   Replaces a native <select> that listed only the countries already present in
   the database. It offers the full ISO 3166-1 list, resolves aliases, and
   follows the ARIA combobox pattern: aria-expanded / aria-controls on the
   input, aria-activedescendant tracking the highlighted option, and a listbox
   of options rather than a div soup.
   ============================================================================ */

const LISTBOX_ID = 'country-filter-listbox';
const OPTION_ID = i => `${LISTBOX_ID}-opt-${i}`;

export default function CountrySelect({ value, onChange, id = 'country-filter' }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const selectedLabel = value && value !== ALL_COUNTRIES ? canonicalName(value) : '';

  /* "All countries" always heads the list and is never filtered away, so the
     reset is reachable no matter what has been typed. */
  const options = useMemo(() => {
    const matches = searchCountries(query).map(c => ({
      key: c.alpha2, label: c.name, hint: c.alpha2, value: c.name,
    }));
    return [{ key: '__all', label: 'All countries', hint: '', value: ALL_COUNTRIES }, ...matches];
  }, [query]);

  const close = useCallback(() => { setOpen(false); setQuery(''); setActive(0); }, []);

  const commit = useCallback(option => {
    if (!option) return;
    onChange(option.value);
    close();
    inputRef.current?.focus();
  }, [onChange, close]);

  /* Close on outside click. */
  useEffect(() => {
    if (!open) return undefined;
    const onDown = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) close(); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, close]);

  /* Keep the highlighted option in view while arrowing. */
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector(`#${CSS.escape(OPTION_ID(active))}`);
    // Guarded: scrollIntoView is absent in jsdom and in some embedded engines.
    if (typeof el?.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const onKeyDown = e => {
    if (!open && ['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) {
      e.preventDefault(); setOpen(true); setActive(0); return;
    }
    if (!open) return;
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); setActive(i => Math.min(i + 1, options.length - 1)); break;
      case 'ArrowUp': e.preventDefault(); setActive(i => Math.max(i - 1, 0)); break;
      case 'Home': e.preventDefault(); setActive(0); break;
      case 'End': e.preventDefault(); setActive(options.length - 1); break;
      case 'Enter': e.preventDefault(); commit(options[active]); break;
      case 'Escape': e.preventDefault(); close(); break;
      case 'Tab': close(); break;
      default: break;
    }
  };

  return (
    <div className="cs" ref={wrapRef}>
      <div className={`cs-control${open ? ' is-open' : ''}`}>
        <Icon name="search" size={15} />
        <input
          id={id}
          ref={inputRef}
          type="text"
          role="combobox"
          className="cs-input"
          autoComplete="off"
          aria-expanded={open}
          aria-controls={LISTBOX_ID}
          aria-autocomplete="list"
          aria-activedescendant={open ? OPTION_ID(active) : undefined}
          aria-label="Filter by destination country"
          placeholder={selectedLabel || 'All countries'}
          value={open ? query : selectedLabel}
          onChange={e => { setQuery(e.target.value); setActive(0); if (!open) setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {selectedLabel && (
          <button
            type="button"
            className="cs-clear"
            aria-label="Clear country filter"
            onClick={() => { onChange(ALL_COUNTRIES); close(); inputRef.current?.focus(); }}
          >
            <Icon name="x" size={14} />
          </button>
        )}
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={15} />
      </div>

      {open && (
        <ul className="cs-list" id={LISTBOX_ID} role="listbox" ref={listRef}
            aria-label="Countries">
          {options.length === 1 && query && (
            <li className="cs-none" role="presentation">No country matches “{query}”</li>
          )}
          {options.map((o, i) => {
            const isSelected = o.value === (value || ALL_COUNTRIES);
            return (
              <li
                key={o.key}
                id={OPTION_ID(i)}
                role="option"
                aria-selected={isSelected}
                className={`cs-option${i === active ? ' is-active' : ''}${isSelected ? ' is-selected' : ''}${o.key === '__all' ? ' is-all' : ''}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={e => { e.preventDefault(); commit(o); }}
              >
                <span className="cs-option-label">{o.label}</span>
                {o.hint && <span className="cs-option-hint tnum">{o.hint}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
