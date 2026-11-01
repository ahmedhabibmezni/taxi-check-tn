// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useLiveRide } from '../src/hooks/useLiveRide';
import { loadActiveRide } from '../src/storage/activeRide';
import { App } from '../src/App';
import { catalogs, selectLanguage, type Language } from '../src/localization';
import { getActiveTariff } from '../src/config/tariffs';
import type { TripRecord } from '../src/domain/trip/types';

const fixtures = vi.hoisted(() => ({ watch: vi.fn(() => vi.fn()), native: false, stop: vi.fn(),
  list: vi.fn(), save: vi.fn(), remove: vi.fn(), export: vi.fn(async (_name: string, _content: string, _type: string) => 'download-requested' as const) }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => fixtures.native } }));
vi.mock('../src/services/geolocation/watcher', () => ({ watchPosition: fixtures.watch,
  requestWakeLock: vi.fn(async () => null), stopKnownPositionWatches: fixtures.stop }));
vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn(async () => ({ remove: vi.fn() })), minimizeApp: vi.fn() } }));
vi.mock('../src/storage/tripStore', () => ({ tripStore: { list: fixtures.list, save: fixtures.save, remove: fixtures.remove } }));
vi.mock('../src/utils/export', async original => ({ ...await original<typeof import('../src/utils/export')>(), downloadFile: fixtures.export }));
const key = 'taxi-check.active-ride';
const guard = 'taxi-check.native-recovery';
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); fixtures.native = false; selectLanguage('en'); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it.each(['', '{', 'null', '42', '[]', '{"samples":"unsupported"}'])('preserves present malformed storage instead of replacing it (%j)', raw => {
  localStorage.setItem(key, raw);
  const { result } = renderHook(() => useLiveRide());
  act(() => result.current.start({ airportDeparture: false, luggageItems: 0 }));
  expect(localStorage.getItem(key)).toBe(raw);
  expect(result.current.recovery).not.toBeNull();
  expect(result.current.live).toBeNull();
  expect(fixtures.watch).not.toHaveBeenCalled();
});

it('blocks recording when active storage cannot be read', () => {
  const get = Storage.prototype.getItem;
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, name) {
    if (name === key) throw new Error('Synthetic access failure');
    return get.call(this, name);
  });
  const write = vi.spyOn(Storage.prototype, 'setItem');
  const { result } = renderHook(() => useLiveRide());
  act(() => result.current.start({ airportDeparture: false, luggageItems: 0 }));
  expect(fixtures.watch).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
  expect(result.current.recovery).not.toBeNull();
});

function compatible() {
  return { tariffId: getActiveTariff().id, startMs: Date.now() - 60000, samples: [],
    supplements: { airportDeparture: false, luggageItems: 0 }, gpsStatus: 'waiting' };
}

it('only classifies a missing key as absent and permits a normal explicit Start', () => {
  expect(loadActiveRide()).toEqual({ status: 'absent' });
  const { result } = renderHook(() => useLiveRide());
  expect(result.current.recovery).toBeNull(); expect(fixtures.watch).not.toHaveBeenCalled();
  act(() => result.current.start({ airportDeparture: false, luggageItems: 0 }));
  expect(fixtures.watch).toHaveBeenCalledTimes(1);
  expect(result.current.ride?.tariffId).toBe(getActiveTariff().id);
});

it.each([false, true])('accepts compatible current/legacy status and extension fields without rewriting them (legacy=%s)', legacy => {
  const record: Record<string, unknown> = { ...compatible(), samples: [{}], originalExtra: { version: 'preserve' } };
  if (legacy) delete record.gpsStatus;
  const raw = JSON.stringify(record, null, 2); localStorage.setItem(key, raw);
  const read = loadActiveRide();
  expect(read.status).toBe('valid');
  if (read.status === 'valid') expect(read.ride.gpsStatus).toBe('waiting');
  const { result } = renderHook(() => useLiveRide());
  expect(result.current.recovery).toBeNull(); expect(result.current.live).not.toBeNull();
  expect(fixtures.watch).toHaveBeenCalledTimes(1);
  expect(localStorage.getItem(key)).toBe(raw);
});

it('keeps a compatible legacy record with no tariff ID on existing tariff recovery', () => {
  const { tariffId: _id, ...record } = compatible();
  localStorage.setItem(key, JSON.stringify(record));
  expect(loadActiveRide().status).toBe('valid');
  const { result } = renderHook(() => useLiveRide());
  expect(result.current.recovery?.kind).toBe('tariff');
  expect(fixtures.watch).not.toHaveBeenCalled();
});

