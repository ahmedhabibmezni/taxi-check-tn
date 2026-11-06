// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { downloadFile, tripToJson, tripsToCsv } from '../src/utils/export';
import type { TripRecord } from '../src/domain/trip/types';
import { TripResult } from '../src/components/TripResult';
import { renderTripCard } from '../src/utils/tripCard';
import { selectLanguage } from '../src/localization';

const native = vi.hoisted(() => ({ mkdir: vi.fn(), write: vi.fn(), share: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' } }));
vi.mock('@capacitor/filesystem', () => ({ Directory: { Cache: 'CACHE' }, Encoding: { UTF8: 'utf8' },
  Filesystem: { mkdir: native.mkdir, writeFile: native.write } }));
vi.mock('@capacitor/share', () => ({ Share: { share: native.share } }));

vi.mock('../src/utils/tripCard',async original=>({...await original<typeof import('../src/utils/tripCard')>(),renderTripCard:vi.fn()}));
const files = new Map<string, string>();
const directories = new Set<string>();
const events: string[] = [];
const uri = (path: string) => `file:///private/cache/${path.split('/').map(encodeURIComponent).join('/')}`;
beforeEach(() => {
  vi.resetAllMocks(); files.clear(); directories.clear(); events.length = 0; selectLanguage('en');
  URL.createObjectURL=vi.fn(()=> 'blob:card');URL.revokeObjectURL=vi.fn();
  vi.mocked(renderTripCard).mockImplementation(async snapshot=>({snapshot,blob:new Blob([JSON.stringify(snapshot)],{type:'image/png'}),width:1200,height:1600}));
  native.mkdir.mockImplementation(async ({ path }) => {
    if (directories.has(path)) throw new Error('Directory already exists');
    directories.add(path); events.push(`mkdir:${path}`);
  });
  native.write.mockImplementation(async ({ path, data }) => {
    const parent = path.slice(0, path.lastIndexOf('/'));
    if (path.includes('/') && !directories.has(parent)) throw new Error('Missing parent directory');
    files.set(path, data); events.push(`write:${path}`); return { uri: uri(path) };
  });
  native.share.mockImplementation(async ({ files: paths }) => { events.push(`share:${paths[0]}`); return {}; });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function trip(): TripRecord {
  return { id: 'synthetic', mode: 'manual', startMs: 0, endMs: 60000, durationS: 60, distanceM: 1234.5,
    movingTimeS: 30, slowTimeS: 30, startCoords: { lat: 36.8, lon: 10.1 }, endCoords: { lat: 36.9, lon: 10.2 },
    estimate: { best: 3000, low: 2500, high: 4000, breakdown: { initialFare: 900, distanceCharge: 2100,
      waitingCharge: 0, nightSurcharge: 0, airportSupplement: 0, luggageSupplement: 0, total: 3000 } },
    meter: 4000, diff: 1000, diffPct: 33.333, tariffId: 'unknown-historical', strategyId: 'legacy',
    supplements: { airportDeparture: false, luggageItems: 0 }, confidence: .5, warnings: [] };
}
it.each(['json', 'csv'])('retains earlier %s bytes and same basename across changed meter/coordinate exports', async format => {
  const first = trip(); const changed = { ...first, meter: 9123, diff: 6123, diffPct: 204.1 };
  const serialize = (value: TripRecord, include: boolean) => format === 'json' ? tripToJson(value, include) : tripsToCsv([value], include);
  const name = `trip-synthetic.${format}`;
  const original = serialize(first, false); const second = serialize(changed, true);
  await downloadFile(name, original, format === 'json' ? 'application/json' : 'text/csv');
  const earlierPath = native.write.mock.calls[0][0].path;
  const earlierUri = native.share.mock.calls[0][0].files[0];
  await downloadFile(name, second, format === 'json' ? 'application/json' : 'text/csv');
  expect(files.get(earlierPath)).toBe(original);
  expect(native.write.mock.calls[1][0].path).not.toBe(earlierPath);
  expect(native.share.mock.calls[1][0].files[0]).not.toBe(earlierUri);
  expect([...files.keys()].every(path => path.split('/').slice(-1)[0] === name)).toBe(true);
});
it('retains distinct repeated bulk CSV snapshots', async () => {
  const original = tripsToCsv([trip()], false); const next = tripsToCsv([trip(), { ...trip(), id: 'second' }], true);
  await downloadFile('taxi-trips.csv', original, 'text/csv');
  const firstPath = native.write.mock.calls[0][0].path;
  await downloadFile('taxi-trips.csv', next, 'text/csv');
  expect(files.get(firstPath)).toBe(original); expect(files.size).toBe(2);
  expect(native.share.mock.calls[0][0].files[0]).not.toBe(native.share.mock.calls[1][0].files[0]);
});

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}
it('allocates before writing, snapshots before asynchronous allocation, and shares only after the write finishes', async () => {
  const allocation = gate(); const writing = gate();
  const mkdir = native.mkdir.getMockImplementation()!; const write = native.write.getMockImplementation()!;
  native.mkdir.mockImplementationOnce(async options => { await allocation.promise; return mkdir(options); });
  native.write.mockImplementationOnce(async options => { await writing.promise; return write(options); });
  const value = trip(); const original = tripToJson(value);
  const pending = downloadFile('same.json', original, 'application/json');
  value.meter = 9999; value.startCoords!.lat = 0;
  expect(native.mkdir).toHaveBeenCalledTimes(1); expect(native.write).not.toHaveBeenCalled(); expect(native.share).not.toHaveBeenCalled();
  allocation.resolve(); await vi.waitFor(() => expect(native.write).toHaveBeenCalledTimes(1));
  expect(native.share).not.toHaveBeenCalled(); expect(files.size).toBe(0);
  writing.resolve(); await expect(pending).resolves.toBe('share-returned');
  const path = native.write.mock.calls[0][0].path;
  expect(files.get(path)).toBe(original);
  expect(events).toEqual([`mkdir:${path.split('/')[0]}`, `write:${path}`, `share:${uri(path)}`]);
});
it('isolates overlapping attempts even when the second write/share completes first', async () => {
  const firstWrite = gate(); const write = native.write.getMockImplementation()!;
  native.write.mockImplementationOnce(async options => { await firstWrite.promise; return write(options); });
  const first = downloadFile('same.json', 'first snapshot', 'application/json');
  await vi.waitFor(() => expect(native.write).toHaveBeenCalledTimes(1));
  await expect(downloadFile('same.json', 'second snapshot', 'application/json')).resolves.toBe('share-returned');
  const [one, two] = native.write.mock.calls.map(call => call[0].path);
  expect(one).not.toBe(two); expect(native.share.mock.calls[0][0].files).toEqual([uri(two)]);
  firstWrite.resolve(); await first;
  expect(native.share.mock.calls[1][0].files).toEqual([uri(one)]);
  expect(files.get(one)).toBe('first snapshot'); expect(files.get(two)).toBe('second snapshot');
});
it('keeps snapshots distinct while a native share is pending and preserves chooser failures', async () => {
  const sharing = gate(); native.share.mockImplementationOnce(async () => { await sharing.promise; return {}; });
  const first = downloadFile('same.csv', 'first', 'text/csv');
  await vi.waitFor(() => expect(native.share).toHaveBeenCalledTimes(1));
  native.share.mockRejectedValueOnce(new Error("Can't share while sharing is in progress"));
  await expect(downloadFile('same.csv', 'second', 'text/csv')).rejects.toThrow('sharing is in progress');
  expect(files.size).toBe(2); expect([...files.values()]).toEqual(['first', 'second']);
  sharing.resolve(); await first; expect([...files.values()]).toEqual(['first', 'second']);
});
it('does not derive uniqueness solely from time', async () => {
  vi.spyOn(Date, 'now').mockReturnValue(0);
  await Promise.all(Array.from({ length: 8 }, () => downloadFile('same.csv', 'snapshot', 'text/csv')));
  expect(files.size).toBe(8); expect(directories.size).toBe(8);
  expect(new Set(native.share.mock.calls.map(call => call[0].files[0])).size).toBe(8);
  expect([...directories].every(path => /^taxi-check-export-[0-9a-f-]{36}$/.test(path))).toBe(true);
});
it('fails closed on a directory collision instead of writing to an earlier attempt', async () => {
  vi.spyOn(crypto, 'randomUUID').mockReturnValue('11111111-1111-4111-8111-111111111111');
  await downloadFile('same.json', 'original', 'application/json');
  await expect(downloadFile('same.json', 'replacement', 'application/json')).rejects.toThrow('already exists');
  expect(files.size).toBe(1); expect([...files.values()]).toEqual(['original']);
  expect(native.write).toHaveBeenCalledTimes(1); expect(native.share).toHaveBeenCalledTimes(1);
});
it('does not fall back when secure ID creation is unavailable', async () => {
  vi.spyOn(crypto, 'randomUUID').mockImplementation(() => { throw new Error('Synthetic RNG unavailable'); });
  await expect(downloadFile('same.json', 'snapshot', 'application/json')).rejects.toThrow('RNG unavailable');
  expect(native.mkdir).not.toHaveBeenCalled(); expect(native.write).not.toHaveBeenCalled(); expect(native.share).not.toHaveBeenCalled();
});
it.each(['allocation', 'write'])('preserves earlier data after %s failure and uses a new attempt on retry', async stage => {
  await downloadFile('same.csv', 'original', 'text/csv');
  const originalPath = native.write.mock.calls[0][0].path;
  (stage === 'allocation' ? native.mkdir : native.write).mockRejectedValueOnce(new Error('Synthetic staging failure'));
  await expect(downloadFile('same.csv', 'failed snapshot', 'text/csv')).rejects.toThrow('staging failure');
  expect(native.share).toHaveBeenCalledTimes(1); expect(files.get(originalPath)).toBe('original');
  const failedDirectory = native.mkdir.mock.calls[1][0].path;
  await downloadFile('same.csv', 'retry snapshot', 'text/csv');
  const retryPath = native.write.mock.calls[native.write.mock.calls.length - 1][0].path;
  expect(retryPath.split('/')[0]).not.toBe(failedDirectory);
  expect(files.get(originalPath)).toBe('original'); expect(files.get(retryPath)).toBe('retry snapshot');
  expect(native.share).toHaveBeenCalledTimes(2);
});
it.each([undefined, null, {}, { uri: undefined }, { uri: '' }, { uri: 'not a URI' }, { uri: 'content://stale/file.json' },
  { uri: 'https://example.invalid/file.json' }, { uri: 'file:///private/cache/same.json' },
  { uri: 'file:///private/cache/%broken' }])('does not share malformed or stale write result %j', async result => {
  await downloadFile('same.json', 'original', 'application/json');
  const originalPath = native.write.mock.calls[0][0].path;
  const write = native.write.getMockImplementation()!;
  native.write.mockImplementationOnce(async options => { await write(options); return result; });
  await expect(downloadFile('same.json', 'not shared', 'application/json')).rejects.toThrow();
  expect(native.share).toHaveBeenCalledTimes(1); expect(files.get(originalPath)).toBe('original');
  const invalidPath = native.write.mock.calls[1][0].path;
  await downloadFile('same.json', 'retry', 'application/json');
  expect(native.write.mock.calls[2][0].path).not.toBe(invalidPath);
  expect(native.share.mock.calls[1][0].files[0]).not.toBe(uri(invalidPath));
});
it('rejects an earlier valid attempt URI returned for a later write', async () => {
  await downloadFile('same.json', 'original', 'application/json');
  const earlier = native.share.mock.calls[0][0].files[0]; const write = native.write.getMockImplementation()!;
  native.write.mockImplementationOnce(async options => { await write(options); return { uri: earlier }; });
  await expect(downloadFile('same.json', 'later', 'application/json')).rejects.toThrow('unexpected file URI');
  expect(native.share).toHaveBeenCalledTimes(1); expect([...files.values()]).toEqual(['original', 'later']);
});
it.each(['Share canceled', 'Synthetic share failure'])('retains staged bytes and allocates fresh retry after %s', async message => {
  native.share.mockRejectedValueOnce(new Error(message));
  const pending = downloadFile('same.csv', 'first', 'text/csv');
  if (message === 'Share canceled') await expect(pending).resolves.toBe('cancelled');
  else await expect(pending).rejects.toThrow(message);
  const firstPath = native.write.mock.calls[0][0].path;
  await downloadFile('same.csv', 'second', 'text/csv');
  expect(native.write.mock.calls[1][0].path).not.toBe(firstPath); expect(files.get(firstPath)).toBe('first');
});
it.each(['', '.', '..', '../same.json', '/same.json', 'sub/same.json', 'sub\\same.json'])(
  'rejects a non-basename native filename %j before allocating', async name => {
    await expect(downloadFile(name, 'data', 'application/json')).rejects.toThrow('filename');
    expect(native.mkdir).not.toHaveBeenCalled(); expect(native.write).not.toHaveBeenCalled(); expect(native.share).not.toHaveBeenCalled();
  });
it('retains spaces, punctuation and Unicode in the original visible basename and accepts its encoded local URI', async () => {
  const name = 'trip test العربية #%.json';
  await downloadFile(name, 'snapshot', 'application/json');
  expect(native.write.mock.calls[0][0].path.endsWith(`/${name}`)).toBe(true);
  expect(native.share.mock.calls[0][0]).toEqual({ title: name, files: [uri(native.write.mock.calls[0][0].path)] });
});
it('stages the frozen unsaved-meter card through the actual native UI adapter, including retry', async () => {
  const value=trip(), original=JSON.stringify(value), onSave=vi.fn();native.share.mockRejectedValueOnce(new Error('Synthetic share failure'));
  render(createElement(TripResult,{trip:value,isSaved:true,onSave}));
  fireEvent.change(screen.getByLabelText("Driver's meter"),{target:{value:'9.123'}});
  fireEvent.click(screen.getByRole('button',{name:'Share trip'}));
  fireEvent.click(screen.getByRole('checkbox',{name:'Include entered meter and comparison'}));
  fireEvent.click(screen.getByRole('button',{name:'Prepare PNG preview'}));await screen.findByRole('img');
  fireEvent.click(screen.getByRole('button',{name:'Share card image'}));
  await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('Delivery is not confirmed'));
  const firstPath=native.write.mock.calls[0][0].path, firstContent=files.get(firstPath)!;
  const text=new TextDecoder().decode(Uint8Array.from(atob(firstContent),c=>c.charCodeAt(0)));
  expect(text).toContain('9.123');expect(text).not.toContain('startCoords');expect(text).not.toContain(value.id);
  fireEvent.change(screen.getByLabelText("Driver's meter"),{target:{value:'8.765'}});
  fireEvent.click(screen.getByRole('button',{name:'Retry sharing or download'}));
  await screen.findByText('The share action returned. Delivery to the recipient is not confirmed.');
  const retryPath=native.write.mock.calls[1][0].path;expect(retryPath).not.toBe(firstPath);expect(files.get(retryPath)).toBe(firstContent);
  expect(files.get(firstPath)).toBe(firstContent);expect(JSON.stringify(value)).toBe(original);expect(onSave).not.toHaveBeenCalled();
});
