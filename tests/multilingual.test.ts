// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { Header } from '../src/components/ui';
import { TripResult } from '../src/components/TripResult';
import { ManualPage } from '../src/pages/ManualPage';
import { NativeRecoveryPage } from '../src/pages/NativeRecoveryPage';
import { catalogs, getLanguage, LANGUAGE_KEY, languages, readLanguagePreference, selectLanguage, type Language } from '../src/localization';
import { presentMessage, presentConfigurationError } from '../src/localization/messages';
import { en } from '../src/localization/en';
import { getActiveTariff } from '../src/config/tariffs';
import { buildRecord } from '../src/domain/trip/buildRecord';
import { estimateFare } from '../src/domain/fare/calculator';
import { manualTripInput } from '../src/domain/trip/tripInput';

const gps = vi.hoisted(() => ({ watch: vi.fn(() => vi.fn()), wake: vi.fn(async () => null), stop: vi.fn() }));
vi.mock('../src/services/geolocation/watcher', () => ({ watchPosition: gps.watch, requestWakeLock: gps.wake, stopKnownPositionWatches: gps.stop }));
vi.mock('../src/utils/export', async original => ({ ...await original<typeof import('../src/utils/export')>(), downloadFile: vi.fn(async () => 'download-requested') }));
const choices = Object.keys(languages) as Language[];
const selector = () => screen.getByRole('combobox');
function switchTo(id: Language) { const control = selector(); control.focus(); fireEvent.change(control, { target: { value: id } }); }
function record() {
  const supplements = { airportDeparture: false, luggageItems: 0 };
  const startMs = Date.parse('2026-10-30T11:00:00Z');
  const input = manualTripInput({ startMs, distanceKm: 5, durationMin: 20, supplements });
  return buildRecord({ mode: 'manual', startMs, endMs: input.endMs, distanceM: 5000, supplements,
    estimate: estimateFare(input, getActiveTariff()) });
}
beforeEach(() => { localStorage.clear(); selectLanguage('en'); vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('language preference and complete catalogs', () => {
  it('defaults a fresh session to Darija regardless of browser language without writing storage', async () => {
    localStorage.clear(); vi.spyOn(navigator, 'language', 'get').mockReturnValue('fr-FR');
    const write = vi.spyOn(Storage.prototype, 'setItem');
    vi.resetModules(); const fresh = await import('../src/localization');
    expect(fresh.getLanguage()).toBe('aeb'); expect(document.documentElement.lang).toBe('aeb-TN');
    expect(document.documentElement.dir).toBe('rtl'); expect(write).not.toHaveBeenCalled();
  });
  it.each(choices)('persists deliberate %s and reads it in a new module session', async id => {
    selectLanguage(id); expect(localStorage.getItem(LANGUAGE_KEY)).toBe(id);
    vi.resetModules(); const fresh = await import('../src/localization'); expect(fresh.getLanguage()).toBe(id);
    expect(document.documentElement.lang).toBe(languages[id].lang); expect(document.documentElement.dir).toBe(languages[id].dir);
  });
  it.each([null, '', 'de', 'ar-TN', '"en"', '{}', '__proto__', 'toString'])('rejects unsupported or malformed preference %s', value => {
    if (value === null) localStorage.removeItem(LANGUAGE_KEY); else localStorage.setItem(LANGUAGE_KEY, value);
    expect(readLanguagePreference()).toBe('aeb');
  });
  it('handles storage read/write failures while retaining a deliberate session choice', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw Error('synthetic denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw Error('synthetic quota'); });
    expect(readLanguagePreference()).toBe('aeb'); expect(() => selectLanguage('fr')).not.toThrow();
    expect(getLanguage()).toBe('fr'); expect(document.documentElement.lang).toBe('fr');
  });
  it('has exact recursive catalog coverage and matching dynamic argument arity with every value retained', () => {
    function check(reference: unknown, translated: unknown, path: string) {
      if (typeof reference === 'string') { expect(typeof translated, path).toBe('string'); expect(translated, path).not.toBe(''); return; }
      if (typeof reference === 'function') {
        expect(typeof translated, path).toBe('function'); const fn = translated as (...args: unknown[]) => string;
        expect(fn.length, path).toBe(reference.length);
        if (path.endsWith('initialNightExplanation') || path.endsWith('retainedData')) {
          expect(fn(true), path).not.toBe(fn(false)); return;
        }
        const args = Array.from({ length: fn.length }, (_, i) => `VALUE${i}`);
        const output = fn(...args); expect(output, path).not.toContain('undefined');
        for (const value of args) expect(output, path).toContain(value);
        return;
      }
      expect(Object.keys(translated as object).sort(), path).toEqual(Object.keys(reference as object).sort());
      for (const [key, value] of Object.entries(reference as object)) check(value, (translated as Record<string, unknown>)[key], `${path}.${key}`);
    }
    for (const id of choices) check(en, catalogs[id], id);
  });
  it.each(choices)('translates recognized messages in %s, preserving unknown historical text and diagnostic fields', id => {
    selectLanguage(id);
    expect(presentMessage('Distance is required.')).toBe(catalogs[id].validation.distanceRequired);
    expect(presentMessage(en.rideFeedback.androidRecoveryStorageCouldNotBe)).toBe(catalogs[id].rideFeedback.androidRecoveryStorageCouldNotBe);
    expect(presentMessage('Unknown historical <text>')).toBe('Unknown historical <text>');
    expect(presentConfigurationError('waitingStepSeconds must be finite and > 0')).toContain('waitingStepSeconds');
  });
});

describe('switching without resetting work', () => {
  it('keeps Manual values, field associations, errors and selector focus through all choices', () => {
    render(createElement(ManualPage, { onBack: vi.fn(), onResult: vi.fn() }));
    const distance = screen.getByLabelText('Distance (km)') as HTMLInputElement;
    const duration = screen.getByLabelText('Total duration (min)') as HTMLInputElement;
    fireEvent.change(distance, { target: { value: '501' } }); fireEvent.change(duration, { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }));
    for (const id of choices) {
      switchTo(id); expect(document.activeElement).toBe(selector());
      expect(distance.value).toBe('501'); expect(duration.value).toBe('20');
      expect(screen.getByRole('link', { name: catalogs[id].validation.distanceBounds })).toBeTruthy();
      expect(document.getElementById(distance.getAttribute('aria-describedby')!)?.textContent).toBe(catalogs[id].validation.distanceBounds);
      expect(document.documentElement.dir).toBe(languages[id].dir);
    }
  });
  it('retains an unsaved meter edit, open card preview and optional comparison without saving or repricing', () => {
    const trip = record(); const before = JSON.stringify(trip); const save = vi.fn();
    render(createElement('main', null, createElement(Header, { title: 'Synthetic result' }), createElement(TripResult, { trip, isSaved: true, onSave: save })));
    const meter = screen.getByLabelText("Driver's meter") as HTMLInputElement;
    fireEvent.change(meter, { target: { value: '9.123' } }); fireEvent.click(screen.getByRole('button', { name: catalogs.en.card.open }));
    fireEvent.click(screen.getByRole('checkbox', { name: catalogs.en.card.includeMeter }));
    for (const id of choices) {
      switchTo(id); expect(meter.value).toBe('9.123'); expect((screen.getByRole('checkbox', {name:catalogs[id].card.includeMeter}) as HTMLInputElement).checked).toBe(true);
      expect(screen.getByRole('region', { name: catalogs[id].card.title })).toBeTruthy();
      expect(document.activeElement).toBe(selector());
    }
    expect(JSON.stringify(trip)).toBe(before); expect(save).not.toHaveBeenCalled();
  });
  it('does not restart a watcher or rewrite active data during live language switching', () => {
    render(createElement(App)); fireEvent.click(screen.getByRole('button', { name: 'START RIDE' }));
    const raw = localStorage.getItem('taxi-check.active-ride');
    localStorage.setItem('taxi-check.native-recovery', '1'); const write = vi.spyOn(Storage.prototype, 'setItem');
    for (const id of choices) { switchTo(id); expect(screen.getByRole('heading', { name: catalogs[id].live.rideInProgress })).toBeTruthy(); }
    expect(gps.watch).toHaveBeenCalledTimes(1); expect(localStorage.getItem('taxi-check.active-ride')).toBe(raw);
    expect(localStorage.getItem('taxi-check.native-recovery')).toBe('1');
    expect(write.mock.calls.every(([key]) => key === LANGUAGE_KEY)).toBe(true);
  });
  it('makes recovery switching available without touching the retained record or recovery marker', () => {
    const raw = JSON.stringify({ tariffId: 'unknown-synthetic', startMs: Date.now()-60000, samples: [], supplements: { airportDeparture: false, luggageItems: 0 }, gpsStatus: 'waiting', extra: 'keep' }, null, 2);
    localStorage.setItem('taxi-check.active-ride', raw); localStorage.setItem('taxi-check.native-recovery', '1');
    render(createElement(App));
    for (const id of choices) { switchTo(id); expect(screen.getByRole('heading', { name: catalogs[id].rideRecovery.rideNeedsRecovery })).toBeTruthy(); }
    expect(localStorage.getItem('taxi-check.active-ride')).toBe(raw); expect(localStorage.getItem('taxi-check.native-recovery')).toBe('1'); expect(gps.watch).not.toHaveBeenCalled();
  });
  it('keeps native acknowledgment a separate explicit action while language changes', () => {
    const acknowledge = vi.fn(); render(createElement(NativeRecoveryPage, { error: en.rideFeedback.androidRecoveryStorageCouldNotBe, onAcknowledge: acknowledge, onHome: vi.fn() }));
    for (const id of choices) { switchTo(id); expect(screen.getByRole('alert').textContent).toBe(catalogs[id].rideFeedback.androidRecoveryStorageCouldNotBe); }
    expect(acknowledge).not.toHaveBeenCalled();
  });
  it('keeps ordinary clock rerenders from announcing a language or changing the selected preference', async () => {
    render(createElement(App)); fireEvent.click(screen.getByRole('button', { name: 'START RIDE' }));
    switchTo('aeb'); const status = screen.getByRole('status'); const mutations: MutationRecord[] = [];
    const observer = new MutationObserver(records => mutations.push(...records)); observer.observe(status, { subtree: true, childList: true, characterData: true });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1050)); }); observer.disconnect();
    expect(mutations).toHaveLength(0); expect(document.activeElement).toBe(selector()); expect(gps.watch).toHaveBeenCalledTimes(1);
  });
});