it.each([
  { startMs: null }, { startMs: Date.now() + 86_400_000 }, { samples: [null] }, { samples: 'unsupported' },
  { supplements: null }, { supplements: { airportDeparture: 'yes', luggageItems: 0 } },
  { supplements: { airportDeparture: false, luggageItems: -1 } }, { gpsStatus: 'future-status' }, { gpsStatus: null },
])('blocks unsupported base data without changing bytes (%j)', override => {
  const raw = JSON.stringify({ ...compatible(), ...override }, null, 2); localStorage.setItem(key, raw);
  expect(loadActiveRide()).toEqual({ status: 'invalid' });
  const { result, unmount } = renderHook(() => useLiveRide());
  act(() => {
    result.current.start({ airportDeparture: true, luggageItems: 1 });
    result.current.cancel(); result.current.setSupplements({ airportDeparture: true, luggageItems: 2 });
    expect(result.current.end()).toBeNull();
  });
  unmount();
  const second = renderHook(() => useLiveRide());
  expect(second.result.current.recovery).toEqual({ kind: 'storage', reason: 'invalid' });
  expect(localStorage.getItem(key)).toBe(raw); expect(fixtures.watch).not.toHaveBeenCalled();
});

it.each(['invalid', 'valid', 'unavailable'])('rechecks storage before Start instead of replacing newly %s data', kind => {
  const { result } = renderHook(() => useLiveRide());
  const raw = kind === 'valid' ? JSON.stringify(compatible()) : '{';
  localStorage.setItem(key, raw);
  const get = Storage.prototype.getItem;
  if (kind === 'unavailable') vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, name) {
    if (name === key) throw new Error('Synthetic access failure'); return get.call(this, name);
  });
  act(() => result.current.start({ airportDeparture: false, luggageItems: 0 }));
  expect(result.current.recovery).not.toBeNull(); expect(result.current.ride).toBeNull();
  expect(get.call(localStorage, key)).toBe(raw); expect(fixtures.watch).not.toHaveBeenCalled();
});

it.each(['throw', 'noop'])('preserves malformed data when native guard persistence fails (%s)', failure => {
  fixtures.native = true; localStorage.setItem(key, '{');
  const set = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, name, value) {
    if (name === guard) { if (failure === 'throw') throw new Error('Synthetic guard failure'); return; }
    set.call(this, name, value);
  });
  const remove = vi.spyOn(Storage.prototype, 'removeItem');
  const { result } = renderHook(() => useLiveRide());
  act(() => expect(result.current.discardRecovery()).toBe(false));
  expect(remove).not.toHaveBeenCalled(); expect(result.current.nativeRestartBlocked).toBe(true);
  expect(localStorage.getItem(key)).toBe('{'); expect(fixtures.watch).not.toHaveBeenCalled();
});

it.each(['throw', 'noop'])('retains data and native guard on failed explicit deletion (%s)', failure => {
  fixtures.native = true; localStorage.setItem(key, '{');
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { if (failure === 'throw') throw new Error('Synthetic delete failure'); });
  const { result } = renderHook(() => useLiveRide());
  act(() => expect(result.current.discardRecovery()).toBe(false));
  expect(result.current.recoveryStorageError).toBe(true); expect(localStorage.getItem(key)).toBe('{');
  expect(localStorage.getItem(guard)).toBe('1'); expect(fixtures.watch).not.toHaveBeenCalled();
});

it('keeps the native block across malformed-data discard and remount until explicit acknowledgment', () => {
  fixtures.native = true; localStorage.setItem(key, '{');
  const first = renderHook(() => useLiveRide());
  act(() => { expect(first.result.current.discardRecovery()).toBe(true); first.result.current.start({ airportDeparture: false, luggageItems: 0 }); });
  expect(localStorage.getItem(key)).toBeNull(); expect(localStorage.getItem(guard)).toBe('1');
  first.unmount();
  const second = renderHook(() => useLiveRide());
  expect(second.result.current.nativeRestartBlocked).toBe(true); expect(fixtures.watch).not.toHaveBeenCalled();
  act(() => expect(second.result.current.acknowledgeNativeRecovery()).toBe(true));
  expect(fixtures.watch).not.toHaveBeenCalled();
});

it('does not claim deletion success if removal readback fails', () => {
  fixtures.native = true; localStorage.setItem(key, '{');
  const { result } = renderHook(() => useLiveRide());
  const get = Storage.prototype.getItem;
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, name) {
    if (name === key) throw new Error('Synthetic readback failure'); return get.call(this, name);
  });
  act(() => expect(result.current.discardRecovery()).toBe(false));
  expect(result.current.recovery).not.toBeNull(); expect(result.current.recoveryStorageError).toBe(true);
  expect(result.current.nativeRestartBlocked).toBe(true); expect(get.call(localStorage, guard)).toBe('1');
});

it('offers neither blind discard nor fake Retry after read failure; reopening really reads again', () => {
  localStorage.setItem(key, '{');
  const get = Storage.prototype.getItem;
  const blocked = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, name) {
    if (name === key) throw new Error('Synthetic unavailable storage'); return get.call(this, name);
  });
  const first = renderHook(() => useLiveRide());
  act(() => expect(first.result.current.discardRecovery()).toBe(false));
  first.unmount(); blocked.mockRestore();
  const second = renderHook(() => useLiveRide());
  expect(second.result.current.recovery).toEqual({ kind: 'storage', reason: 'invalid' });
  expect(localStorage.getItem(key)).toBe('{'); expect(fixtures.watch).not.toHaveBeenCalled();
});

