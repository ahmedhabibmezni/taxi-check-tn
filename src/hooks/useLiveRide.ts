import { isIosPlatform, canAcknowledgeNativeRecovery } from '../platform/capabilities';
import { en } from '../localization/en';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getActiveTariff, getTariff } from '../config/tariffs';
import { Capacitor } from '@capacitor/core';
import { estimateFare } from '../domain/fare/calculator';
import type { Supplements } from '../domain/fare/types';
import { buildRecord } from '../domain/trip/buildRecord';
import { analyzeTrack } from '../domain/trip/gpsTrack';
import { liveTripInput } from '../domain/trip/tripInput';
import type { TripRecord } from '../domain/trip/types';
import { requestWakeLock, stopKnownPositionWatches, watchPosition } from '../services/geolocation/watcher';
import type { ActiveRide, ActiveRideRead, ActiveRideRecovery } from '../storage/activeRide';
import { clearActiveRide, clearActiveRideStatus, loadActiveRide, saveActiveRide, type ActiveCleanupStatus } from '../storage/activeRide';
import { clearNativeRecovery, establishNativeRecovery, readNativeRecovery, readCleanupRecovery, establishCleanupRecovery } from '../storage/nativeRecovery';

export type RideCleanup = { storage: ActiveCleanupStatus; guardReady: boolean };
function storedStatus(read: ActiveRideRead): ActiveCleanupStatus {
  return read.status === 'absent' ? 'absent' : read.status === 'unavailable' ? 'uncertain' : 'retained';
}

function compute(ride: ActiveRide, endMs: number) {
  const tariff = typeof ride.tariffId === 'string' ? getTariff(ride.tariffId) : undefined;
  if (!tariff) return null;
  const track = analyzeTrack(ride.samples, ride.startMs, endMs);
  const estimate = estimateFare(liveTripInput(track, ride.startMs, endMs, ride.supplements), tariff);
  return { track, estimate };
}

function restoredState(read: ActiveRideRead): { ride: ActiveRide | null; recovery: ActiveRideRecovery | null } {
  if (read.status === 'absent') return { ride: null, recovery: null };
  if (read.status !== 'valid') return { ride: null, recovery: { kind: 'storage', reason: read.status } };
  const restored = read.ride;
  if (typeof restored.tariffId !== 'string' || !restored.tariffId.trim() || !getTariff(restored.tariffId)) {
    return { ride: null, recovery: { kind: 'tariff', ride: restored } };
  }
  if(isIosPlatform())return {ride:null,recovery:{kind:'storage',reason:'present'}};
  return { ride: restored as ActiveRide, recovery: null };
}

