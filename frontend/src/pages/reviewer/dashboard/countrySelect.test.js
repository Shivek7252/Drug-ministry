import React, { useState } from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import CountrySelect from './CountrySelect';
import {
  COUNTRIES, ALIASES, ALL_COUNTRIES, resolveCountry, canonicalName, searchCountries,
  isInvalidCountryValue, countryDisplayLabel,
} from '../../../data/countries';
import backendCountryData from '../../../../../backend/data/countries.json';

function Harness({ initial = ALL_COUNTRIES, onValue }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <CountrySelect value={value} onChange={v => { setValue(v); onValue?.(v); }} />
      <output data-testid="value">{value}</output>
    </>
  );
}

const input = () => screen.getByRole('combobox', { name: /filter by destination country/i });
const options = () => screen.getAllByRole('option');
/* Each option renders a label plus an ISO-code hint; read the label only. */
const optionNames = () => options().map(o => o.querySelector('.cs-option-label').textContent);

describe('country dataset', () => {
  test('carries the full ISO 3166-1 list, not just database values', () => {
    expect(COUNTRIES.length).toBeGreaterThan(240);
    for (const name of ['India', 'United Kingdom', 'Korea, Republic of', 'Brazil', 'Zimbabwe']) {
      expect(COUNTRIES.some(c => c.name === name)).toBe(true);
    }
  });

  test('contains no duplicate names or codes', () => {
    expect(new Set(COUNTRIES.map(c => c.name)).size).toBe(COUNTRIES.length);
    expect(new Set(COUNTRIES.map(c => c.alpha2)).size).toBe(COUNTRIES.length);
    expect(new Set(COUNTRIES.map(c => c.alpha3)).size).toBe(COUNTRIES.length);
  });

  test('every alias resolves to a real canonical entry', () => {
    for (const [alias, canonical] of Object.entries(ALIASES)) {
      expect(COUNTRIES.some(c => c.name === canonical)).toBe(true);
      expect(resolveCountry(alias)?.name).toBe(canonical);
    }
  });

  test('resolves the aliases that exist in this database', () => {
    expect(canonicalName('UK')).toBe('United Kingdom');
    expect(canonicalName('South Korea')).toBe('Korea, Republic of');
    expect(canonicalName('Japan')).toBe('Japan');
  });

  test('ISO codes resolve, in either case', () => {
    expect(resolveCountry('in')?.name).toBe('India');
    expect(resolveCountry('GBR')?.name).toBe('United Kingdom');
  });

  test('a non-country value is not force-matched', () => {
    expect(resolveCountry('X')).toBeNull();
    expect(canonicalName('X')).toBe('X');       // preserved, not invented
  });
});

describe('search', () => {
  test('matches a full name', () => {
    expect(searchCountries('India')[0].name).toBe('India');
  });

  test('matches partial input', () => {
    const names = searchCountries('slov').map(c => c.name);
    expect(names).toEqual(expect.arrayContaining(['Slovakia', 'Slovenia']));
  });

  test('is case-insensitive', () => {
    expect(searchCountries('jApAn')[0].name).toBe('Japan');
    expect(searchCountries('GHANA')[0].name).toBe('Ghana');
  });

  test('prefix matches rank above mid-string matches', () => {
    expect(searchCountries('ind')[0].name).toBe('India');   // not British Indian Ocean Territory
  });

  test('finds a country through its alias', () => {
    expect(searchCountries('south korea').map(c => c.name)).toContain('Korea, Republic of');
    expect(searchCountries('britain').map(c => c.name)).toContain('United Kingdom');
  });

  test('an unmatched query returns nothing', () => {
    expect(searchCountries('zzzzz')).toHaveLength(0);
  });
});

