// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TripRecord } from '../src/domain/trip/types';
import { downloadFile, tripToJson, tripsToCsv } from '../src/utils/export';

const platform = vi.hoisted(() => ({ native: false, os: 'android', mkdir: vi.fn(), write: vi.fn(), share: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => platform.native, getPlatform: () => platform.os } }));
vi.mock('@capacitor/filesystem', () => ({ Directory: { Cache: 'CACHE' }, Encoding: { UTF8: 'utf8' }, Filesystem: { mkdir: platform.mkdir, writeFile: platform.write } }));
vi.mock('@capacitor/share', () => ({ Share: { share: platform.share } }));

const trip: TripRecord = {
  id: 'synthetic,"quoted"', mode: 'live', startMs: 1793358000123, endMs: 1793358600456,
  durationS: 600, movingTimeS: 540, slowTimeS: 60, distanceM: 2500,
  startCoords: { lat: 36.812345, lon: 10.123456 }, endCoords: { lat: 36.912345, lon: 10.223456 },
  estimate: { best: 3000, low: 2500, high: 4000, breakdown: { initialFare: 900, distanceCharge: 2100,
    waitingCharge: 0, nightSurcharge: 0, airportSupplement: 0, luggageSupplement: 0, total: 3000 } },
  meter: 5000, diff: 2000, diffPct: 66.666, tariffId: 'historical-unavailable', strategyId: 'synthetic-model',
  supplements: { airportDeparture: false, luggageItems: 0 }, confidence: .5, warnings: ['Synthetic only'],
};
function cells(row: string) {
  return [...row.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(m => m[1].replace(/""/g, '"'));
}
beforeEach(() => { vi.resetAllMocks(); platform.native = false; platform.os = 'android';
  platform.mkdir.mockResolvedValue(undefined);
  platform.write.mockImplementation(async ({ path }) => ({ uri: `file:///synthetic-cache/${path}` })); platform.share.mockResolvedValue({}); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('export minimization and compatibility', () => {
  it('defaults JSON to explicit null endpoints and preserves every other field and precision', () => {
    const value = JSON.parse(tripToJson(trip));
    expect(value).toEqual({ ...trip, startCoords: null, endCoords: null });
    expect(JSON.parse(tripToJson(trip, true))).toEqual(trip);
  });
  it.each([false, true])('keeps CSV header/order/escaping and applies coordinate choice consistently across bulk rows (include=%s)', include => {
    const other = { ...trip, id: 'second', startCoords: null, endCoords: null, meter: null, diff: null, diffPct: null };
    const rows = tripsToCsv([trip, other], include).split('\n').map(cells);
    expect(rows[0]).toEqual(['id','mode','start','end','duration_min','distance_km','moving_min','slow_min',
      'start_lat','start_lon','end_lat','end_lon','estimate_tnd','low_tnd','high_tnd','meter_tnd','diff_tnd','diff_pct',
      'airport','luggage','tariff','confidence']);
    expect(rows.every(r => r.length === 22)).toBe(true);
    expect(rows[1][0]).toBe(trip.id);
    expect(rows[1].slice(8,12)).toEqual(include ? ['36.812345','10.123456','36.912345','10.223456'] : ['','','','']);
    expect(rows[2].slice(8,12)).toEqual(['','','','']);
    expect(rows[1][2]).toBe(new Date(trip.startMs).toISOString());
    expect(rows[1].slice(12,18)).toEqual(['3.000','2.500','4.000','5.000','2.000','66.7']);
    expect(rows[2].slice(15,18)).toEqual(['','','']);
  });
  it('excludes CSV coordinates by default, accepts absent legacy endpoints and never mutates frozen source records', () => {
    const frozen = structuredClone(trip);
    Object.freeze(frozen.startCoords); Object.freeze(frozen.endCoords); Object.freeze(frozen);
    const before = JSON.stringify(frozen);
    expect(cells(tripsToCsv([frozen]).split('\n')[1]).slice(8,12)).toEqual(['','','','']);
    tripToJson(frozen, true); tripsToCsv([frozen], true);
    expect(JSON.stringify(frozen)).toBe(before);
    const legacy = { ...trip, startCoords: undefined, endCoords: undefined } as unknown as TripRecord;
    expect(JSON.parse(tripToJson(legacy, true)).startCoords).toBeNull();
    expect(cells(tripsToCsv([legacy], true).split('\n')[1]).slice(8,12)).toEqual(['','','','']);
  });
});

describe('export adapter outcomes (native calls mocked)', () => {
  it('reports only a browser download request and revokes its Blob URL', async () => {
    vi.useFakeTimers();
    const create = vi.fn(() => 'blob:synthetic'); const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe('synthetic.json'); expect(this.href).toBe('blob:synthetic');
    });
    try {
      await expect(downloadFile('synthetic.json', tripToJson(trip), 'application/json')).resolves.toBe('download-requested');
      expect(click).toHaveBeenCalledTimes(1); expect(create.mock.calls[0]).toHaveLength(1);
      expect(platform.mkdir).not.toHaveBeenCalled(); expect(platform.write).not.toHaveBeenCalled(); expect(platform.share).not.toHaveBeenCalled();
      vi.runAllTimers(); expect(revoke).toHaveBeenCalledWith('blob:synthetic');
    } finally { vi.useRealTimers(); }
  });
  it('does not swallow a browser download-request error', async () => {
    vi.stubGlobal('URL', { createObjectURL: () => { throw new Error('Synthetic browser failure'); } });
    await expect(downloadFile('x.csv', '', 'text/csv')).rejects.toThrow('Synthetic browser failure');
  });
  it('stages only the prepared content and reports share return without claiming delivery', async () => {
    platform.native = true;
    const content = tripToJson(trip);
    await expect(downloadFile('x.json', content, 'application/json')).resolves.toBe('share-returned');
    const path = platform.write.mock.calls[0][0].path;
    expect(path).toMatch(/^taxi-check-export-[0-9a-f-]+\/x\.json$/);
    expect(platform.mkdir).toHaveBeenCalledWith({ path: path.split('/')[0], directory: 'CACHE', recursive: false });
    expect(platform.write).toHaveBeenCalledWith({ path, data: content, directory: 'CACHE', encoding: 'utf8' });
    expect(platform.share).toHaveBeenCalledWith({ title: 'x.json', files: [`file:///synthetic-cache/${path}`] });
  });
  it('propagates cache-write failure without opening share', async () => {
    platform.native = true; platform.write.mockRejectedValue(new Error('Synthetic full cache'));
    await expect(downloadFile('x.csv', '', 'text/csv')).rejects.toThrow('Synthetic full cache');
    expect(platform.share).not.toHaveBeenCalled();
  });
  it('recognizes the explicit cancellation signal from the installed Android and iOS plugins', async () => {
    platform.native = true; platform.share.mockRejectedValue(new Error('Share canceled'));
    await expect(downloadFile('x.csv', '', 'text/csv')).resolves.toBe('cancelled');
    platform.os = 'ios';
    await expect(downloadFile('x.csv', '', 'text/csv')).resolves.toBe('cancelled');
  });
  it('does not infer cancellation or success from a generic native error', async () => {
    platform.native = true; platform.share.mockRejectedValue(new Error('Synthetic share failure'));
    await expect(downloadFile('x.csv', '', 'text/csv')).rejects.toThrow('Synthetic share failure');
  });
});
