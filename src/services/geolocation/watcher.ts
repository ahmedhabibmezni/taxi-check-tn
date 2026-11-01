import { getMessages } from '../../localization';
import type { GpsSample } from '../../domain/trip/gpsTrack';
import { Capacitor, registerPlugin } from '@capacitor/core';
import type { BackgroundGeolocationPlugin } from '@capacitor-community/background-geolocation';
import { LocalNotifications } from '@capacitor/local-notifications';

const backgroundGps = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation');
const knownStops = new Set<() => void>();

/** Stops only watchers owned by this JavaScript runtime, including pending startup. */
export function stopKnownPositionWatches(): void {
  for (const stop of [...knownStops]) stop();
}

function watchNative(onSample: (s: GpsSample) => void, onError: (e: GpsError) => void): () => void {
  let cancelled = false;
  let watcherId: string | undefined;
  const start = async () => {
    // Notifications explain the foreground service; location is requested by the
    // GPS plugin separately. Refusing notifications must not disable manual mode.
    try {
      const permission = await LocalNotifications.checkPermissions();
      if (permission.display === 'prompt') await LocalNotifications.requestPermissions();
    } catch { /* Location can still run with notifications blocked. */ }
    if (cancelled) return;
    const en = getMessages();
    watcherId = await backgroundGps.addWatcher({
      backgroundTitle: en.notification.taxiCheckRideInProgress,
      backgroundMessage: en.notification.recordingYourRouteOnThisPhone,
      requestPermissions: true,
      stale: false,
      distanceFilter: 0,
    }, (position, error) => {
      if (cancelled) return;
      if (error) {
        onError(error.code === 'NOT_AUTHORIZED' ? 'denied' : 'unavailable');
      } else if (position && position.time !== null) {
        onSample({ t: position.time, lat: position.latitude, lon: position.longitude,
          accuracy: position.accuracy, speed: position.speed });
      }
    });
    // The user may end the ride while the Android permission dialog is open.
    if (cancelled) await backgroundGps.removeWatcher({ id: watcherId });
  };
  void start().catch((error: { code?: string }) => {
    if (!cancelled) onError(error.code === 'NOT_AUTHORIZED' ? 'denied' : 'unavailable');
  });
  return () => {
    cancelled = true;
    if (watcherId) void backgroundGps.removeWatcher({ id: watcherId }).catch(() => undefined);
  };
}

export type GpsError = 'denied' | 'unavailable';

/** Starts high-accuracy watching. Permission is only requested when this is called. */
export function watchPosition(onSample: (s: GpsSample) => void, onError: (e: GpsError) => void): () => void {
  let stopped = false;
  const stopPlatform = watchPlatform(
    (sample) => { if (!stopped) onSample(sample); },
    (error) => { if (!stopped) onError(error); },
  );
  const stop = () => {
    if (stopped) return;
    stopped = true;
    knownStops.delete(stop);
    stopPlatform();
  };
  knownStops.add(stop);
  return stop;
}

function watchPlatform(onSample: (s: GpsSample) => void, onError: (e: GpsError) => void): () => void {
  if (Capacitor.isNativePlatform()) return watchNative(onSample, onError);
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
