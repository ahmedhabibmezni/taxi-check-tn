import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getActiveTariff } from '../config/tariffs';
import { estimateFare } from '../domain/fare/calculator';
import type { Supplements } from '../domain/fare/types';
import { buildRecord } from '../domain/trip/buildRecord';
import { analyzeTrack } from '../domain/trip/gpsTrack';
import { liveTripInput } from '../domain/trip/tripInput';
import type { TripRecord } from '../domain/trip/types';
import { requestWakeLock, watchPosition } from '../services/geolocation/watcher';
import type { ActiveRide } from '../storage/activeRide';
import { clearActiveRide, loadActiveRide, saveActiveRide } from '../storage/activeRide';

function compute(ride: ActiveRide, endMs: number) {
  const track = analyzeTrack(ride.samples, ride.startMs, endMs);
  const estimate = estimateFare(liveTripInput(track, ride.startMs, endMs, ride.supplements), getActiveTariff());
  return { track, estimate };
}

export function useLiveRide() {
  const [ride, setRide] = useState<ActiveRide | null>(() => loadActiveRide());
  const [now, setNow] = useState(Date.now());
  const stopWatch = useRef<(() => void) | null>(null);
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);

  const update = useCallback((fn: (r: ActiveRide) => ActiveRide) => {
    setRide((prev) => {
      if (!prev) return prev;
      const next = fn(prev);
      saveActiveRide(next);
      return next;
    });
  }, []);

  const startWatching = useCallback(() => {
    stopWatch.current?.();
    stopWatch.current = watchPosition(
      (s) => update((r) => ({ ...r, gpsStatus: 'ok', samples: [...r.samples, s] })),
      (e) => update((r) => ({ ...r, gpsStatus: r.samples.length && e === 'unavailable' ? r.gpsStatus : e })),
    );
    void requestWakeLock().then((wl) => (wakeLock.current = wl));
  }, [update]);

  const active = ride !== null;
  useEffect(() => {
    if (!active) return;
    if (!stopWatch.current) startWatching();
    const timer = setInterval(() => setNow(Date.now()), 1000);
    // The wake lock is dropped when the page is hidden; take it again on return.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void requestWakeLock().then((wl) => (wakeLock.current = wl));
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [active, startWatching]);

  useEffect(() => () => stopWatch.current?.(), []);

  const start = useCallback((supplements: Supplements) => {
    const r: ActiveRide = { startMs: Date.now(), samples: [], supplements, gpsStatus: 'waiting' };
    saveActiveRide(r);
    setRide(r);
    setNow(r.startMs);
  }, []);

  const release = () => {
    stopWatch.current?.();
    stopWatch.current = null;
    void wakeLock.current?.release().catch(() => undefined);
    wakeLock.current = null;
    clearActiveRide();
    setRide(null);
  };

  const end = useCallback((): TripRecord | null => {
    if (!ride) return null;
    const endMs = Date.now();
    const { track, estimate } = compute(ride, endMs);
    release();
    return buildRecord({
      mode: 'live', startMs: ride.startMs, endMs, distanceM: track.intervals.reduce((a, i) => a + i.distanceM, 0),
      estimate, supplements: ride.supplements, track,
    });
  }, [ride]);

  const cancel = useCallback(() => release(), []);

  const live = useMemo(() => (ride ? compute(ride, Math.max(now, ride.startMs)) : null), [ride, now]);

  return { ride, now, live, start, end, cancel, setSupplements: (s: Supplements) => update((r) => ({ ...r, supplements: s })) };
}
