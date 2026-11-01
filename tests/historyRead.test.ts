// @vitest-environment jsdom
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { tripStore } from '../src/storage/tripStore';
import { TripResult } from '../src/components/TripResult';
import type { TripRecord } from '../src/domain/trip/types';
import { readCompletedHistory, readCompletedTrip } from '../src/storage/completedTrip';
import { HistoryPage } from '../src/pages/HistoryPage';
import { App } from '../src/App';
import { catalogs, selectLanguage, type Language } from '../src/localization';
import { downloadFile } from '../src/utils/export';

const gps = vi.hoisted(() => ({ watch: vi.fn(() => vi.fn()), stop: vi.fn() }));
vi.mock('../src/services/geolocation/watcher', () => ({ watchPosition: gps.watch,
  requestWakeLock: vi.fn(async () => null), stopKnownPositionWatches: gps.stop }));
vi.mock('../src/utils/export', async original => ({ ...await original<typeof import('../src/utils/export')>(),
  downloadFile: vi.fn(async () => 'download-requested') }));

function record(): TripRecord {
  return { id: 'synthetic-c2', mode: 'manual', startMs: 0, endMs: 60000, durationS: 60,
    distanceM: 0, movingTimeS: 0, slowTimeS: 60, startCoords: null, endCoords: null,
    estimate: { best: 7777, low: 7000, high: 8000, breakdown: { initialFare: 7777, distanceCharge: 0,
      waitingCharge: 0, nightSurcharge: 0, airportSupplement: 0, luggageSupplement: 0, total: 7777 } },
    meter: null, diff: null, diffPct: null, tariffId: 'unknown-historical', strategyId: 'old-strategy',
    supplements: { airportDeparture: false, luggageItems: 0 }, confidence: .35, warnings: ['Unknown historical warning'] };
}

