import { selectLanguage } from '../src/localization';
// @vitest-environment jsdom
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { getActiveTariff } from '../src/config/tariffs';

const fixtures = vi.hoisted(() => ({
  watch: vi.fn(() => vi.fn()), stopKnown: vi.fn(), native: false,
  list: vi.fn(), save: vi.fn(), remove: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => fixtures.native } }));
vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn(async () => ({ remove: vi.fn() })), minimizeApp: vi.fn() } }));
vi.mock('../src/services/geolocation/watcher', () => ({
  watchPosition: fixtures.watch, stopKnownPositionWatches: fixtures.stopKnown, requestWakeLock: vi.fn(async () => null),
}));
vi.mock('../src/storage/tripStore', () => ({ tripStore: { list: fixtures.list, save: fixtures.save, remove: fixtures.remove } }));
vi.mock('../src/utils/export', () => ({ downloadFile: vi.fn(), tripsToCsv: vi.fn() }));

const key = 'taxi-check.active-ride';
function unresolved() {
  const raw = JSON.stringify({ tariffId: 'unknown-original', startMs: Date.now() - 60000,
    samples: [{ t: Date.now() - 30000, lat: 36.8, lon: 10, accuracy: 5 }],
    supplements: { airportDeparture: true, luggageItems: 2 }, gpsStatus: 'ok', originalExtra: 'keep' }, null, 2);
  localStorage.setItem(key, raw);
  return raw;
}
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); fixtures.native = false; fixtures.list.mockResolvedValue([]); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

beforeEach(() => { selectLanguage('en'); });

