import type { TripRecord } from '../domain/trip/types';
import { formatTnd } from './money';
import { Capacitor } from '@capacitor/core';
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

const CSV_HEADER = [
  'id', 'mode', 'start', 'end', 'duration_min', 'distance_km', 'moving_min', 'slow_min',
  'start_lat', 'start_lon', 'end_lat', 'end_lon',
  'estimate_tnd', 'low_tnd', 'high_tnd', 'meter_tnd', 'diff_tnd', 'diff_pct',
  'airport', 'luggage', 'tariff', 'confidence',
];

export function tripForExport(trip: TripRecord, includeCoordinates = false): TripRecord {
  return { ...trip, startCoords: includeCoordinates && trip.startCoords ? { ...trip.startCoords } : null,
    endCoords: includeCoordinates && trip.endCoords ? { ...trip.endCoords } : null };
}

export function tripToJson(trip: TripRecord, includeCoordinates = false): string {
  return JSON.stringify(tripForExport(trip, includeCoordinates), null, 2);
}

export function tripsToCsv(trips: TripRecord[], includeCoordinates = false): string {
  const rows = trips.map((trip) => tripForExport(trip, includeCoordinates)).map((t) => [
    t.id, t.mode, new Date(t.startMs).toISOString(), new Date(t.endMs).toISOString(),
    (t.durationS / 60).toFixed(1), (t.distanceM / 1000).toFixed(2),
    (t.movingTimeS / 60).toFixed(1), (t.slowTimeS / 60).toFixed(1),
    t.startCoords?.lat ?? '', t.startCoords?.lon ?? '', t.endCoords?.lat ?? '', t.endCoords?.lon ?? '',
    formatTnd(t.estimate.best), formatTnd(t.estimate.low), formatTnd(t.estimate.high),
    t.meter === null ? '' : formatTnd(t.meter), t.diff === null ? '' : formatTnd(t.diff),
    t.diffPct === null ? '' : t.diffPct.toFixed(1),
    t.supplements.airportDeparture ? 'yes' : 'no', t.supplements.luggageItems, t.tariffId, t.confidence.toFixed(2),
  ]);
  return [CSV_HEADER, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
}

export type ExportOutcome = 'download-requested' | 'share-returned' | 'cancelled';

export async function downloadFile(name: string, content: string, type: string): Promise<ExportOutcome> {
  if (Capacitor.isNativePlatform()) {
    if (!name || /[\\/]/.test(name) || name === '.' || name === '..') throw new Error('Export requires a filename without directories');
    const snapshot = content;
    const attempt = `taxi-check-export-${crypto.randomUUID()}`;
    await Filesystem.mkdir({ path: attempt, directory: Directory.Cache, recursive: false });
    const path = `${attempt}/${name}`;
    const file = await Filesystem.writeFile({ path, data: snapshot, directory: Directory.Cache, encoding: Encoding.UTF8 });
    if (typeof file?.uri !== 'string') throw new Error('Export staging did not return a file URI');
    const staged = new URL(file.uri);
    if (staged.protocol !== 'file:' || staged.host !== '' || !decodeURIComponent(staged.pathname).endsWith(`/${path}`)) {
      throw new Error('Export staging returned an unexpected file URI');
    }
    try {
      await Share.share({ title: name, files: [file.uri] });
    } catch (error) {
      // The installed Android share plugin explicitly rejects canceled chooser results.
      if (Capacitor.getPlatform() === 'android' && error instanceof Error && error.message === 'Share canceled') return 'cancelled';
      throw error;
    }
    return 'share-returned';
  }
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  try { a.click(); }
  finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  return 'download-requested';
}
