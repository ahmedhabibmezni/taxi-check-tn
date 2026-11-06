import { selectLanguage } from '../src/localization';
// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { getActiveTariff } from '../src/config/tariffs';

const fixtures = vi.hoisted(() => ({ native: false, save: vi.fn(), list: vi.fn(), minimize: vi.fn(), back: null as null | (() => void) }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => fixtures.native, getPlatform: () => fixtures.native ? 'android' : 'web' } }));
vi.mock('@capacitor/app', () => ({ App: { minimizeApp: fixtures.minimize,
  addListener: vi.fn(async (_name: string, callback: () => void) => { fixtures.back = callback; return { remove: vi.fn() }; }) } }));
vi.mock('../src/services/geolocation/watcher', () => ({ watchPosition: vi.fn(() => vi.fn()), stopKnownPositionWatches: vi.fn(), requestWakeLock: vi.fn(async () => null) }));
vi.mock('../src/storage/tripStore', () => ({ tripStore: { save: fixtures.save, list: fixtures.list } }));
beforeEach(() => { localStorage.clear(); vi.resetAllMocks(); fixtures.native = false; fixtures.back = null; fixtures.list.mockResolvedValue([]); });
afterEach(cleanup);

function endRide() {
  fireEvent.click(screen.getByRole('button', { name: 'START RIDE' }));
  fireEvent.click(screen.getByRole('button', { name: 'END RIDE' }));
}
function openManual() {
  if (screen.queryByRole('heading', { name: 'Trip complete' })) fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  fireEvent.click(screen.getByRole('button', { name: 'Manual calculator' }));
}

it('does not let a late live auto-save overwrite newer navigation', async () => {
  let finish!: () => void;
  fixtures.save.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  render(createElement(App)); endRide(); openManual();
  expect(screen.getByRole('heading', { name: 'Manual calculator' })).toBeTruthy();
  await act(async () => finish());
  expect(screen.getByRole('heading', { name: 'Manual calculator' })).toBeTruthy();
  expect(fixtures.save).toHaveBeenCalledTimes(1);
});

it('clears the originating auto-save error after a successful explicit retry', async () => {
  fixtures.save.mockRejectedValueOnce(new Error('Synthetic failed auto-save')).mockResolvedValue(undefined);
  render(createElement(App)); endRide();
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('could not be saved automatically'));
  fireEvent.click(screen.getByRole('button', { name: 'Save to history' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Saved ✓' })).toBeTruthy());
  expect(screen.queryByRole('alert')).toBeNull();
});

it('does not carry a live auto-save error into an unrelated Manual result', async () => {
  fixtures.save.mockRejectedValueOnce(new Error('Synthetic failed auto-save'));
  render(createElement(App)); endRide();
  await screen.findByRole('alert'); openManual();
  fireEvent.change(screen.getByLabelText('Distance (km)'), { target: { value: '5' } });
  fireEvent.change(screen.getByLabelText('Total duration (min)'), { target: { value: '20' } });
  fireEvent.click(screen.getByRole('button', { name: 'Calculate' }));
  expect(screen.getByRole('heading', { name: 'Trip complete' })).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
});

it.each(['Manual calculator', 'Trip history'])('uses native Back as navigation from %s while a known ride is guarded', async page => {
  fixtures.native = true;
  localStorage.setItem('taxi-check.native-recovery', '1');
  const raw = JSON.stringify({ tariffId: getActiveTariff().id, startMs: Date.now(), samples: [],
    supplements: { airportDeparture: false, luggageItems: 0 }, gpsStatus: 'waiting' });
  localStorage.setItem('taxi-check.active-ride', raw);
  render(createElement(App));
  fireEvent.click(screen.getByRole('button', { name: 'Go to Home: keep recovery pending' }));
  fireEvent.click(screen.getByRole('button', { name: page }));
  await act(async () => fixtures.back?.());
  expect(fixtures.minimize).not.toHaveBeenCalled();
  expect(screen.getByRole('heading', { name: 'Your ride. A clearer fare.' })).toBeTruthy();
  expect(localStorage.getItem('taxi-check.active-ride')).toBe(raw);
  expect(localStorage.getItem('taxi-check.native-recovery')).toBe('1');
});beforeEach(() => { selectLanguage('en'); });