function database(values: unknown[], error = false) {
  const writes = vi.fn();
  const db = { close: vi.fn(), transaction: vi.fn(() => {
    const tx = { oncomplete: null as (() => void) | null, onabort: null as (() => void) | null,
      onerror: null as (() => void) | null, error: new Error('Synthetic read failure'),
      objectStore: () => ({ getAll: () => request(values), get: () => request(values[0]), put: writes, delete: writes }) };
    function request(result: unknown) { queueMicrotask(() => error ? tx.onabort?.() : tx.oncomplete?.()); return { result }; }
    return tx;
  }) };
  const req = { result: db, onsuccess: null as (() => void) | null };
  vi.stubGlobal('indexedDB', { open: () => { queueMicrotask(() => req.onsuccess?.()); return req; } });
  return { db, writes };
}
beforeEach(() => { localStorage.clear(); selectLanguage('en'); vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it('reads null entries without letting them reject the whole History operation', async () => {
  database([null, { id: 'unreadable' }]);
  await expect(tripStore.list()).resolves.toHaveLength(2);
});
it('classifies an unreadable direct saved-record load', async () => {
  database([{ id: 'unreadable' }]);
  await expect(tripStore.get('unreadable')).resolves.toEqual({ status: 'unreadable' });
});
it('renders an explicit saved-result error instead of dereferencing a missing estimate', () => {
  expect(() => renderToString(createElement(TripResult, {
    trip: { id: 'unreadable' } as TripRecord, isSaved: true, onSave: vi.fn(),
  }))).not.toThrow();
});

it('accepts current and compatible legacy values without looking up tariff/strategy/warning meanings', () => {
  const current = record();
  expect(readCompletedTrip(current)).toEqual(current);
  const legacy: Record<string, unknown> = { ...current, extra: { keep: true }, meter: 0, diff: -7777, diffPct: 0 };
  delete legacy.startCoords; delete legacy.endCoords;
  const before = JSON.stringify(legacy);
  expect(readCompletedTrip(legacy)).toEqual({ ...legacy, startCoords: null, endCoords: null });
  expect(JSON.stringify(legacy)).toBe(before);
});
it.each(['meter', 'diff', 'diffPct', 'startCoords', 'endCoords'])('accepts omitted legacy %s only as an in-memory null', key => {
  const legacy: Record<string, unknown> = { ...record() }; delete legacy[key];
  expect(readCompletedTrip(legacy)?.[key as keyof TripRecord]).toBeNull();
  expect(Object.prototype.hasOwnProperty.call(legacy, key)).toBe(false);
});
it('accepts zeros, fractional measurements and signed comparisons without requiring totals to match current algorithms', () => {
  const trip = record(); trip.distanceM = .125; trip.durationS = .5; trip.movingTimeS = .25;
  trip.estimate.best = 0; trip.estimate.low = 0; trip.estimate.high = 0; trip.estimate.breakdown.total = 0;
  trip.meter = 0; trip.diff = -7777; trip.diffPct = -100.25; trip.confidence = 0;
  expect(readCompletedTrip(trip)).toEqual(trip);
});
const invalid: [string, unknown][] = [
  ['null', null], ['number', 1], ['array', []], ['missing estimate', { ...record(), estimate: undefined }],
  ['missing breakdown', { ...record(), estimate: { best: 0, low: 0, high: 0 } }],
  ['unsupported mode', { ...record(), mode: 'future' }], ['invalid date string', { ...record(), startMs: 'yesterday' }],
  ['out-of-Date-range', { ...record(), endMs: 8.65e15 }], ['null date', { ...record(), startMs: null }],
  ['NaN date', { ...record(), startMs: NaN }], ['infinite duration', { ...record(), durationS: Infinity }],
  ['negative distance', { ...record(), distanceM: -1 }], ['nonfinite confidence', { ...record(), confidence: NaN }],
  ['bad warning', { ...record(), warnings: [null] }], ['missing warnings', { ...record(), warnings: undefined }],
  ['invalid coordinates', { ...record(), startCoords: { lat: 1, lon: Infinity } }],
  ['missing coordinate member', { ...record(), endCoords: { lat: 1 } }],
  ['fractional millimes', { ...record(), meter: 1.5 }], ['negative meter', { ...record(), meter: -1 }],
  ['string percentage', { ...record(), diffPct: '0' }], ['infinite percentage', { ...record(), diffPct: Infinity }],
  ['fractional diff', { ...record(), diff: .2 }], ['object diff', { ...record(), diff: {} }],
  ['bad luggage', { ...record(), supplements: { airportDeparture: false, luggageItems: .5 } }],
  ['bad supplements', { ...record(), supplements: null }], ['missing ID', { ...record(), id: undefined }],
];
it.each(invalid)('retains but rejects unsafe %s', (_label, value) => {
  const before = structuredClone(value);
  expect(readCompletedTrip(value)).toBeNull(); expect(value).toEqual(before);
});
it.each(['best', 'low', 'high'])('rejects unsafe estimate %s', key => {
  const trip = record(); trip.estimate[key as 'best'] = Infinity;
  expect(readCompletedTrip(trip)).toBeNull();
});
it.each(['initialFare', 'distanceCharge', 'waitingCharge', 'nightSurcharge', 'airportSupplement', 'luggageSupplement', 'total'] as const)(
  'rejects unsafe breakdown %s', key => {
    const trip = record(); trip.estimate.breakdown[key] = .5; expect(readCompletedTrip(trip)).toBeNull();
  });
it('sorts only usable detached views and counts every rejected entry', () => {
  const earlier = record(); const later = { ...record(), id: 'later', startMs: 1000 };
  const values = [earlier, null, later, { id: 'bad' }]; const before = structuredClone(values);
  expect(readCompletedHistory(values)).toEqual({ trips: [later, earlier], unreadable: 2 });
  expect(values).toEqual(before);
});
it.each([undefined, null, record()])('direct get distinguishes missing/unreadable/valid (%j)', async value => {
  const { writes } = database([value]);
  await expect(tripStore.get('id')).resolves.toEqual(value === undefined ? { status: 'missing' }
    : value === null ? { status: 'unreadable' } : { status: 'valid', trip: value });
  expect(writes).not.toHaveBeenCalled();
});
it('does not convert direct database read failure to missing', async () => {
  database([], true); await expect(tripStore.get('id')).rejects.toThrow('Synthetic read failure');
});
it.each(['en', 'aeb', 'ar', 'fr'] as Language[])('renders mixed History and blocks misleading bulk export in %s', async language => {
  selectLanguage(language); const copy = catalogs[language];
  const values = [null, record(), { id: 'invalid' }]; const before = structuredClone(values);
  const { writes } = database(values); const onOpen = vi.fn();
  const view = render(createElement(HistoryPage, { onBack: vi.fn(), onOpen }));
  expect(await screen.findByText(copy.historyRead.partial(2))).toBeTruthy();
  expect(screen.getByText(copy.historyRead.bulkBlocked(2))).toBeTruthy();
  expect(screen.queryByRole('button', { name: copy.history.exportAllAsCSV })).toBeNull();
  fireEvent.click(screen.getByText(copy.history.estimated('7.8')));
  expect(onOpen).toHaveBeenCalledWith(record()); expect(values).toEqual(before); expect(writes).not.toHaveBeenCalled();
  view.unmount();
  render(createElement(TripResult, { trip: onOpen.mock.calls[0][0], isSaved: true, onSave: vi.fn() }));
  expect(screen.getByText('Unknown historical warning')).toBeTruthy();
  expect(screen.getByText(copy.shared.tariffMetadataIsUnavailableForThis)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: copy.result.exportJSON }));
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: copy.export.optionsTitle(copy.result.exportJSON) }));
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: copy.export.continueExport }));
  await waitFor(() => expect(downloadFile).toHaveBeenCalledTimes(1));
  expect(JSON.parse(vi.mocked(downloadFile).mock.calls[0][1])).toEqual(record());
  expect(values).toEqual(before); expect(writes).not.toHaveBeenCalled();
});
it.each(['en', 'aeb', 'ar', 'fr'] as Language[])('shows all-unreadable, not empty, in %s', async language => {
  selectLanguage(language); const copy = catalogs[language]; database([null, { id: 'bad' }]);
  render(createElement(HistoryPage, { onBack: vi.fn(), onOpen: vi.fn() }));
  expect(await screen.findByText(copy.historyRead.allUnreadable(2))).toBeTruthy();
  expect(screen.queryByText(copy.history.noSavedTripsYetReturnTo)).toBeNull();
  expect(screen.queryByText(copy.historyRead.bulkBlocked(2))).toBeNull();
  expect(screen.queryByRole('button', { name: copy.history.exportAllAsCSV })).toBeNull();
});
it('reports database-open failure and a failed retry without implying empty History or mutating records', async () => {
  const open = vi.fn(() => { throw new Error('Synthetic database unavailable'); });
  vi.stubGlobal('indexedDB', { open });
  render(createElement(HistoryPage, { onBack: vi.fn(), onOpen: vi.fn() }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', catalogs.en.history.couldNotReadTheTripHistory);
  fireEvent.click(screen.getByRole('button', { name: 'Retry history' }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', catalogs.en.history.couldNotReadTheTripHistory);
  expect(open).toHaveBeenCalledTimes(2);
  expect(screen.queryByText(catalogs.en.history.noSavedTripsYetReturnTo)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Export all as CSV' })).toBeNull();
});
it('distinguishes failed reads from empty and retries actual storage without writes', async () => {
  const failure = database([], true);
  render(createElement(HistoryPage, { onBack: vi.fn(), onOpen: vi.fn() }));
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', catalogs.en.history.couldNotReadTheTripHistory);
  expect(screen.queryByText(catalogs.en.history.noSavedTripsYetReturnTo)).toBeNull();
  const success = database([]);
  fireEvent.click(screen.getByRole('button', { name: 'Retry history' }));
  expect(await screen.findByText(catalogs.en.history.noSavedTripsYetReturnTo)).toBeTruthy();
  expect(failure.db.transaction).toHaveBeenCalledTimes(1); expect(success.db.transaction).toHaveBeenCalledTimes(1);
  expect(failure.writes).not.toHaveBeenCalled(); expect(success.writes).not.toHaveBeenCalled();
});
it('keeps malformed direct Results noninteractive and can subsequently display a valid result', () => {
  const save = vi.fn();
  const view = render(createElement(TripResult, { trip: null as unknown as TripRecord, isSaved: true, onSave: save }));
  expect(screen.getByRole('alert').textContent).toBe(catalogs.en.historyRead.resultUnreadable);
  expect(screen.queryByRole('button')).toBeNull();
  view.rerender(createElement(TripResult, { trip: record(), isSaved: true, onSave: save }));
  expect(screen.getByRole('button', { name: 'Export JSON' })).toBeTruthy(); expect(save).not.toHaveBeenCalled();
});
it('shows an omitted comparison honestly and preserves zero meter and original comparison values during unedited export', async () => {
  const trip = { ...record(), meter: 0, diff: -7777, diffPct: 0 };
  database([{ ...trip, diffPct: undefined }]);
  const view = render(createElement(HistoryPage, { onBack: vi.fn(), onOpen: vi.fn() }));
  expect(await screen.findByText(catalogs.en.historyRead.meterWithoutComparison('0.0'))).toBeTruthy(); view.unmount();
  render(createElement(TripResult, { trip, isSaved: true, onSave: vi.fn() }));
  fireEvent.click(screen.getByRole('button', { name: 'Export JSON' }));
  fireEvent.click(screen.getByRole('button', { name: 'Continue export' }));
  await waitFor(() => expect(downloadFile).toHaveBeenCalledTimes(1));
  expect(JSON.parse(vi.mocked(downloadFile).mock.calls[0][1])).toEqual(trip);
});
it('retains C1 guard data and independent Manual/History navigation with mixed completed data', async () => {
  const raw = '{ malformed active'; localStorage.setItem('taxi-check.active-ride', raw);
  const values = [null, record()]; const before = structuredClone(values); const { writes } = database(values);
  const view = render(createElement(App));
  fireEvent.click(screen.getByRole('button', { name: 'Go to Home: keep recovered ride' }));
  fireEvent.click(screen.getByRole('button', { name: 'Manual calculator' }));
  expect(screen.getByRole('heading', { name: 'Manual calculator' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  fireEvent.click(screen.getByRole('button', { name: 'Trip history' }));
  expect(await screen.findByText(catalogs.en.historyRead.partial(1))).toBeTruthy();
  fireEvent.click(screen.getByText(catalogs.en.history.estimated('7.8')));
  expect(screen.getByRole('button', { name: 'Export JSON' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(await screen.findByText(catalogs.en.historyRead.partial(1))).toBeTruthy();
  view.unmount(); render(createElement(App));
  expect(screen.getByRole('heading', { name: catalogs.en.activeStorage.title })).toBeTruthy();
  expect(localStorage.getItem('taxi-check.active-ride')).toBe(raw); expect(values).toEqual(before);
  expect(writes).not.toHaveBeenCalled(); expect(gps.watch).not.toHaveBeenCalled();
});
