// @vitest-environment jsdom
import { act, cleanup, renderHook, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useLiveRide } from '../src/hooks/useLiveRide';
import { App } from '../src/App';
import { catalogs, selectLanguage, type Language } from '../src/localization';
import { getActiveTariff } from '../src/config/tariffs';
import type { TripRecord } from '../src/domain/trip/types';
import * as calculator from '../src/domain/fare/calculator';

const gps = vi.hoisted(() => ({ native: false, stop: vi.fn(), watch: vi.fn(), stopKnown: vi.fn() }));
const store = vi.hoisted(() => ({ save: vi.fn(), list: vi.fn(), remove: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => gps.native, getPlatform: () => gps.native ? 'android' : 'web' } }));
vi.mock('../src/services/geolocation/watcher', () => ({ watchPosition: gps.watch,
  stopKnownPositionWatches: gps.stopKnown, requestWakeLock: vi.fn(async () => null) }));
vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn(async () => ({ remove: vi.fn() })), minimizeApp: vi.fn() } }));
vi.mock('../src/storage/tripStore', () => ({ tripStore: store }));
const activeKey = 'taxi-check.active-ride';
const guardKey = 'taxi-check.native-recovery';
const originalGet = Storage.prototype.getItem;
const records = new Map<string, TripRecord>();
beforeEach(() => { localStorage.clear(); vi.resetAllMocks(); records.clear(); selectLanguage('en');
  gps.native = false; gps.watch.mockReturnValue(gps.stop);
  store.save.mockImplementation(async (trip: TripRecord) => { records.set(trip.id, structuredClone(trip)); });
  store.list.mockImplementation(async () => [...records.values()]); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('does not resume a normally ended ride after failed deletion and remount', () => {
  const first = renderHook(useLiveRide);
  act(() => first.result.current.start({ airportDeparture: false, luggageItems: 0 }));
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('Synthetic remove'); });
  act(() => { expect(first.result.current.end()).not.toBeNull(); }); first.unmount();
  renderHook(useLiveRide); expect(gps.watch).toHaveBeenCalledTimes(1);
});

it.each(['throw', 'noop', 'readback'])('retains End result and blocks replacement after %s cleanup failure', failure => {
  const { result, unmount } = renderHook(useLiveRide);
  act(() => result.current.start({ airportDeparture: false, luggageItems: 0 }));
  const raw = localStorage.getItem(activeKey); const remove = Storage.prototype.removeItem;
  let removed = false;
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key) {
    if (key === activeKey) { if (failure === 'throw') throw new Error('Synthetic remove'); if (failure === 'noop') return; removed = true; }
    remove.call(this, key);
  });
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) {
    if (key === activeKey && removed) throw new Error('Synthetic verification'); return originalGet.call(this, key);
  });
  let trip: ReturnType<typeof result.current.end> = null;
  act(() => { trip = result.current.end(); });
  expect(trip).not.toBeNull(); expect(gps.stop).toHaveBeenCalled();
  expect(result.current.cleanup?.storage).toBe(failure === 'readback' ? 'uncertain' : 'retained');
  act(() => { result.current.start({ airportDeparture: true, luggageItems: 1 }); expect(result.current.end()).toBeNull(); });
  expect(gps.watch).toHaveBeenCalledTimes(1);
  if (failure !== 'readback') expect(originalGet.call(localStorage, activeKey)).toBe(raw);
  unmount(); renderHook(useLiveRide); expect(gps.watch).toHaveBeenCalledTimes(1);
});
it.each(['throw', 'noop', 'readback'])('does not report confirmed discard as cleared after %s cleanup failure', failure => {
  const { result } = renderHook(useLiveRide);
  act(() => result.current.start({ airportDeparture: false, luggageItems: 0 }));
  const remove = Storage.prototype.removeItem; let removed = false;
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key) {
    if (key === activeKey) { if (failure === 'throw') throw new Error('Synthetic remove'); if (failure === 'noop') return; removed = true; }
    remove.call(this, key);
  });
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) {
    if (key === activeKey && removed) throw new Error('Synthetic verification'); return originalGet.call(this, key);
  });
  act(() => result.current.cancel()); expect(gps.stop).toHaveBeenCalled();
  expect(result.current.cleanup?.storage).toBe(failure === 'readback' ? 'uncertain' : 'retained');
  act(() => result.current.start({ airportDeparture: false, luggageItems: 0 })); expect(gps.watch).toHaveBeenCalledTimes(1);
});