export function useLiveRide(initialRead?: ActiveRideRead) {
  const [initial] = useState(() => ({ read: initialRead ?? loadActiveRide(), cleanup: readCleanupRecovery() }));
  const [state, setState] = useState(() => initial.cleanup !== 'clear'
    ? { ride: null, recovery: { kind: 'storage', reason: 'cleanup' } as ActiveRideRecovery }
    : restoredState(initial.read));
  const { ride, recovery } = state;
  const recoveryRef = useRef(recovery);
  const [cleanup, setCleanup] = useState<RideCleanup | null>(() => initial.cleanup !== 'clear'
    ? { storage: storedStatus(initial.read), guardReady: initial.cleanup === 'blocked' } : null);
  const cleanupRef = useRef(cleanup);
  const [nativeGuard, setNativeGuard] = useState(() => {
    const status = Capacitor.isNativePlatform() ? readNativeRecovery() : 'clear';
    return { blocked: Capacitor.isNativePlatform() && (recovery !== null || status !== 'clear'),
      error: status === 'unavailable' ? en.rideFeedback.androidRecoveryStorageCouldNotBe : null as string | null };
  });
  const nativeRestartBlocked = nativeGuard.blocked;
  const nativeBlockRef = useRef(nativeRestartBlocked);
  const [recoveryStorageError, setRecoveryStorageError] = useState(false);
  const rideRef = useRef(ride);
  const [now, setNow] = useState(Date.now());
  const [storageError, setStorageError] = useState(false);
  const stopWatch = useRef<(() => void) | null>(null);
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);

  const update = useCallback((fn: (r: ActiveRide) => ActiveRide) => {
    if (!rideRef.current || recoveryRef.current || nativeBlockRef.current) return;
    const next = fn(rideRef.current);
    rideRef.current = next;
    setStorageError(!saveActiveRide(next));
    setState({ ride: next, recovery: null });
  }, []);

  const active = ride !== null && !nativeRestartBlocked;
  useEffect(() => {
    if (!recovery || (recovery.kind === 'storage' && recovery.reason === 'cleanup') || !Capacitor.isNativePlatform()) return;
    if (!establishNativeRecovery()) setNativeGuard({ blocked: true,
      error: en.rideFeedback.theAndroidRecoveryGuardCouldNot });
  }, [recovery]);
  useEffect(() => {
    if (!recovery && !nativeRestartBlocked) return;
    stopWatch.current?.();
    stopWatch.current = null;
    void wakeLock.current?.release().catch(() => undefined);
    wakeLock.current = null;
    stopKnownPositionWatches();
  }, [recovery, nativeRestartBlocked]);
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    const takeWakeLock = async () => {
      if (Capacitor.isNativePlatform()) return;
      const lock = await requestWakeLock();
      if (disposed) { await lock?.release().catch(() => undefined); return; }
      void wakeLock.current?.release().catch(() => undefined);
      wakeLock.current = lock;
    };
    const stop = watchPosition(
      (s) => update((r) => ({ ...r, gpsStatus: 'ok', samples: [...r.samples, s] })),
      (e) => update((r) => ({ ...r, gpsStatus: e })),
    );
    stopWatch.current = stop;
    void takeWakeLock();
    const timer = setInterval(() => setNow(Date.now()), 1000);
    // The wake lock is dropped when the page is hidden; take it again on return.
    const onVisible = () => {
      if (document.visibilityState === 'visible') { setNow(Date.now()); void takeWakeLock(); }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      disposed = true;
      stop();
      stopWatch.current = null;
      void wakeLock.current?.release().catch(() => undefined);
      wakeLock.current = null;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [active, update]);

  const start = useCallback((supplements: Supplements) => {
    if (rideRef.current || recoveryRef.current || nativeBlockRef.current) return;
    const read = loadActiveRide();
    if (read.status !== 'absent') {
      const restored = restoredState(read);
      const pending: ActiveRideRecovery = restored.recovery ?? { kind: 'storage', reason: 'present' };
      recoveryRef.current = pending;
      if (Capacitor.isNativePlatform()) {
        nativeBlockRef.current = true;
        setNativeGuard({ blocked: true, error: null });
      }
      setState({ ride: null, recovery: pending });
      return;
    }
    if (Capacitor.isNativePlatform() && readNativeRecovery() !== 'clear') {
      nativeBlockRef.current = true;
      setNativeGuard({ blocked: true, error: en.rideFeedback.androidRecoveryIsPendingOrStorage });
      return;
    }
    const r: ActiveRide = { tariffId: getActiveTariff().id, startMs: Date.now(), samples: [], supplements, gpsStatus: 'waiting' };
    rideRef.current = r;
    setStorageError(!saveActiveRide(r));
    setState({ ride: r, recovery: null });
    setNow(r.startMs);
  }, []);

  const pendingCleanup = (storage: ActiveCleanupStatus, guardReady: boolean) => {
    const pending: ActiveRideRecovery = { kind: 'storage', reason: 'cleanup' };
    cleanupRef.current = { storage, guardReady };
    setCleanup(cleanupRef.current);
    recoveryRef.current = pending;
    setState({ ride: null, recovery: pending });
    if (Capacitor.isNativePlatform()) {
      nativeBlockRef.current = true;
      setNativeGuard({ blocked: true, error: null });
    }
  };

  const attemptCleanup = (retrying: boolean): boolean => {
    if (!establishCleanupRecovery()) { pendingCleanup(storedStatus(loadActiveRide()), false); return false; }
    const storage = clearActiveRideStatus();
    if (storage !== 'absent') { pendingCleanup(storage, true); return false; }
    const nativeRetry = Capacitor.isNativePlatform() && retrying;
    if (nativeRetry ? !establishNativeRecovery() : !clearNativeRecovery()) {
      establishCleanupRecovery();
      pendingCleanup('absent', false);
      return false;
    }
    cleanupRef.current = null;
    setCleanup(null);
    recoveryRef.current = null;
    setState({ ride: null, recovery: null });
    nativeBlockRef.current = nativeRetry;
    setNativeGuard({ blocked: nativeRetry, error: null });
    return true;
  };

  const release = () => {
    if (!rideRef.current || recoveryRef.current || nativeBlockRef.current) return;
    rideRef.current = null;
    stopWatch.current?.();
    stopWatch.current = null;
    void wakeLock.current?.release().catch(() => undefined);
    wakeLock.current = null;
    pendingCleanup('uncertain', false);
    attemptCleanup(false);
  };

  const end = useCallback((): TripRecord | null => {
    const current = rideRef.current;
    if (!current || nativeBlockRef.current) return null;
    const endMs = Date.now();
    const computed = compute(current, endMs);
    if (!computed) return null;
    const { track, estimate } = computed;
    const trip = buildRecord({
      mode: 'live', startMs: current.startMs, endMs, distanceM: track.intervals.reduce((a, i) => a + i.distanceM, 0),
      estimate, supplements: current.supplements, track,
    });
    release();
    return trip;
  }, []);

  const cancel = useCallback(() => release(), []);
  const retryCleanup = () => cleanupRef.current !== null && attemptCleanup(true);
  const discardRecovery = useCallback((): boolean => {
    if (!recoveryRef.current || cleanupRef.current || (recoveryRef.current.kind === 'storage' && recoveryRef.current.reason === 'unavailable')) return false;
    if (Capacitor.isNativePlatform()) {
      nativeBlockRef.current = true;
      if (!establishNativeRecovery()) {
        setNativeGuard({ blocked: true, error: en.rideFeedback.theAndroidRecoveryGuardCouldNot });
        return false;
      }
      setNativeGuard({ blocked: true, error: null });
    }
    if (!clearActiveRide()) { setRecoveryStorageError(true); return false; }
    recoveryRef.current = null;
    setRecoveryStorageError(false);
    setState({ ride: null, recovery: null });
    return true;
  }, []);

  const acknowledgeNativeRecovery = useCallback((): boolean => {
    if (!canAcknowledgeNativeRecovery() || !nativeBlockRef.current || recoveryRef.current) return false;
    if (!clearNativeRecovery()) {
      // Re-establish the guard if removal succeeded but its readback failed.
      establishNativeRecovery();
      setNativeGuard({ blocked: true, error: en.rideFeedback.recoveryCompletionCouldNotBeSaved });
      return false;
    }
    nativeBlockRef.current = false;
    setNativeGuard({ blocked: false, error: null });
    return true;
  }, []);

  const live = useMemo(() => (ride && !nativeRestartBlocked ? compute(ride, Math.max(now, ride.startMs)) : null), [ride, now, nativeRestartBlocked]);

  return { ride, recovery, cleanup, retryCleanup, nativeRestartBlocked, nativeRecoveryError: nativeGuard.error, acknowledgeNativeRecovery, recoveryStorageError, discardRecovery, now, live, storageError, start, end, cancel,
    setSupplements: (s: Supplements) => update((r) => ({ ...r, supplements: s })) };
}
