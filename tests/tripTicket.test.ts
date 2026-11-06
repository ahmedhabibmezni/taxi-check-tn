// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { catalogs, selectLanguage, type Language } from '../src/localization';

const gps = vi.hoisted(() => ({ watch: vi.fn(() => vi.fn()), stop: vi.fn() }));
vi.mock('../src/services/geolocation/watcher', () => ({ watchPosition: gps.watch,
  stopKnownPositionWatches: gps.stop, requestWakeLock: vi.fn(async () => null) }));
beforeEach(() => { localStorage.clear(); selectLanguage('en'); vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it.each(['aeb', 'ar', 'fr', 'en'] as Language[])('keeps %s caveats visible and meter/share intact while inspecting secondary details', async language => {
  selectLanguage(language); const copy = catalogs[language]; render(createElement(App));
  fireEvent.click(screen.getByRole('button', { name: copy.app.manualCalculator }));
  fireEvent.change(screen.getByLabelText(copy.manual.distanceKm), { target: { value: '5' } });
  fireEvent.change(screen.getByLabelText(copy.manual.totalDurationMin), { target: { value: '20' } });
  fireEvent.change(screen.getByLabelText(copy.manual.stoppedVerySlowTimeMinOptional), { target: { value: '2' } });
  fireEvent.change(screen.getByLabelText(copy.manual.startDateAndTimeTunisia), { target: { value: '2026-11-01T12:00' } });
  fireEvent.click(screen.getByRole('button', { name: copy.manual.calculate }));
  const uncertainty = screen.getByText(copy.result.anIndependentEstimateNotAGuaranteed);
  const verification = screen.getByText(copy.live.tariffNotOfficiallyVerified);
  expect(uncertainty.closest('details')).toBeNull(); expect(verification.closest('details')).toBeNull();
  const meter = screen.getByLabelText(copy.result.driversMeter) as HTMLInputElement;
  fireEvent.change(meter, { target: { value: '9.125' } });
  const tariffDetails = screen.getAllByText(copy.shared.tariffVerification).find(e => e.tagName === 'SUMMARY')!;
  const qualityDetails = screen.getByText(copy.result.inputQuality);
  fireEvent.click(tariffDetails); fireEvent.click(qualityDetails);
  expect(tariffDetails.closest('details')?.open).toBe(true);
  expect(qualityDetails.closest('details')?.open).toBe(true);
  expect(screen.getByText(copy.result.thisExistingScoreReflectsGPSCoverage)).toBeTruthy();
  const selector = screen.getByRole('combobox'); selector.focus();
  fireEvent.change(selector, { target: { value: 'en' } });
  expect(document.activeElement).toBe(selector); expect(meter.value).toBe('9.125');
  expect(tariffDetails.closest('details')?.open).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: catalogs.en.card.open }));
  expect(screen.getByRole('heading', {name:catalogs.en.card.title})).toBeTruthy();
  expect(localStorage.getItem('taxi-check.active-ride')).toBeNull(); expect(gps.watch).not.toHaveBeenCalled();
});