function completed(): TripRecord {
  return { id: 'synthetic-history', mode: 'manual', startMs: 1, endMs: 60001, durationS: 60, distanceM: 500,
    movingTimeS: 60, slowTimeS: 0, startCoords: null, endCoords: null, tariffId: 'unknown-historical', strategyId: 'historic',
    supplements: { airportDeparture: false, luggageItems: 0 }, meter: null, diff: null, diffPct: null, confidence: .35, warnings: [],
    estimate: { best: 7777, low: 7000, high: 8000, breakdown: { initialFare: 900, distanceCharge: 6877, waitingCharge: 0,
      airportSupplement: 0, luggageSupplement: 0, nightSurcharge: 0, total: 7777 } } };
}

it.each(['aeb', 'ar', 'fr', 'en'] as Language[])('retains independent Manual/History/saved exports and cancellation with %s storage copy', async language => {
  selectLanguage(language); const copy = catalogs[language]; const raw = ' { malformed original\n'; localStorage.setItem(key, raw);
  const trip = completed(); const before = JSON.stringify(trip); fixtures.list.mockResolvedValue([trip]);
  const first = render(createElement(App));
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: copy.activeStorage.title }));
  fireEvent.click(screen.getByRole('button', { name: copy.activeStorage.discardAndStart }));
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: copy.activeStorage.discardTitle }));
  fireEvent.click(screen.getByRole('button', { name: copy.rideRecovery.keepRecoveredRide }));
  expect(localStorage.getItem(key)).toBe(raw);
  fireEvent.click(screen.getByRole('button', { name: copy.rideRecovery.goToHomeKeepRecoveredRide }));
  fireEvent.click(screen.getByRole('button', { name: copy.app.manualCalculator }));
  expect(screen.getByRole('heading', { name: copy.manual.manualCalculator })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: copy.shared.back }));
  fireEvent.click(screen.getByRole('button', { name: copy.app.tripHistory }));
  fireEvent.click(await screen.findByText(copy.history.estimated('7.8')));
  expect(screen.getByText(text => text.replace(/[\u2066-\u2069]/g, '') === '≈ 7.777 TND')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: copy.result.exportJSON }));
  fireEvent.click(screen.getByRole('button', { name: copy.export.continueExport }));
  expect(fixtures.export).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fixtures.export.mock.calls[0][1] as string).estimate.best).toBe(7777);
  expect(JSON.stringify(trip)).toBe(before); expect(localStorage.getItem(key)).toBe(raw);
  expect(fixtures.save).not.toHaveBeenCalled(); expect(fixtures.remove).not.toHaveBeenCalled(); expect(fixtures.watch).not.toHaveBeenCalled();
  first.unmount(); render(createElement(App));
  expect(screen.getByRole('heading', { name: copy.activeStorage.title })).toBeTruthy();
  expect(localStorage.getItem(key)).toBe(raw);
});

it('shares an initial read failure with preflight instead of hiding it with a second empty read', () => {
  let reads = 0; const get = Storage.prototype.getItem;
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, name) {
    if (name === key && ++reads === 1) throw new Error('Synthetic initial read failure');
    return get.call(this, name);
  });
  render(createElement(App));
  expect(screen.getByText(catalogs.en.activeStorage.unavailable)).toBeTruthy();
  expect(reads).toBe(1);
  expect(screen.queryByRole('button', { name: /discard|retry/i })).toBeNull();
  expect(fixtures.watch).not.toHaveBeenCalled();
});

it.each([false, true])('retains Manual/History/export after an active read exception (native=%s)', async native => {
  fixtures.native = native; localStorage.setItem(key, '{ retained');
  const get = Storage.prototype.getItem;
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, name) {
    if (name === key) throw new Error('Synthetic active-only read failure'); return get.call(this, name);
  });
  fixtures.list.mockResolvedValue([completed()]);
  render(createElement(App));
  expect(screen.getByText(catalogs.en.activeStorage.unavailable)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /discard|retry/i })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: catalogs.en.rideRecovery.goToHomeKeepRecoveredRide }));
  fireEvent.click(screen.getByRole('button', { name: 'Manual calculator' }));
  expect(screen.getByLabelText('Distance (km)')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  fireEvent.click(screen.getByRole('button', { name: 'Trip history' }));
  fireEvent.click(await screen.findByText('Estimated: 7.8 TND'));
  fireEvent.click(screen.getByRole('button', { name: 'Export JSON' }));
  fireEvent.click(screen.getByRole('button', { name: 'Continue export' }));
  expect(fixtures.export).toHaveBeenCalledTimes(1); expect(fixtures.watch).not.toHaveBeenCalled();
  expect(fixtures.save).not.toHaveBeenCalled(); expect(fixtures.remove).not.toHaveBeenCalled();
  expect(get.call(localStorage, key)).toBe('{ retained');
  if (native) expect(get.call(localStorage, guard)).toBe('1');
});
