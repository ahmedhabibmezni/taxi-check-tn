import type { TripRecord } from '../domain/trip/types';
import { formatTnd } from './money';

const CSV_HEADER = [
  'id', 'mode', 'start', 'end', 'duration_min', 'distance_km', 'moving_min', 'slow_min',
  'start_lat', 'start_lon', 'end_lat', 'end_lon',
  'estimate_tnd', 'low_tnd', 'high_tnd', 'meter_tnd', 'diff_tnd', 'diff_pct',
  'airport', 'luggage', 'tariff', 'confidence',
];

export function tripsToCsv(trips: TripRecord[]): string {
  const rows = trips.map((t) => [
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

export function downloadFile(name: string, content: string, type: string): void {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
