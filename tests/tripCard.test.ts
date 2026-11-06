// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cardFixture } from './fixtures/card';
import { snapshotTripCard, renderTripCard } from '../src/utils/tripCard';
import { catalogs, type Language } from '../src/localization';



it.each(['aeb', 'ar', 'fr', 'en'] as Language[])('allowlists and freezes %s content without IDs, raw warnings, coordinates, time or default extras', language => {
  const source = cardFixture(); const original = structuredClone(source);
  const snapshot = snapshotTripCard(source, language, { comparison: false, details: false });
  const json = JSON.stringify(snapshot);
  expect(Object.keys(snapshot).sort()).toEqual(['blocks', 'direction', 'language']);
  for (const privateValue of ['private-record-id', 'private-tariff-id', 'private-strategy', '36.81', '10.27', '1793530800000', 'Private historical']) {
    expect(json).not.toContain(privateValue);
  }
  expect(json).not.toContain('6.125'); expect(json).not.toContain('5.0'); expect(json).not.toContain('20');
  expect(snapshot.blocks.map(b => b.text)).toContain(catalogs[language].card.limitedData);
  expect(snapshot.blocks.map(b => b.text)).toContain(catalogs[language].result.anIndependentEstimateNotAGuaranteed);
  expect(snapshot.blocks.map(b => b.text)).toContain(catalogs[language].live.tariffNotOfficiallyVerified);
  expect(source).toEqual(original);
  source.estimate.best = 9999; source.meter = 9999; source.distanceM = 999;
  expect(JSON.stringify(snapshot)).toBe(json);
  expect(Object.isFrozen(snapshot)).toBe(true); expect(Object.isFrozen(snapshot.blocks)).toBe(true);
  expect(snapshot.blocks.every(Object.isFrozen)).toBe(true);
});
it('includes only deliberately selected comparison and metrics, preserving zero and long fares without repricing', () => {
  const source = cardFixture(); source.meter = 0; source.estimate.best = Number.MAX_SAFE_INTEGER;
  const snapshot = snapshotTripCard(source, 'en', { comparison: true, details: true });
  const text = snapshot.blocks.map(b => b.text).join('\n').replace(/[\u2066-\u2069]/g, '');
  expect(text).toContain("Driver's meter: 0.000 TND"); expect(text).toContain('Unable to determine reliably');
  expect(text).toContain('9007199254740.991'); expect(text).toContain('5.0 km'); expect(text).toContain('20 min');
  expect(text).not.toContain(source.id);
});
it('freezes the entered meter comparison and selected language independently of later source/options mutations', () => {
  const source = cardFixture(); const options = { comparison: true, details: false };
  const snapshot = snapshotTripCard(source, 'fr', options); const text = JSON.stringify(snapshot);
  options.comparison = false; source.meter = 99999; source.warnings.push('new private warning');
  expect(JSON.stringify(snapshot)).toBe(text); expect(text).toContain('6.125'); expect(text).not.toContain('99999');
});

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
function fonts(load = vi.fn(async () => [{ status: 'loaded' }]), check = vi.fn(() => true)) {
  Object.defineProperty(document, 'fonts', { configurable: true, value: { load, check } });
}
function logo(fails = false) {
  vi.stubGlobal('Image', class { naturalWidth = 64; onload?: () => void; onerror?: () => void;
    set src(_: string) { queueMicrotask(() => fails ? this.onerror?.() : this.onload?.()); } });
}
it('rejects rejected and missing font faces rather than generating fallback typography', async () => {
  const snapshot = snapshotTripCard(cardFixture(), 'en', { comparison: false, details: false });
  fonts(vi.fn(async () => { throw Error('Synthetic font failure'); }));
  await expect(renderTripCard(snapshot)).rejects.toThrow('font failure');
  fonts(vi.fn(async () => [])); await expect(renderTripCard(snapshot)).rejects.toThrow('font');
});
it('times out a pending font without silently sharing an incomplete render', async () => {
  vi.useFakeTimers(); fonts(vi.fn(() => new Promise(() => {})));
  const result = expect(renderTripCard(snapshotTripCard(cardFixture(), 'en', { comparison: false, details: false }))).rejects.toThrow('timed out');
  await vi.advanceTimersByTimeAsync(10_001); await result;
});
it('rejects missing logo and unavailable canvas', async () => {
  fonts(); logo(true); const snapshot = snapshotTripCard(cardFixture(), 'en', { comparison: false, details: false });
  await expect(renderTripCard(snapshot)).rejects.toThrow('logo');
  logo(); vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  await expect(renderTripCard(snapshot)).rejects.toThrow('rendering');
});
it('rejects unsuccessful PNG encoding after layout rather than returning an empty file', async () => {
  fonts(); logo();
  const ctx = { measureText: (text: string) => ({ width: text.length * 8 }), scale: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn(),
    drawImage: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), fillText: vi.fn(), setLineDash: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(null));
  await expect(renderTripCard(snapshotTripCard(cardFixture(), 'en', { comparison: true, details: true }))).rejects.toThrow('PNG encoding');
});