it.each([false, true])('verifies successful normal End/discard without leaving markers (native=%s)', native => {
  gps.native = native;
  const { result } = renderHook(useLiveRide);
  act(() => result.current.start({ airportDeparture: false, luggageItems: 0 }));
  act(() => { expect(result.current.end()).not.toBeNull(); });
  expect(result.current.cleanup).toBeNull(); expect(result.current.recovery).toBeNull();
  expect(localStorage.getItem(activeKey)).toBeNull(); expect(localStorage.getItem(guardKey)).toBeNull();
  act(() => { expect(result.current.end()).toBeNull(); expect(result.current.retryCleanup()).toBe(false); });
  act(() => result.current.start({ airportDeparture: false, luggageItems: 0 }));
  act(() => result.current.cancel());
  expect(result.current.cleanup).toBeNull(); expect(localStorage.getItem(activeKey)).toBeNull();
  expect(localStorage.getItem(guardKey)).toBeNull(); expect(gps.watch).toHaveBeenCalledTimes(2);
});
it.each([false, true])('retries cleanup without another end/watch and retains native safety after failure (native=%s)', native => {
  gps.native = native;
  const { result } = renderHook(useLiveRide);
  act(() => result.current.start({ airportDeparture: false, luggageItems: 0 }));
  const remove = Storage.prototype.removeItem;
  const block = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key) {
    if (key !== activeKey) remove.call(this, key);
  });
  let final: TripRecord | null = null;
  act(() => { final = result.current.end(); });
  const before = JSON.stringify(final);
  act(() => { expect(result.current.retryCleanup()).toBe(false); result.current.cancel(); });
  expect(localStorage.getItem(guardKey)).toBe('cleanup'); block.mockRestore();
  act(() => expect(result.current.retryCleanup()).toBe(true));
  expect(result.current.cleanup).toBeNull(); expect(JSON.stringify(final)).toBe(before);
  expect(gps.watch).toHaveBeenCalledTimes(1); expect(store.save).not.toHaveBeenCalled();
  expect(localStorage.getItem(activeKey)).toBeNull();
  expect(localStorage.getItem(guardKey)).toBe(native ? '1' : null);
  expect(result.current.nativeRestartBlocked).toBe(native);
  if (native) { act(() => result.current.start({ airportDeparture: false, luggageItems: 0 })); expect(gps.watch).toHaveBeenCalledTimes(1); }
});
it.each([false, true])('recovers from failed active readback without recomputing final fare (native=%s)', native => {
  gps.native = native; const calculate = vi.spyOn(calculator, 'estimateFare');
  const { result } = renderHook(useLiveRide);
  act(() => result.current.start({ airportDeparture: false, luggageItems: 0 }));
  const remove = Storage.prototype.removeItem; let removed = false;
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key) {
    remove.call(this, key); if (key === activeKey) removed = true;
  });
  const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) {
    if (key === activeKey && removed) throw new Error('Readback'); return originalGet.call(this, key);
  });
  let trip: TripRecord | null = null; act(() => { trip = result.current.end(); });
  const before = JSON.stringify(trip); const computations = calculate.mock.calls.length;
  expect(result.current.cleanup?.storage).toBe('uncertain'); read.mockRestore();
  act(() => { expect(result.current.retryCleanup()).toBe(true); expect(result.current.end()).toBeNull(); });
  expect(calculate).toHaveBeenCalledTimes(computations); expect(JSON.stringify(trip)).toBe(before); expect(gps.watch).toHaveBeenCalledTimes(1);
});
it('does not release native replacement when transition to the durable unknown-service guard fails', () => {
  gps.native = true; const { result } = renderHook(useLiveRide);
  act(() => result.current.start({ airportDeparture: false, luggageItems: 0 }));
  const remove = Storage.prototype.removeItem;
  const block = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key) { if (key !== activeKey) remove.call(this, key); });
  act(() => result.current.cancel()); block.mockRestore();
  const set = Storage.prototype.setItem;
  const guardFail = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (key === guardKey && value === '1') throw new Error('Guard transition'); set.call(this, key, value);
  });
  act(() => expect(result.current.retryCleanup()).toBe(false));
  expect(result.current.cleanup?.storage).toBe('absent'); expect(localStorage.getItem(guardKey)).toBe('cleanup');
  act(() => { expect(result.current.acknowledgeNativeRecovery()).toBe(false); result.current.start({ airportDeparture: false, luggageItems: 0 }); });
  expect(gps.watch).toHaveBeenCalledTimes(1); guardFail.mockRestore();
  act(() => expect(result.current.retryCleanup()).toBe(true)); expect(localStorage.getItem(guardKey)).toBe('1');
});
it('preserves compatible browser restoration with the legacy Android-only guard value', () => {
  localStorage.setItem(guardKey, '1');
  localStorage.setItem(activeKey, JSON.stringify({ tariffId: getActiveTariff().id, startMs: Date.now(), samples: [],
    supplements: { airportDeparture: false, luggageItems: 0 }, gpsStatus: 'waiting' }));
  const { result } = renderHook(useLiveRide);
  expect(result.current.cleanup).toBeNull(); expect(gps.watch).toHaveBeenCalledTimes(1);
});
it('persists and verifies cleanup intent before deleting and never treats it as native shutdown proof', () => {
  gps.native = true;
  const { result } = renderHook(useLiveRide);
  act(() => result.current.start({ airportDeparture: false, luggageItems: 0 }));
  const events: string[] = [];
  const set = Storage.prototype.setItem; const remove = Storage.prototype.removeItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (key === guardKey) events.push(`guard:${value}`); set.call(this, key, value);
  });
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) {
    if (key === guardKey) events.push('guard-read'); return originalGet.call(this, key);
  });
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key) {
    if (key === activeKey) { expect(originalGet.call(this, guardKey)).toBe('cleanup'); expect(gps.stop).toHaveBeenCalled(); events.push('active-remove'); }
    remove.call(this, key);
  });
  act(() => result.current.cancel());
  expect(events.indexOf('guard:cleanup')).toBeLessThan(events.indexOf('guard-read'));
  expect(events.indexOf('guard-read')).toBeLessThan(events.indexOf('active-remove'));
});
it.each(['throw', 'noop', 'read'])('blocks within session when marker %s fails without deleting original bytes', failure => {
  const { result } = renderHook(useLiveRide);
  act(() => result.current.start({ airportDeparture: false, luggageItems: 0 }));
  const raw = localStorage.getItem(activeKey); const set = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (key === guardKey) { if (failure === 'throw') throw new Error('Marker write'); if (failure === 'noop') return; }
    set.call(this, key, value);
  });
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) {
    if (key === guardKey && failure === 'read') throw new Error('Marker read'); return originalGet.call(this, key);
  });
  const remove = vi.spyOn(Storage.prototype, 'removeItem');
  act(() => result.current.end());
  expect(result.current.cleanup).toEqual({ storage: 'retained', guardReady: false });
  expect(remove).not.toHaveBeenCalled(); expect(gps.stop).toHaveBeenCalled();
  act(() => { result.current.start({ airportDeparture: false, luggageItems: 0 }); result.current.setSupplements({ airportDeparture: true, luggageItems: 1 }); });
  expect(gps.watch).toHaveBeenCalledTimes(1); expect(originalGet.call(localStorage, activeKey)).toBe(raw);
});
it('documents selective marker-write loss: session protection cannot distinguish an unmarked compatible ride on later mount', () => {
  const first = renderHook(useLiveRide);
  act(() => first.result.current.start({ airportDeparture: false, luggageItems: 0 }));
  const set = Storage.prototype.setItem;
  const blocked = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (key === guardKey) throw new Error('Marker denied'); set.call(this, key, value);
  });
  act(() => first.result.current.end());
  expect(first.result.current.cleanup?.guardReady).toBe(false); expect(originalGet.call(localStorage, guardKey)).toBeNull();
  first.unmount(); blocked.mockRestore();
  renderHook(useLiveRide);
  // Without any durable intent, this is indistinguishable from a compatible interrupted ride.
  expect(gps.watch).toHaveBeenCalledTimes(2);
});
it('keeps total storage failure blocked in-session and on an unreadable remount without a durability claim', () => {
  const first = renderHook(useLiveRide);
  act(() => first.result.current.start({ airportDeparture: false, luggageItems: 0 }));
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Unavailable'); });
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Unavailable'); });
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('Unavailable'); });
  act(() => { expect(first.result.current.end()).not.toBeNull(); });
  expect(first.result.current.cleanup).toEqual({ storage: 'uncertain', guardReady: false });
  expect(gps.stop).toHaveBeenCalled(); first.unmount(); renderHook(useLiveRide);
  expect(gps.watch).toHaveBeenCalledTimes(1);
});
it.each(['retained', 'absent'])('reloads a cleanup marker with %s active bytes without recording or automatic deletion', status => {
  localStorage.setItem(guardKey, 'cleanup');
  if (status === 'retained') localStorage.setItem(activeKey, JSON.stringify({ tariffId: getActiveTariff().id,
    startMs: Date.now(), samples: [], supplements: { airportDeparture: false, luggageItems: 0 }, gpsStatus: 'waiting' }));
  const raw = localStorage.getItem(activeKey); const remove = vi.spyOn(Storage.prototype, 'removeItem');
  const { result } = renderHook(useLiveRide);
  expect(result.current.cleanup?.storage).toBe(status); expect(result.current.ride).toBeNull(); expect(gps.watch).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled(); expect(localStorage.getItem(activeKey)).toBe(raw);
  act(() => expect(result.current.retryCleanup()).toBe(true)); expect(gps.watch).not.toHaveBeenCalled();
});
it.each(['throw', 'noop', 'read'])('retains a pending state if recovery-marker removal %s fails after confirmed active absence', failure => {
  const { result } = renderHook(useLiveRide);
  act(() => result.current.start({ airportDeparture: false, luggageItems: 0 }));
  const remove = Storage.prototype.removeItem; let removedMarker = false;
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key) {
    if (key === guardKey) { if (failure === 'throw') throw new Error('Marker remove'); if (failure === 'noop') return; removedMarker = true; }
    remove.call(this, key);
  });
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) {
    if (key === guardKey && removedMarker && failure === 'read') throw new Error('Marker verification'); return originalGet.call(this, key);
  });
  act(() => result.current.end());
  expect(result.current.cleanup).toEqual({ storage: 'absent', guardReady: false });
  expect(originalGet.call(localStorage, activeKey)).toBeNull(); expect(originalGet.call(localStorage, guardKey)).toBe('cleanup');
  act(() => result.current.start({ airportDeparture: false, luggageItems: 0 })); expect(gps.watch).toHaveBeenCalledTimes(1);
});
it('ignores late GPS callbacks and preserves original bytes during pending cleanup', () => {
  const { result } = renderHook(useLiveRide);
  act(() => result.current.start({ airportDeparture: false, luggageItems: 0 }));
  const raw = localStorage.getItem(activeKey);
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {});
  act(() => result.current.end());
  act(() => { gps.watch.mock.calls[0][0]({ t: Date.now(), lat: 36, lon: 10, accuracy: 1 }); result.current.setSupplements({ airportDeparture: true, luggageItems: 2 }); });
  expect(localStorage.getItem(activeKey)).toBe(raw); expect(gps.watch).toHaveBeenCalledTimes(1);
});
it.each(['en', 'aeb', 'ar', 'fr'] as Language[])('preserves one ended result, meter draft and independent navigation while retrying in %s', async language => {
  selectLanguage(language); const copy = catalogs[language];
  const time = vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-11-01T11:00:00Z'));
  render(createElement(App)); fireEvent.click(screen.getByRole('button', { name: copy.app.startRide }));
  const remove = Storage.prototype.removeItem;
  const block = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key) { if (key !== activeKey) remove.call(this, key); });
  time.mockReturnValue(Date.parse('2026-11-01T11:02:00Z'));
  fireEvent.click(screen.getByRole('button', { name: copy.live.endRide }));
  expect(screen.getByRole('alert').textContent).toBe(copy.cleanup.retained);
  await waitFor(() => expect(store.save).toHaveBeenCalledTimes(1));
  const final = structuredClone(store.save.mock.calls[0][0]);
  fireEvent.change(screen.getByLabelText(copy.result.driversMeter), { target: { value: '9.123' } });
  fireEvent.click(screen.getByRole('button', { name: copy.cleanup.retry }));
  expect((screen.getByLabelText(copy.result.driversMeter) as HTMLInputElement).value).toBe('9.123');
  fireEvent.click(screen.getByRole('button', { name: copy.shared.back }));
  fireEvent.click(screen.getByRole('button', { name: copy.app.manualCalculator }));
  expect(screen.getByRole('heading', { name: copy.manual.manualCalculator })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: copy.shared.back }));
  fireEvent.click(screen.getByRole('button', { name: copy.app.tripHistory }));
  expect(await screen.findByText(copy.history.estimated((final.estimate.best / 1000).toFixed(1)))).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: copy.shared.back }));
  fireEvent.click(screen.getByRole('button', { name: copy.cleanup.viewResult }));
  expect((screen.getByLabelText(copy.result.driversMeter) as HTMLInputElement).value).toBe('9.123');
  time.mockReturnValue(Date.parse('2026-11-01T12:00:00Z')); block.mockRestore();
  fireEvent.click(screen.getByRole('button', { name: copy.cleanup.retry }));
  expect(screen.queryByRole('alert')).toBeNull(); expect((screen.getByLabelText(copy.result.driversMeter) as HTMLInputElement).value).toBe('9.123');
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: copy.app.tripComplete }));
  expect(store.save).toHaveBeenCalledTimes(1); expect(records.get(final.id)).toEqual(final); expect(gps.watch).toHaveBeenCalledTimes(1);
});
it('keeps History-save failure separate and allows an explicit same-ID save without cleanup-triggered duplicates', async () => {
  store.save.mockRejectedValueOnce(new Error('History full'));
  render(createElement(App)); fireEvent.click(screen.getByRole('button', { name: catalogs.en.app.startRide }));
  const remove = Storage.prototype.removeItem;
  const blocked = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key) { if (key !== activeKey) remove.call(this, key); });
  fireEvent.click(screen.getByRole('button', { name: catalogs.en.live.endRide }));
  expect(await screen.findByText(catalogs.en.app.thisTripCouldNotBeSaved)).toBeTruthy();
  const final = store.save.mock.calls[0][0]; expect(records.size).toBe(0);
  fireEvent.click(screen.getByRole('button', { name: catalogs.en.cleanup.retry })); expect(store.save).toHaveBeenCalledTimes(1);
  fireEvent.change(screen.getByLabelText(catalogs.en.result.driversMeter), { target: { value: '9.123' } });
  fireEvent.click(screen.getByRole('button', { name: catalogs.en.result.saveToHistory }));
  await screen.findByText(catalogs.en.result.tripSavedInHistoryOnThis);
  expect(records.size).toBe(1); expect(store.save.mock.calls[1][0].id).toBe(final.id);
  expect(records.get(final.id)?.meter).toBe(9123);
  blocked.mockRestore(); fireEvent.click(screen.getByRole('button', { name: catalogs.en.cleanup.retry }));
  expect(store.save).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  fireEvent.click(screen.getByRole('button', { name: catalogs.en.cleanup.viewResult }));
  expect((screen.getByLabelText(catalogs.en.result.driversMeter) as HTMLInputElement).value).toBe('9.123');
  expect(screen.getByRole('button', { name: catalogs.en.result.saved })).toBeTruthy();
});
it('leaves an unconfirmed discard recording unchanged, then shows failure only after explicit confirmation', () => {
  render(createElement(App)); fireEvent.click(screen.getByRole('button', { name: catalogs.en.app.startRide }));
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  fireEvent.click(screen.getByRole('button', { name: catalogs.en.live.discardRide }));
  expect(gps.stop).not.toHaveBeenCalled(); expect(screen.getByRole('button', { name: catalogs.en.live.endRide })).toBeTruthy();
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {}); confirm.mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: catalogs.en.live.discardRide }));
  expect(screen.getByRole('heading', { name: catalogs.en.cleanup.title })).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toBe(catalogs.en.cleanup.retained); expect(gps.stop).toHaveBeenCalled();
  expect(store.save).not.toHaveBeenCalled();
});
it('opens cleanup feedback on discard failure even after an earlier completed-result journey', async () => {
  render(createElement(App)); fireEvent.click(screen.getByRole('button', { name: catalogs.en.app.startRide }));
  fireEvent.click(screen.getByRole('button', { name: catalogs.en.live.endRide }));
  await waitFor(() => expect(store.save).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  fireEvent.click(screen.getByRole('button', { name: catalogs.en.app.startRide }));
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {});
  fireEvent.click(screen.getByRole('button', { name: catalogs.en.live.discardRide }));
  expect(screen.getByRole('heading', { name: catalogs.en.cleanup.title })).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toBe(catalogs.en.cleanup.retained);
  expect(store.save).toHaveBeenCalledTimes(1);
});
