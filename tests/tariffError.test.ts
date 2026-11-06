import { catalogs, selectLanguage, type Language } from '../src/localization';
// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { ACTIVE_TARIFF_ID } from '../src/config/tariffs';
import { snapshotTripCard } from '../src/utils/tripCard';
import type { TripRecord } from '../src/domain/trip/types';

const fixtures = vi.hoisted(() => ({ mode: 'invalid-active', native: false, failLookup: false,
  watch: vi.fn(() => vi.fn()), wake: vi.fn(async () => null), stop: vi.fn(), list: vi.fn(), save: vi.fn(), remove: vi.fn(), estimate: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => fixtures.native, getPlatform: () => fixtures.native ? 'android' : 'web' } }));
vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn(async () => ({ remove: vi.fn() })), minimizeApp: vi.fn() } }));
vi.mock('../src/config/tariffs', async original => {
  const actual = await original<typeof import('../src/config/tariffs')>();
  const { validateTariff } = await import('../src/domain/fare/tariff');
  const lookup = (id: string) => {
    if (fixtures.failLookup) throw new Error('Synthetic unrelated lookup failure');
    if (id === 'invalid-recorded') return { ...actual.TARIFFS[0], id, nightStart: '24:00' };
    if (id === 'known-history') return { ...actual.TARIFFS[0], id, name: 'Historical fixture', initialFare: 1234 };
    if (id !== actual.ACTIVE_TARIFF_ID) return undefined;
    if (fixtures.mode === 'missing-active') return undefined;
    return fixtures.mode === 'invalid-active' ? { ...actual.TARIFFS[0], waitingStepSeconds: Infinity } : actual.TARIFFS[0];
  };
  return { ...actual, getTariff: lookup, getActiveTariff: () => {
    const tariff = lookup(actual.ACTIVE_TARIFF_ID);
    if (!tariff) throw new Error(`Active tariff "${actual.ACTIVE_TARIFF_ID}" not found`);
    const errors = validateTariff(tariff);
    if (errors.length) throw new Error(`Invalid tariff ${tariff.id}: ${errors.join('; ')}`);
    return tariff;
  } };
});
vi.mock('../src/domain/fare/calculator', async original => {
  const actual = await original<typeof import('../src/domain/fare/calculator')>();
  return { ...actual, estimateFare: (...args: Parameters<typeof actual.estimateFare>) => { fixtures.estimate(); return actual.estimateFare(...args); } };
});
vi.mock('../src/services/geolocation/watcher', () => ({ watchPosition: fixtures.watch, requestWakeLock: fixtures.wake, stopKnownPositionWatches: fixtures.stop }));
vi.mock('../src/storage/tripStore', () => ({ tripStore: { list: fixtures.list, save: fixtures.save, remove: fixtures.remove } }));

function completed(tariffId = ACTIVE_TARIFF_ID): TripRecord {
  return { id: 'synthetic-completed', mode: 'manual', startMs: Date.now() - 60000, endMs: Date.now(), durationS: 60,
    distanceM: 500, movingTimeS: 60, slowTimeS: 0, startCoords: { lat: 36.8, lon: 10.1 }, endCoords: null,
    tariffId, strategyId: 'historical-synthetic', meter: null, diff: null, diffPct: null,
    supplements: { airportDeparture: false, luggageItems: 0 }, confidence: .35, warnings: [],
    estimate: { best: 7777, low: 7000, high: 8000, breakdown: { initialFare: 900, distanceCharge: 6877,
      waitingCharge: 0, nightSurcharge: 0, airportSupplement: 0, luggageSupplement: 0, total: 7777 } } };
}
function active(tariffId = ACTIVE_TARIFF_ID) {
  return JSON.stringify({ tariffId, startMs: Date.now() - 60000, samples: [], supplements: { airportDeparture: false, luggageItems: 0 },
    gpsStatus: 'waiting', originalExtra: 'keep' }, null, 2);
}
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); fixtures.mode = 'invalid-active'; fixtures.native = false; fixtures.failLookup = false;
  fixtures.list.mockResolvedValue([completed()]); fixtures.save.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