describe('combobox behaviour', () => {
  test('opens on focus and always offers the All reset first', () => {
    render(<Harness />);
    fireEvent.focus(input());
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(optionNames()[0]).toBe('All countries');
  });

  test('typing filters the options instantly', () => {
    render(<Harness />);
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: 'gha' } });
    // Afghanistan also contains "gha"; the prefix match ranks first.
    expect(optionNames()).toEqual(['All countries', 'Ghana', 'Afghanistan']);
  });

  test('selecting a country reports the canonical name', () => {
    const seen = [];
    render(<Harness onValue={v => seen.push(v)} />);
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: 'south korea' } });
    fireEvent.mouseDown(screen.getByRole('option', { name: /Korea, Republic of/ }));
    expect(seen).toEqual(['Korea, Republic of']);
    expect(screen.getByTestId('value')).toHaveTextContent('Korea, Republic of');
  });

  test('the clear control resets to All', () => {
    render(<Harness initial="Japan" />);
    fireEvent.click(screen.getByRole('button', { name: /clear country filter/i }));
    expect(screen.getByTestId('value')).toHaveTextContent(ALL_COUNTRIES);
  });

  test('choosing All countries clears the selection', () => {
    render(<Harness initial="Japan" />);
    fireEvent.focus(input());
    fireEvent.mouseDown(screen.getByRole('option', { name: /All countries/i }));
    expect(screen.getByTestId('value')).toHaveTextContent(ALL_COUNTRIES);
  });

  test('a country with no applications is still selectable', () => {
    // The list is the ISO set, not the database set, so this must be offered.
    render(<Harness />);
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: 'Bhutan' } });
    fireEvent.mouseDown(screen.getByRole('option', { name: /Bhutan/ }));
    expect(screen.getByTestId('value')).toHaveTextContent('Bhutan');
  });

  test('an unmatched query shows a no-match message, not an error', () => {
    render(<Harness />);
    fireEvent.focus(input());
    fireEvent.change(input(), { target: { value: 'zzzzz' } });
    expect(screen.getByText(/No country matches/i)).toBeInTheDocument();
  });
});

describe('keyboard navigation', () => {
  test('ArrowDown moves the active option and Enter selects it', () => {
    render(<Harness />);
    const el = input();
    fireEvent.focus(el);
    fireEvent.change(el, { target: { value: 'ghana' } });
    fireEvent.keyDown(el, { key: 'ArrowDown' });      // All -> Ghana
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(screen.getByTestId('value')).toHaveTextContent('Ghana');
  });

  test('Escape closes without changing the selection', () => {
    render(<Harness initial="Japan" />);
    const el = input();
    fireEvent.focus(el);
    fireEvent.keyDown(el, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByTestId('value')).toHaveTextContent('Japan');
  });

  test('Home and End jump to the ends of the list', () => {
    render(<Harness />);
    const el = input();
    fireEvent.focus(el);
    fireEvent.change(el, { target: { value: 'slov' } });
    fireEvent.keyDown(el, { key: 'End' });
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(screen.getByTestId('value')).toHaveTextContent('Slovenia');
  });

  test('exposes the ARIA combobox contract', () => {
    render(<Harness />);
    const el = input();
    expect(el).toHaveAttribute('aria-expanded', 'false');
    fireEvent.focus(el);
    expect(el).toHaveAttribute('aria-expanded', 'true');
    expect(el).toHaveAttribute('aria-controls', 'country-filter-listbox');
    expect(el.getAttribute('aria-activedescendant')).toBe('country-filter-listbox-opt-0');
    fireEvent.keyDown(el, { key: 'ArrowDown' });
    expect(el.getAttribute('aria-activedescendant')).toBe('country-filter-listbox-opt-1');
  });
});

describe('legacy invalid country values', () => {
  test('an unrecognised stored value is flagged, not treated as a country', () => {
    expect(isInvalidCountryValue('X')).toBe(true);
    expect(resolveCountry('X')).toBeNull();
  });

  test('it is labelled clearly so the records stay auditable', () => {
    expect(countryDisplayLabel('X')).toBe('Invalid country data: X');
  });

  test('valid values are labelled canonically, not flagged', () => {
    expect(isInvalidCountryValue('Japan')).toBe(false);
    expect(countryDisplayLabel('UK')).toBe('United Kingdom');
    expect(countryDisplayLabel('Japan')).toBe('Japan');
  });

  test('empty and "All" are not treated as invalid data', () => {
    expect(isInvalidCountryValue('')).toBe(false);
    expect(isInvalidCountryValue(ALL_COUNTRIES)).toBe(false);
    expect(countryDisplayLabel('')).toBe('—');
  });

  test('an invalid value is never offered as a selectable option', () => {
    expect(COUNTRIES.some(c => c.name === 'X')).toBe(false);
    expect(searchCountries('X').some(c => c.name === 'X')).toBe(false);
  });
});

describe('alias definitions cannot silently drift', () => {
  test('frontend country list matches the backend canonical data', () => {
    expect(COUNTRIES.length).toBe(backendCountryData.countries.length);
    expect(COUNTRIES.map(c => `${c.alpha2}|${c.alpha3}|${c.name}`).sort())
      .toEqual(backendCountryData.countries.map(c => `${c.alpha2}|${c.alpha3}|${c.name}`).sort());
  });

  test('frontend alias table matches the backend canonical data', () => {
    expect(ALIASES).toEqual(backendCountryData.aliases);
  });
});
