// @vitest-environment jsdom
import { StrictMode, createElement } from 'react';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLiveRide } from '../src/hooks/useLiveRide';
import { getActiveTariff } from '../src/config/tariffs';
import * as tariffs from '../src/config/tariffs';

const gps = vi.hoisted(() => ({
  starts: [] as { sample: (s: unknown) => void; error: (e: string) => void; stop: ReturnType<typeof vi.fn> }[],
  requestWakeLock: vi.fn(async (): Promise<{ release: () => Promise<void> } | null> => null),
  stopKnown: vi.fn(), native: false,
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => gps.native } }));
vi.mock('../src/services/geolocation/watcher', () => ({
  watchPosition: (sample: (s: unknown) => void, error: (e: string) => void) => {
    const stop = vi.fn(); gps.starts.push({ sample, error, stop }); return stop;
  },
  requestWakeLock: gps.requestWakeLock,
  stopKnownPositionWatches: gps.stopKnown,
}));

beforeEach(() => { localStorage.clear(); gps.starts.length = 0; gps.requestWakeLock.mockClear(); gps.stopKnown.mockClear(); gps.native = false; });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('live ride lifecycle', () => {
  it.each([
    ['unknown', 'unavailable-tariff'], ['missing', undefined], ['malformed', { id: 'invalid' }],
    ['null', null], ['numeric', 42], ['empty', ''], ['whitespace', '   '], ['boolean', true],
  ])('quarantines a restored %s tariff without estimating, starting GPS or rewriting data', (_kind, tariffId) => {
    const raw = JSON.stringify({ tariffId, startMs: Date.now() - 60000, samples: [],
      supplements: { airportDeparture: false, luggageItems: 0 }, gpsStatus: 'ok' });
    localStorage.setItem('taxi-check.active-ride', raw);
    const { result, unmount } = renderHook(useLiveRide);
    expect(result.current.live).toBeNull();
    expect(gps.starts).toHaveLength(0);
    expect(localStorage.getItem('taxi-check.active-ride')).toBe(raw);
    expect(result.current.recovery).not.toBeNull();
    expect(gps.requestWakeLock).not.toHaveBeenCalled();
    act(() => {
      result.current.start({ airportDeparture: false, luggageItems: 0 });
      result.current.cancel();
      result.current.setSupplements({ airportDeparture: true, luggageItems: 2 });
      expect(result.current.end()).toBeNull();
    });
    expect(localStorage.getItem('taxi-check.active-ride')).toBe(raw);
    unmount();
    const second = renderHook(useLiveRide);
    expect(second.result.current.recovery).not.toBeNull();
    expect(second.result.current.live).toBeNull();
    expect(gps.starts).toHaveLength(0);
    expect(localStorage.getItem('taxi-check.active-ride')).toBe(raw);
  });
  it.each([false, true])('pins the tariff and uses the latest GPS fix when ending a ride (native=%s)', (native) => {
    gps.native = native;
    const { result } = renderHook(useLiveRide);
    act(() => result.current.start({ airportDeparture: false, luggageItems: 0 }));
    expect(result.current.ride?.tariffId).toBe(getActiveTariff().id);
    expect(JSON.parse(localStorage.getItem('taxi-check.active-ride')!).tariffId).toBe(getActiveTariff().id);
    const start = result.current.ride!.startMs;
    act(() => gps.starts[0].sample({ t: start, lat: 36.8, lon: 10, accuracy: 5 }));
    act(() => {
      gps.starts[0].sample({ t: Date.now(), lat: 36.8, lon: 10, accuracy: 5 });
      const trip = result.current.end();
      expect(trip?.endCoords).toEqual({ lat: 36.8, lon: 10 });
    });
    expect(gps.starts[0].stop).toHaveBeenCalled();
    expect(localStorage.getItem('taxi-check.active-ride')).toBeNull();
  });

  it('restarts restored GPS correctly under React StrictMode and cleans up', () => {
    localStorage.setItem('taxi-check.active-ride', JSON.stringify({ tariffId: getActiveTariff().id, startMs: Date.now(), samples: [],
      supplements: { airportDeparture: false, luggageItems: 0 }, gpsStatus: 'waiting' }));
    const { unmount } = renderHook(useLiveRide, { wrapper: ({ children }) => createElement(StrictMode, null, children) });
    expect(gps.starts).toHaveLength(2);
    expect(gps.starts[0].stop).toHaveBeenCalled();
    expect(gps.starts[1].stop).not.toHaveBeenCalled();
    unmount();
    expect(gps.starts[1].stop).toHaveBeenCalled();
  });

  it('reports GPS loss after earlier successful fixes', () => {
    const { result } = renderHook(useLiveRide);
    act(() => result.current.start({ airportDeparture: false, luggageItems: 0 }));
    act(() => gps.starts[0].sample({ t: Date.now(), lat: 36.8, lon: 10, accuracy: 5 }));
    act(() => gps.starts[0].error('unavailable'));
    expect(result.current.ride?.gpsStatus).toBe('unavailable');
  });

  it('uses the exact known historical tariff through completion without active substitution', () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-30T11:00:00Z'));
    const historical = { ...getActiveTariff(), id: 'historical-test-only', initialFare: 1234 };
    const active = getActiveTariff();
    vi.spyOn(tariffs, 'getTariff').mockImplementation(id => id === historical.id ? historical : id === active.id ? active : undefined);
    const activeLookup = vi.spyOn(tariffs, 'getActiveTariff');
    const raw = JSON.stringify({ tariffId: historical.id, startMs: Date.now(), samples: [],
      supplements: { airportDeparture: false, luggageItems: 0 }, gpsStatus: 'waiting' });
    localStorage.setItem('taxi-check.active-ride', raw);
    const { result } = renderHook(useLiveRide);
    expect(result.current.live?.estimate.tariffId).toBe(historical.id);
    expect(result.current.live?.estimate.breakdown.initialFare).toBe(1234);
    expect(activeLookup).not.toHaveBeenCalled();
    act(() => { expect(result.current.end()?.tariffId).toBe(historical.id); });
  });

  it('cleans tracked watchers under StrictMode recovery without resuming or altering raw data', () => {
    const raw = JSON.stringify({ tariffId: 'unknown', startMs: Date.now(), samples: [],
      supplements: { airportDeparture: false, luggageItems: 0 }, gpsStatus: 'ok' });
    localStorage.setItem('taxi-check.active-ride', raw);
    const { unmount } = renderHook(useLiveRide, { wrapper: ({ children }) => createElement(StrictMode, null, children) });
    expect(gps.stopKnown).toHaveBeenCalledTimes(2);
    expect(gps.starts).toHaveLength(0);
    unmount();
    expect(localStorage.getItem('taxi-check.active-ride')).toBe(raw);
  });

  it('only permits a clean replacement after explicit recovery discard succeeds', () => {
    localStorage.setItem('taxi-check.active-ride', JSON.stringify({ startMs: Date.now(), samples: [],
      supplements: { airportDeparture: false, luggageItems: 0 }, gpsStatus: 'waiting' }));
    const { result } = renderHook(useLiveRide);
    act(() => {
      expect(result.current.discardRecovery()).toBe(true);
      result.current.start({ airportDeparture: false, luggageItems: 0 });
    });
    expect(result.current.recovery).toBeNull();
    expect(result.current.live?.estimate.tariffId).toBe(getActiveTariff().id);
    expect(gps.starts).toHaveLength(1);
  });

  it('does not overwrite recovery after storage refuses removal', () => {
    const raw = JSON.stringify({ tariffId: 'unknown', startMs: Date.now(), samples: [],
      supplements: { airportDeparture: false, luggageItems: 0 }, gpsStatus: 'ok' });
    localStorage.setItem('taxi-check.active-ride', raw);
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('Synthetic blocked storage'); });
    const { result } = renderHook(useLiveRide);
    act(() => { expect(result.current.discardRecovery()).toBe(false); result.current.start({ airportDeparture: false, luggageItems: 0 }); });
    expect(result.current.recoveryStorageError).toBe(true);
    expect(localStorage.getItem('taxi-check.active-ride')).toBe(raw);
    expect(gps.starts).toHaveLength(0);
  });

  it('keeps native replacement blocked after discard because a prior service ID cannot be recovered', () => {
    gps.native = true;
    localStorage.setItem('taxi-check.active-ride', JSON.stringify({ startMs: Date.now(), samples: [],
      supplements: { airportDeparture: false, luggageItems: 0 }, gpsStatus: 'ok' }));
    const { result } = renderHook(useLiveRide);
    act(() => { expect(result.current.acknowledgeNativeRecovery()).toBe(false); });
    expect(localStorage.getItem('taxi-check.native-recovery')).toBe('1');
    act(() => { expect(result.current.discardRecovery()).toBe(true); result.current.start({ airportDeparture: false, luggageItems: 0 }); });
    expect(result.current.nativeRestartBlocked).toBe(true);
    expect(result.current.ride).toBeNull();
    expect(gps.starts).toHaveLength(0);
  });

  it('keeps session recovery and the durable guard when ride removal succeeds but its readback fails', () => {
    gps.native = true;
    localStorage.setItem('taxi-check.active-ride', JSON.stringify({ tariffId: 'unknown', startMs: Date.now(), samples: [],
      supplements: { airportDeparture: false, luggageItems: 0 }, gpsStatus: 'ok' }));
    const { result, unmount } = renderHook(useLiveRide);
    const get = Storage.prototype.getItem;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) {
      if (key === 'taxi-check.active-ride') throw new Error('Synthetic removal readback failure');
      return get.call(this, key);
    });
    act(() => { expect(result.current.discardRecovery()).toBe(false); });
    expect(result.current.recovery).not.toBeNull();
    expect(result.current.recoveryStorageError).toBe(true);
    expect(gps.starts).toHaveLength(0);
    vi.restoreAllMocks();
    expect(localStorage.getItem('taxi-check.active-ride')).toBeNull();
    expect(localStorage.getItem('taxi-check.native-recovery')).toBe('1');
    unmount();
    expect(renderHook(useLiveRide).result.current.nativeRestartBlocked).toBe(true);
  });

  it.each(['write', 'readback'])('retains original native recovery if guard %s fails before discard', (failure) => {
    gps.native = true;
    const raw = JSON.stringify({ tariffId: 'unknown', startMs: Date.now(), samples: [],
      supplements: { airportDeparture: false, luggageItems: 0 }, gpsStatus: 'ok' });
    localStorage.setItem('taxi-check.active-ride', raw);
    const get = Storage.prototype.getItem;
    const set = Storage.prototype.setItem;
    if (failure === 'write') vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === 'taxi-check.native-recovery') throw new Error('Synthetic quota failure');
      set.call(this, key, value);
    });
    else vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) {
      return key === 'taxi-check.native-recovery' ? null : get.call(this, key);
    });
    const remove = vi.spyOn(Storage.prototype, 'removeItem');
    const { result } = renderHook(useLiveRide);
    act(() => { expect(result.current.discardRecovery()).toBe(false); });
    expect(result.current.nativeRecoveryError).toContain('could not be saved and verified');
    expect(localStorage.getItem('taxi-check.active-ride')).toBe(raw);
    expect(remove).not.toHaveBeenCalled();
    expect(result.current.nativeRestartBlocked).toBe(true);
    expect(gps.starts).toHaveLength(0);
  });

  it('persists and confirms the native guard before attempting ride deletion, retaining it when deletion fails', () => {
    gps.native = true;
    localStorage.setItem('taxi-check.active-ride', JSON.stringify({ startMs: Date.now(), samples: [],
      supplements: { airportDeparture: false, luggageItems: 0 }, gpsStatus: 'ok' }));
    const remove = vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (this: Storage, key) {
      expect(key).toBe('taxi-check.active-ride');
      expect(localStorage.getItem('taxi-check.native-recovery')).toBe('1');
      throw new Error('Synthetic deletion failure');
    });
    const { result } = renderHook(useLiveRide);
    act(() => { expect(result.current.discardRecovery()).toBe(false); });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(result.current.recoveryStorageError).toBe(true);
    expect(result.current.recovery).not.toBeNull();
    expect(localStorage.getItem('taxi-check.native-recovery')).toBe('1');
    expect(gps.starts).toHaveLength(0);
  });

  it.each(['remove throws', 'remove no-op', 'readback throws'])('keeps native startup blocked when acknowledgment %s', (failure) => {
    gps.native = true;
    localStorage.setItem('taxi-check.native-recovery', '1');
    const { result, unmount } = renderHook(useLiveRide);
    if (failure === 'remove throws') vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('Synthetic denied removal'); });
    if (failure === 'remove no-op') vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => undefined);
    if (failure === 'readback throws') vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Synthetic denied read'); });
    act(() => {
      expect(result.current.acknowledgeNativeRecovery()).toBe(false);
      result.current.start({ airportDeparture: false, luggageItems: 0 });
    });
    expect(result.current.nativeRestartBlocked).toBe(true);
    expect(result.current.nativeRecoveryError).toContain('could not be saved and verified');
    expect(gps.starts).toHaveLength(0);
    vi.restoreAllMocks();
    expect(localStorage.getItem('taxi-check.native-recovery')).toBe('1');
    unmount();
    expect(renderHook(useLiveRide).result.current.nativeRestartBlocked).toBe(true);
  });

  it('blocks before watcher startup when reading the native guard fails', () => {
    gps.native = true;
    const get = Storage.prototype.getItem;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key) {
      if (key === 'taxi-check.native-recovery') throw new Error('Synthetic read failure');
      return get.call(this, key);
    });
    const { result } = renderHook(useLiveRide);
    act(() => result.current.start({ airportDeparture: false, luggageItems: 0 }));
    expect(result.current.nativeRestartBlocked).toBe(true);
    expect(result.current.nativeRecoveryError).toContain('could not be read');
    expect(gps.starts).toHaveLength(0);
  });

  it('waits for explicit acknowledgment before resuming a guarded known ride without repricing or rewriting it', () => {
    gps.native = true;
    localStorage.setItem('taxi-check.native-recovery', 'unexpected-value');
    const raw = JSON.stringify({ tariffId: getActiveTariff().id, startMs: Date.now(), samples: [],
      supplements: { airportDeparture: false, luggageItems: 0 }, gpsStatus: 'waiting' });
    localStorage.setItem('taxi-check.active-ride', raw);
    const { result } = renderHook(useLiveRide);
    expect(result.current.live).toBeNull();
    expect(gps.starts).toHaveLength(0);
    expect(localStorage.getItem('taxi-check.active-ride')).toBe(raw);
    act(() => { expect(result.current.end()).toBeNull(); result.current.cancel(); });
    expect(localStorage.getItem('taxi-check.active-ride')).toBe(raw);
    act(() => { expect(result.current.acknowledgeNativeRecovery()).toBe(true); });
    expect(gps.starts).toHaveLength(1);
    expect(result.current.live?.estimate.tariffId).toBe(getActiveTariff().id);
    expect(localStorage.getItem('taxi-check.active-ride')).toBe(raw);
  });

  it.each([false, true])('restores known rides normally without a guard (native=%s)', (native) => {
    gps.native = native;
    localStorage.setItem('taxi-check.active-ride', JSON.stringify({ tariffId: getActiveTariff().id, startMs: Date.now(), samples: [],
      supplements: { airportDeparture: false, luggageItems: 0 }, gpsStatus: 'waiting' }));
    const { result } = renderHook(useLiveRide);
    expect(result.current.nativeRestartBlocked).toBe(false);
    expect(gps.starts).toHaveLength(1);
    expect(localStorage.getItem('taxi-check.native-recovery')).toBeNull();
  });

  it('does not impose Android recovery on browser rides or erase an existing Android marker', () => {
    localStorage.setItem('taxi-check.native-recovery', '1');
    const { result } = renderHook(useLiveRide);
    act(() => result.current.start({ airportDeparture: false, luggageItems: 0 }));
    expect(result.current.nativeRestartBlocked).toBe(false);
    expect(gps.starts).toHaveLength(1);
    expect(localStorage.getItem('taxi-check.native-recovery')).toBe('1');
  });
});