beforeEach(() => { selectLanguage('en'); });

describe('configuration failure boundary', () => {
  it('keeps selection available in invalid configuration and carries it into saved History/result/export', async () => {
    const raw = active(); localStorage.setItem('taxi-check.active-ride', raw); localStorage.setItem('taxi-check.native-recovery', '1');
    render(createElement(App));
    for (const id of ['aeb','ar','fr','en'] as Language[]) {
      fireEvent.change(screen.getByRole('combobox'), { target: { value: id } });
      expect(screen.getByRole('heading', { name: catalogs[id].tariffError.tariffConfigurationError })).toBeTruthy();
    }
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'fr' } });
    fireEvent.click(screen.getByRole('button', { name: catalogs.fr.app.tripHistory }));
    fireEvent.click(await screen.findByText('Estimation : 7.8 TND'));
    fireEvent.click(screen.getByRole('button', { name: catalogs.fr.card.open }));
    expect(screen.getByRole('heading', { name: catalogs.fr.card.title })).toBeTruthy();
    expect(localStorage.getItem('taxi-check.active-ride')).toBe(raw); expect(localStorage.getItem('taxi-check.native-recovery')).toBe('1');
    expect(fixtures.watch).not.toHaveBeenCalled(); expect(fixtures.estimate).not.toHaveBeenCalled();
  });
  it('keeps empty-history guidance honest when new estimates are unavailable', async () => {
    fixtures.list.mockResolvedValue([]); render(createElement(App));
    fireEvent.click(screen.getByRole('button', { name: 'Trip history' }));
    expect(await screen.findByText(/Go back for tariff configuration details/)).toBeTruthy();
    expect(screen.queryByText(/Return to Home to start/)).toBeNull();
  });
  it('renders a focused configuration error instead of the malformed getter escaping Home render', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(createElement(App));
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Tariff configuration error' }));
    expect(screen.getByRole('alert').textContent).toContain('waitingStepSeconds');
    expect(screen.queryByRole('button', { name: 'START RIDE' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Calculate' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Retry/ })).toBeNull();
    expect(fixtures.estimate).not.toHaveBeenCalled(); expect(fixtures.watch).not.toHaveBeenCalled();
  });

  it('keeps saved card preview independent of invalid active metadata', async () => {
    const record = completed(); const before = JSON.stringify(record); fixtures.list.mockResolvedValue([record]);
    render(createElement(App)); fireEvent.click(screen.getByRole('button', { name: 'Trip history' }));
    fireEvent.click(await screen.findByText('Estimated: 7.8 TND'));
    expect(screen.getByText('≈ 7.777 TND')).toBeTruthy();
    expect(screen.getByText(/Recorded tariff configuration is invalid/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: catalogs.en.card.open }));
    expect(screen.getByRole('heading', { name: catalogs.en.card.title })).toBeTruthy();
    expect(JSON.stringify(snapshotTripCard(record,'en',{comparison:false,details:false}))).toContain('7.777');
    expect(JSON.stringify(record)).toBe(before); expect(fixtures.save).not.toHaveBeenCalled(); expect(fixtures.remove).not.toHaveBeenCalled();
    expect(fixtures.estimate).not.toHaveBeenCalled(); expect(fixtures.watch).not.toHaveBeenCalled();
  });

  it.each([[false, false], [false, true], [true, false], [true, true]])('retains active bytes and existing guard through navigation/remount (native=%s guard=%s)', async (native, guard) => {
    fixtures.native = native; const raw = active(); localStorage.setItem('taxi-check.active-ride', raw);
    if (guard) localStorage.setItem('taxi-check.native-recovery', '1');
    const write = vi.spyOn(Storage.prototype, 'setItem'); const remove = vi.spyOn(Storage.prototype, 'removeItem');
    const first = render(createElement(App));
    fireEvent.click(screen.getByRole('button', { name: 'Trip history' })); await screen.findByText('Estimated: 7.8 TND');
    fireEvent.click(screen.getByRole('button', { name: 'Back' })); first.unmount(); render(createElement(App));
    expect(screen.getByRole('heading', { name: 'Tariff configuration error' })).toBeTruthy();
    expect(localStorage.getItem('taxi-check.active-ride')).toBe(raw);
    expect(localStorage.getItem('taxi-check.native-recovery')).toBe(guard ? '1' : null);
    expect(write).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
    expect(fixtures.watch).not.toHaveBeenCalled(); expect(fixtures.wake).not.toHaveBeenCalled(); expect(fixtures.estimate).not.toHaveBeenCalled();
  });

  it('blocks a known malformed restored definition before hook computation even when the default is valid', () => {
    fixtures.mode = 'valid'; const raw = active('invalid-recorded'); localStorage.setItem('taxi-check.active-ride', raw);
    render(createElement(App)); expect(screen.getByRole('alert').textContent).toContain('24:00');
    expect(localStorage.getItem('taxi-check.active-ride')).toBe(raw);
    expect(fixtures.estimate).not.toHaveBeenCalled(); expect(fixtures.watch).not.toHaveBeenCalled();
  });

  it('keeps a missing recorded ID in existing recovery rather than labeling it malformed or substituting a tariff', () => {
    fixtures.mode = 'valid'; const raw = active('missing-recorded'); localStorage.setItem('taxi-check.active-ride', raw);
    render(createElement(App)); expect(screen.getByRole('heading', { name: 'Ride needs recovery' })).toBeTruthy();
    expect(localStorage.getItem('taxi-check.active-ride')).toBe(raw); expect(fixtures.watch).not.toHaveBeenCalled();
  });

  it.each(['missing-recorded', 'known-history'])('preserves saved estimate and distinct historical metadata state for %s', async id => {
    fixtures.list.mockResolvedValue([completed(id)]); render(createElement(App));
    fireEvent.click(screen.getByRole('button', { name: 'Trip history' })); fireEvent.click(await screen.findByText('Estimated: 7.8 TND'));
    expect(screen.getByText('≈ 7.777 TND')).toBeTruthy();
    expect(screen.getByText(id === 'known-history' ? 'Historical fixture' : /Tariff metadata is unavailable/)).toBeTruthy();
    expect(fixtures.estimate).not.toHaveBeenCalled();
  });

  it('handles a missing default definition as configuration unavailable, not historical metadata absence', () => {
    fixtures.mode = 'missing-active'; render(createElement(App));
    expect(screen.getByRole('alert').textContent).toContain('Active tariff definition is unavailable');
    expect(fixtures.watch).not.toHaveBeenCalled();
  });

  it('does not catch and mislabel unrelated lookup/programming errors', () => {
    fixtures.failLookup = true; vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(createElement(App))).toThrow('Synthetic unrelated lookup failure');
  });

  it('allows a valid legally unverified default through normal Manual/save and live-start paths', async () => {
    fixtures.mode = 'valid'; const first = render(createElement(App));
    expect((screen.getByRole('button', { name: 'START RIDE' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Manual calculator' }));
    fireEvent.change(screen.getByLabelText('Distance (km)'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Total duration (min)'), { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }));
    expect(screen.getByRole('heading', { name: 'Trip complete' })).toBeTruthy(); expect(fixtures.estimate).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Save to history' })); await waitFor(() => expect(fixtures.save).toHaveBeenCalledTimes(1));
    first.unmount(); render(createElement(App)); fireEvent.click(screen.getByRole('button', { name: 'START RIDE' }));
    expect(screen.getByRole('heading', { name: 'Ride in progress' })).toBeTruthy(); expect(fixtures.watch).toHaveBeenCalledTimes(1);
  });
});
