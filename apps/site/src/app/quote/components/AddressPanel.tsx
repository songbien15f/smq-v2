'use client';

import { useEffect, useState } from 'react';
import { AU_STATES, type GuestPlaceSuggestion, type GuestSuburb } from '@sq/contracts';
import type { GuestSite, StateCode } from '@sq/core/domain';
import { createPlacesClient, searchSuburbs, type SearchResult } from '../addressSearch';
import { setEstimate, setSite, useGuest } from '../store';
import { SearchCombobox, type ComboOption } from './SearchCombobox';
import { IconPin, IconSearch } from './icons';

/**
 * ①'s address field (plan G-a2 S4): **one box**, and the address must come from the suggestions.
 *
 * The customer's requirement is a single "Street number and name" field with no separate suburb,
 * state and postcode boxes, and the address has to be picked from Google's list rather than typed.
 * So:
 *
 * 1. Typing searches Google through the Guest proxy. A pick fills every part at once.
 * 2. The pick is then shown as one read-only line with **Change** beside it — the four parts are
 *    there to read, not to edit.
 * 3. If Places is off, capped, rate-limited or failing, the fallback is the price book's suburb list,
 *    exactly as v1 had it. That path is the only way to an address without Google, and the page says
 *    so. Manual suburb/state/postcode entry is the last resort behind it, because the suburb list can
 *    be down too and a lead with no address at all is worse than a half-typed one.
 */

type Mode = 'places' | 'suburb' | 'manual';

interface Manual {
  suburb: string;
  state: StateCode | '';
  postcode: string;
}

const EMPTY_MANUAL: Manual = { suburb: '', state: '', postcode: '' };

/*
 * Page-lifetime memory, kept outside React so leaving and reopening the step does not ask the server
 * again: one Places client (so a live session is reused), and whether Places has already failed.
 */
const places = createPlacesClient();
let placesUnavailable = false;

const isState = (value: string): value is StateCode => (AU_STATES as readonly string[]).includes(value);

/** `2 George St, Brisbane City QLD 4000` — the parts Google gave, joined for reading. */
function addressLine(site: GuestSite): string {
  const place = `${site.suburb} ${site.state} ${site.postcode}`;
  return site.street === undefined || site.street === '' ? place : `${site.street}, ${place}`;
}

const placesSearch = async (q: string, signal: AbortSignal): Promise<SearchResult<ComboOption<GuestPlaceSuggestion>[]>> => {
  const result = await places.suggest(q, signal);
  if (!result.ok) return result;
  return {
    ok: true,
    data: result.data.map((s) => ({ key: s.placeId, primary: s.primary, secondary: s.secondary, value: s })),
  };
};

const suburbSearch = async (q: string, signal: AbortSignal): Promise<SearchResult<ComboOption<GuestSuburb>[]>> => {
  const result = await searchSuburbs(q, signal);
  if (!result.ok) return result;
  return {
    ok: true,
    data: result.data.map((s) => ({
      key: `${s.suburb}|${s.state}|${s.postcode}`,
      primary: s.suburb,
      // Richmond is in six states: the state is what tells them apart.
      secondary: `${s.state} ${s.postcode}`,
      value: s,
    })),
  };
};

/**
 * The address field, writing the picked site and its estimated region into the store.
 *
 * The region goes to the store rather than to a callback so step ②'s "Design check" can talk about
 * the same estimate step ① showed, without the frame threading it through two components.
 */