describe('active tariff recovery navigation and confirmation', () => {
  it.each([false, true])('preserves raw recovery data through Home, Manual and history without touching completed estimates (native=%s)', async (native) => {
    fixtures.native = native;
    const original = unresolved();
    const completed = { id: 'older-completed', mode: 'manual', startMs: 1, endMs: 60001, distanceM: 500,
      durationS: 60, meter: null, tariffId: 'older-unavailable', strategyId: 'historic-model',
      movingTimeS: 60, slowTimeS: 0, startCoords: null, endCoords: null, confidence: .35, warnings: [],
      supplements: { airportDeparture: false, luggageItems: 0 },
      estimate: { best: 7777, low: 7000, high: 8000, breakdown: { initialFare: 900, distanceCharge: 6877,
        waitingCharge: 0, nightSurcharge: 0, airportSupplement: 0, luggageSupplement: 0, total: 7777 } } };
    const savedBytes = JSON.stringify(completed);
    fixtures.list.mockResolvedValue([completed]);
    render(createElement(App));
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Ride needs recovery' }));
    expect(screen.queryByText('Estimated fare')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Go to Home: keep recovered ride' }));
    fireEvent.click(screen.getByRole('button', { name: 'Manual calculator' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Trip history' }));
    await waitFor(() => expect(screen.getByText('Estimated: 7.8 TND')).toBeTruthy());
    fireEvent.click(screen.getByText('Estimated: 7.8 TND'));
    expect(screen.getByText('≈ 7.777 TND')).toBeTruthy();
    expect(localStorage.getItem(key)).toBe(original);
    expect(JSON.stringify(completed)).toBe(savedBytes);
    expect(fixtures.save).not.toHaveBeenCalled();
    expect(fixtures.remove).not.toHaveBeenCalled();
    expect(fixtures.watch).not.toHaveBeenCalled();
  });

  it('requires confirmation, permits cancellation, then starts a pinned replacement only after confirmed discard', () => {
    const original = unresolved();
    render(createElement(App));
    const discard = screen.getByRole('button', { name: 'Discard and start again' });
    fireEvent.click(discard);
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Discard the recovered ride?' }));
    expect(localStorage.getItem(key)).toBe(original);
    fireEvent.click(screen.getByRole('button', { name: 'Keep recovered ride' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Discard and start again' }));
    expect(localStorage.getItem(key)).toBe(original);
    fireEvent.click(screen.getByRole('button', { name: 'Discard and start again' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm discard and start again' }));
    expect(screen.getByRole('heading', { name: 'Ride in progress' })).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(key)!).tariffId).toBe(getActiveTariff().id);
    expect(fixtures.watch).toHaveBeenCalledTimes(1);
    expect(fixtures.save).not.toHaveBeenCalled();
  });

  it('keeps recovery and announces failure when confirmed deletion is blocked', () => {
    const raw = unresolved();
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('Synthetic denied removal'); });
    render(createElement(App));
    fireEvent.click(screen.getByRole('button', { name: 'Discard and start again' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm discard and start again' }));
    expect(screen.getByRole('alert').textContent).toContain('could not be confirmed');
    expect(localStorage.getItem(key)).toBe(raw);
    expect(fixtures.watch).not.toHaveBeenCalled();
  });

  it('explains native shutdown uncertainty and blocks replacement after discard while keeping Manual available', () => {
    fixtures.native = true;
    unresolved();
    render(createElement(App));
    expect(screen.getByText(/previous Android location service/)).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('No estimate is being calculated');
    expect(screen.getByRole('status').textContent).not.toContain('recording has stopped');
    fireEvent.click(screen.getByRole('button', { name: 'Discard recovered ride' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm discard' }));
    fireEvent.click(screen.getByRole('button', { name: 'Go to Home: keep recovery pending' }));
    const start = screen.getByRole('button', { name: 'START RIDE' }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    expect(fixtures.watch).not.toHaveBeenCalled();
    expect(localStorage.getItem(key)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Manual calculator' }));
    expect(screen.getByRole('heading', { name: 'Manual calculator' })).toBeTruthy();
  });

  it('retains the native guard across discard, remount and safe navigation until explicit acknowledgment', async () => {
    fixtures.native = true;
    unresolved();
    const first = render(createElement(App));
    fireEvent.click(screen.getByRole('button', { name: 'Discard recovered ride' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm discard' }));
    expect(localStorage.getItem('taxi-check.native-recovery')).toBe('1');
    expect(localStorage.getItem(key)).toBeNull();
    first.unmount();
    render(createElement(App));
    expect(screen.getByRole('heading', { name: 'Android recovery pending' })).toBeTruthy();
    expect(screen.getByText(/personal assertion, not technical proof/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Go to Home: keep recovery pending' }));
    expect((screen.getByRole('button', { name: 'START RIDE' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Manual calculator' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Trip history' }));
    await waitFor(() => expect(fixtures.list).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(localStorage.getItem('taxi-check.native-recovery')).toBe('1');
    expect(fixtures.save).not.toHaveBeenCalled();
    expect(fixtures.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Review Android recovery' }));
    fireEvent.click(screen.getByRole('button', { name: 'I force-stopped and reopened the app' }));
    expect(localStorage.getItem('taxi-check.native-recovery')).toBeNull();
    expect((screen.getByRole('button', { name: 'START RIDE' }) as HTMLButtonElement).disabled).toBe(false);
    expect(fixtures.watch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'START RIDE' }));
    expect(fixtures.watch).toHaveBeenCalledTimes(1);
  });

  it('announces acknowledgment failure and keeps Start blocked after returning Home', () => {
    fixtures.native = true;
    localStorage.setItem('taxi-check.native-recovery', '1');
    render(createElement(App));
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('Synthetic denied removal'); });
    fireEvent.click(screen.getByRole('button', { name: 'I force-stopped and reopened the app' }));
    expect(screen.getByRole('alert').textContent).toContain('Recording remains blocked');
    fireEvent.click(screen.getByRole('button', { name: 'Go to Home: keep recovery pending' }));
    expect((screen.getByRole('button', { name: 'START RIDE' }) as HTMLButtonElement).disabled).toBe(true);
    expect(localStorage.getItem('taxi-check.native-recovery')).toBe('1');
    expect(fixtures.watch).not.toHaveBeenCalled();
  });
});
