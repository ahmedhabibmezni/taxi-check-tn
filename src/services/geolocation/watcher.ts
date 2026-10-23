import type { GpsSample } from '../../domain/trip/gpsTrack';

export type GpsError = 'denied' | 'unavailable';

/** Starts high-accuracy watching. Permission is only requested when this is called. */
export function watchPosition(onSample: (s: GpsSample) => void, onError: (e: GpsError) => void): () => void {
  if (!('geolocation' in navigator)) {
    onError('unavailable');
    return () => {};
  }
  const id = navigator.geolocation.watchPosition(
    (p) =>
      onSample({
        t: p.timestamp,
        lat: p.coords.latitude,
        lon: p.coords.longitude,
        accuracy: p.coords.accuracy,
        speed: p.coords.speed,
      }),
    (err) => onError(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable'),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}

/** Keeps the screen on during a ride; browsers pause GPS when the screen turns off. */
export async function requestWakeLock(): Promise<{ release: () => Promise<void> } | null> {
  try {
    const wl = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock;
    return wl ? await wl.request('screen') : null;
  } catch {
    return null;
  }
}
