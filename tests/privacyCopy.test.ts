// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { TripCardExport } from '../src/components/TripCardExport';
import { cardFixture } from './fixtures/card';
import { catalogs, selectLanguage, type Language } from '../src/localization';

const state = vi.hoisted(() => ({ watch: vi.fn(() => vi.fn()), list: vi.fn(async () => []),
  save: vi.fn(), remove: vi.fn(), download: vi.fn() }));
vi.mock('../src/services/geolocation/watcher', () => ({ watchPosition: state.watch,
  requestWakeLock: vi.fn(async () => null), stopKnownPositionWatches: vi.fn() }));
vi.mock('../src/storage/tripStore', () => ({ tripStore: { list: state.list, save: state.save, remove: state.remove } }));
vi.mock('../src/utils/export', async original => ({ ...await original<typeof import('../src/utils/export')>(), downloadFile: state.download }));
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it.each(['aeb', 'ar', 'fr', 'en'] as Language[])('keeps essential %s explanations before Start and independent actions without GPS', async language => {
  selectLanguage(language); const copy = catalogs[language]; render(createElement(App));
  const start = screen.getByRole('button', { name: copy.app.startRide });
  for (const message of [copy.app.locationPermissionIsRequestedWhenYou, copy.privacy.endLive(copy.live.endRide), copy.privacy.manualAlternative]) {
    const paragraph = screen.getByText(message);
    expect(paragraph.closest('details')).toBeNull();
    expect(paragraph.compareDocumentPosition(start) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
  expect(start.hasAttribute('disabled')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: copy.app.manualCalculator }));
  expect(screen.getByRole('heading', { name: copy.manual.manualCalculator })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: copy.shared.back }));
  fireEvent.click(screen.getByRole('button', { name: copy.app.tripHistory }));
  expect(screen.getByText(copy.privacy.historyRetention(copy.history.delete))).toBeTruthy();
  expect(await screen.findByText(copy.history.noSavedTripsYetReturnTo)).toBeTruthy();
  fireEvent.click(screen.getByText(copy.privacy.deletionLimits));
  expect(screen.getByText(copy.privacy.recipientCopies).closest('details')?.open).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: copy.shared.back }));
  fireEvent.click(screen.getByRole('button', { name: copy.app.aboutTariff }));
  fireEvent.click(screen.getByText(copy.privacy.title));
  expect(screen.getByText(copy.privacy.platformServices).closest('details')?.open).toBe(true);
  expect(screen.getByText(copy.privacy.activeData)).toBeTruthy();
  expect(screen.getByText(copy.privacy.exportCache)).toBeTruthy();
  expect(screen.getByText(copy.privacy.recipientCopies)).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: copy.about.aboutTariff }));
  expect(state.watch).not.toHaveBeenCalled(); expect(state.save).not.toHaveBeenCalled(); expect(state.remove).not.toHaveBeenCalled();
});

it.each(['aeb', 'ar', 'fr', 'en'] as Language[])('keeps %s card choices, privacy and focus without automatic upload', language => {
  selectLanguage(language); const copy = catalogs[language];
  render(createElement(TripCardExport, { trip:cardFixture() }));
  const trigger=screen.getByRole('button',{name:copy.card.open});fireEvent.click(trigger);
  expect(document.activeElement).toBe(screen.getByRole('heading',{name:copy.card.title}));
  expect(screen.getByText(copy.card.privacy)).toBeTruthy();expect(screen.getByText(copy.privacy.recipientCopies)).toBeTruthy();
  expect((screen.getByRole('checkbox',{name:copy.card.includeMeter}) as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByRole('button',{name:copy.card.close}));expect(document.activeElement).toBe(trigger);
  expect(state.download).not.toHaveBeenCalled();
});