export function AddressPanel() {
  const site = useGuest((s) => s.design?.site);
  const [mode, setMode] = useState<Mode>(placesUnavailable ? 'suburb' : 'places');
  const [notice, setNotice] = useState<string | null>(
    placesUnavailable ? 'Address search is unavailable — pick your suburb instead.' : null,
  );
  const [editing, setEditing] = useState(site === undefined);
  const [pickError, setPickError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const [manual, setManual] = useState<Manual>(EMPTY_MANUAL);
  const [manualTouched, setManualTouched] = useState(false);
  /*
   * A box to focus once the render that draws it has committed. `setTimeout`, not
   * `requestAnimationFrame`: rAF is never scheduled in the browser automation this project's checks
   * run under, so a focus queued on it never happened.
   */
  const [focusNext, setFocusNext] = useState<string | null>(null);
  useEffect(() => {
    if (focusNext === null) return;
    const id = focusNext;
    const timer = setTimeout(() => document.getElementById(id)?.focus(), 0);
    setFocusNext(null);
    return () => clearTimeout(timer);
  }, [focusNext]);

  const fallBack = (message: string) => {
    placesUnavailable = true;
    setMode('suburb');
    setNotice(message);
    setFocusNext('g-suburb-search');
  };

  const pickPlace = async (option: ComboOption<GuestPlaceSuggestion>) => {
    setPickError(null);
    setAnnounce('Looking up the address…');
    const result = await places.details(option.value.placeId);
    if (!result.ok) {
      setAnnounce('');
      if (result.fallback) fallBack(result.message);
      else setPickError(result.message);
      return;
    }
    if (result.data === null) {
      setAnnounce('');
      setPickError('That place is not a street address in Australia we can use. Try another, or pick your suburb instead.');
      return;
    }
    const d = result.data;
    const next: GuestSite = {
      suburb: d.suburb,
      state: d.state,
      postcode: d.postcode,
      ...(d.street === undefined || d.street === '' ? {} : { street: d.street }),
      placeId: d.placeId,
    };
    setSite(next);
    setEstimate(d.windRegion ?? null);
    setEditing(false);
    setPickError(null);
    setAnnounce(`${addressLine(next)} selected.`);
  };

  const pickSuburb = (option: ComboOption<GuestSuburb>) => {
    const s = option.value;
    if (!isState(s.state)) {
      setPickError('That suburb has a state we do not serve. Pick another, or check your postcode.');
      return;
    }
    const next: GuestSite = { suburb: s.suburb, state: s.state, postcode: s.postcode };
    setSite(next);
    // The suburb list carries no coordinates, so no estimate: the page says "confirmed in your quote".
    setEstimate(null);
    setEditing(false);
    setPickError(null);
    setAnnounce(`${s.suburb}, ${s.state} ${s.postcode} selected.`);
  };

  /** The last resort: suburb, state and postcode typed by hand. No place ID, no estimate. */
  const commitManual = () => {
    const postcode = manual.postcode.trim();
    if (manual.suburb.trim() === '' || manual.state === '' || !/^\d{4}$/.test(postcode)) {
      setManualTouched(true);
      return;
    }
    setSite({ suburb: manual.suburb.trim().replace(/\s+/g, ' '), state: manual.state, postcode });
    setEstimate(null);
    setEditing(false);
    setAnnounce('Address selected.');
  };

  const manualErrors = {
    suburb: manual.suburb.trim() === '' ? 'Enter the suburb or town.' : undefined,
    state: manual.state === '' ? 'Choose the state.' : undefined,
    postcode: /^\d{4}$/.test(manual.postcode.trim()) ? undefined : 'Enter the four-digit postcode.',
  };

  if (site !== undefined && !editing) {
    return (
      <div className="g-address">
        <div className="g-address-chosen">
          <span className="g-address-chosen-icon" aria-hidden="true">
            <IconPin />
          </span>
          <p className="g-address-chosen-text">
            <span className="g-sr-only">Address selected: </span>
            {addressLine(site)}
          </p>
          <button
            type="button"
            className="g-btn g-btn-ghost"
            onClick={() => {
              setEditing(true);
              setPickError(null);
              setFocusNext(mode === 'places' ? 'g-address-search' : 'g-suburb-search');
            }}
          >
            Change
          </button>
        </div>
        <p className="g-sr-only" role="status" aria-live="polite">
          {announce}
        </p>
      </div>
    );
  }

  return (
    <div className="g-address">
      <div className="g-address-search">
        {notice === null ? null : (
          <p className="g-notice" role="status">
            {notice}
          </p>
        )}

        {mode === 'places' ? (
          <SearchCombobox<GuestPlaceSuggestion>
            key="places"
            id="g-address-search"
            label="Street number and name"
            hint="Start typing, then pick your address from the list."
            placeholder="e.g. 2 George St, Brisbane City"
            minChars={3}
            search={placesSearch}
            onPick={(option) => void pickPlace(option)}
            onFallback={fallBack}
            footer={<p className="g-combo-attribution">Google Maps</p>}
          />
        ) : mode === 'suburb' ? (
          <SearchCombobox<GuestSuburb>
            key="suburb"
            id="g-suburb-search"
            label="Suburb or postcode"
            hint="Type the first letters of the suburb, or the postcode."
            placeholder="e.g. Brisbane City or 4000"
            minChars={2}
            search={suburbSearch}
            onPick={pickSuburb}
            onFallback={(message) => {
              setNotice(message);
              setMode('manual');
              setFocusNext('g-suburb');
            }}
          />
        ) : (
          <fieldset className="g-fields">
            <legend className="g-fields-legend">Where will it be built?</legend>
            <div className="g-field g-field-wide">
              <label className="g-label" htmlFor="g-suburb">
                Suburb or town
              </label>
              <input
                id="g-suburb"
                className="g-input"
                type="text"
                autoComplete="address-level2"
                maxLength={80}
                required
                aria-invalid={manualTouched && manualErrors.suburb !== undefined}
                value={manual.suburb}
                onChange={(e) => setManual({ ...manual, suburb: e.target.value })}
                onBlur={() => setManualTouched(true)}
              />
              {manualTouched && manualErrors.suburb !== undefined ? (
                <p className="g-field-error">{manualErrors.suburb}</p>
              ) : null}
            </div>
            <div className="g-field">
              <label className="g-label" htmlFor="g-state">
                State
              </label>
              <select
                id="g-state"
                className="g-input g-select"
                autoComplete="address-level1"
                required
                aria-invalid={manualTouched && manualErrors.state !== undefined}
                value={manual.state}
                onChange={(e) => setManual({ ...manual, state: isState(e.target.value) ? e.target.value : '' })}
                onBlur={() => setManualTouched(true)}
              >
                <option value="">Choose…</option>
                {AU_STATES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              {manualTouched && manualErrors.state !== undefined ? (
                <p className="g-field-error">{manualErrors.state}</p>
              ) : null}
            </div>
            <div className="g-field">
              <label className="g-label" htmlFor="g-postcode">
                Postcode
              </label>
              <input
                id="g-postcode"
                className="g-input"
                type="text"
                inputMode="numeric"
                autoComplete="postal-code"
                maxLength={4}
                required
                aria-invalid={manualTouched && manualErrors.postcode !== undefined}
                value={manual.postcode}
                onChange={(e) => setManual({ ...manual, postcode: e.target.value.replace(/\D/g, '').slice(0, 4) })}
                onBlur={() => setManualTouched(true)}
              />
              {manualTouched && manualErrors.postcode !== undefined ? (
                <p className="g-field-error">{manualErrors.postcode}</p>
              ) : null}
            </div>
            <button type="button" className="g-btn g-btn-outline" onClick={commitManual}>
              Use this address
            </button>
          </fieldset>
        )}

        {pickError === null ? null : (
          <p className="g-field-error" role="alert">
            {pickError}
          </p>
        )}

        {mode === 'places' ? (
          <button
            type="button"
            className="g-btn g-btn-ghost"
            onClick={() => {
              setPickError(null);
              setMode('suburb');
              setFocusNext('g-suburb-search');
            }}
          >
            <IconSearch />
            Can&rsquo;t find it? Pick your suburb instead
          </button>
        ) : null}
      </div>
    </div>
  );
}
