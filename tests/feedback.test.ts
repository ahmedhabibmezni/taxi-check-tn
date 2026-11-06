import { selectLanguage } from '../src/localization';
// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Header } from '../src/components/ui';
import { TripResult } from '../src/components/TripResult';
import { ManualPage } from '../src/pages/ManualPage';
import { LivePage } from '../src/pages/LivePage';
import { HistoryPage } from '../src/pages/HistoryPage';
import { getActiveTariff, getTariff } from '../src/config/tariffs';
import { estimateFare } from '../src/domain/fare/calculator';
import { manualTripInput } from '../src/domain/trip/tripInput';
import { buildRecord } from '../src/domain/trip/buildRecord';
import { tripStore } from '../src/storage/tripStore';
import type { useLiveRide } from '../src/hooks/useLiveRide';

vi.mock('../src/config/tariffs', async (original) => {
  const actual = await original<typeof import('../src/config/tariffs')>();
  return { ...actual, getTariff: vi.fn(actual.getTariff), getActiveTariff: vi.fn(actual.getActiveTariff) };
});
vi.mock('../src/storage/tripStore', () => ({ tripStore: { list: vi.fn(), remove: vi.fn() } }));
vi.mock('../src/utils/export', () => ({ downloadFile: vi.fn(), tripsToCsv: vi.fn() }));

const tariff = getActiveTariff();
const startMs = Date.parse('2026-10-30T11:00:00Z');
const supplements = { airportDeparture: false, luggageItems: 0 };
function record() {
  const input = manualTripInput({ startMs, distanceKm: 5, durationMin: 20, supplements });
  return buildRecord({ mode: 'manual', startMs, endMs: input.endMs, distanceM: 5000,
    estimate: estimateFare(input, tariff), supplements });
}

beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

beforeEach(() => { selectLanguage('en'); });

describe('recorded tariff and result feedback', () => {
  it('does not mark edits made during an earlier save as saved or allow overlapping writes', async () => {
    let finish!: () => void;
    const onSave = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; })).mockResolvedValue(undefined);
    render(createElement(TripResult, { trip: record(), isSaved: true, onSave }));
    const meter = screen.getByLabelText("Driver's meter") as HTMLInputElement;
    fireEvent.change(meter, { target: { value: '6.000' } });
    const save = screen.getByRole('button', { name: 'Update trip' });
    fireEvent.click(save);
    fireEvent.change(meter, { target: { value: '9.000' } });
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ meter: 6000 }));
    await act(async () => finish());
    expect(meter.value).toBe('9.000');
    expect(screen.queryByRole('button', { name: 'Saved ✓' })).toBeNull();
    expect(screen.getAllByRole('status').some(el => el.textContent?.includes('Trip saved in history'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Update trip' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Saved ✓' })).toBeTruthy());
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ meter: 9000 }));
  });
  it('selects historical metadata by recorded ID without consulting the active tariff or repricing', () => {
    const trip = { ...record(), tariffId: 'historical-fixture' };
    vi.mocked(getTariff).mockImplementationOnce((id) => id === trip.tariffId
      ? { ...tariff, id, name: 'Historical fixture', lastReviewed: '2020-01-02', source: 'Historical fixture source', notice: 'Historical fixture notice' }
      : undefined);
    const originalEstimate = structuredClone(trip.estimate);
    render(createElement(TripResult, { trip, isSaved: true, onSave: vi.fn() }));
    const metadata = screen.getByRole('region', { name: 'Tariff verification' });
    expect(within(metadata).getByText('Historical fixture source', { exact: false })).toBeTruthy();
    expect(within(metadata).getByText('2020-01-02')).toBeTruthy();
    expect(getTariff).toHaveBeenCalledWith('historical-fixture');
    expect(getActiveTariff).not.toHaveBeenCalled();
    expect(trip.estimate).toEqual(originalEstimate);
  });

  it('leaves unavailable historical metadata explicit and never substitutes current metadata', () => {
    const trip = { ...record(), tariffId: 'missing-fixture' };
    render(createElement(TripResult, { trip, isSaved: true, onSave: vi.fn() }));
    const metadata = screen.getByRole('region', { name: 'Tariff verification' });
    expect(within(metadata).getByText('missing-fixture')).toBeTruthy();
    expect(within(metadata).getByText(/metadata is unavailable/)).toBeTruthy();
    expect(within(metadata).queryByText(tariff.name)).toBeNull();
    expect(getActiveTariff).not.toHaveBeenCalled();
  });

  it('keeps the recorded quality score separate from tariff verification and live announcements', () => {
    const trip = record();
    render(createElement(TripResult, { trip, isSaved: false, onSave: vi.fn() }));
    const quality = screen.getByRole('group', { name: 'Input quality' });
    fireEvent.click(within(quality).getByText('Input quality'));
    expect(quality.hasAttribute('open')).toBe(true);
    expect(within(quality).getByText(`${Math.round(trip.confidence * 100)}%`)).toBeTruthy();
    expect(quality.closest('[role="status"], [aria-live]')).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Tariff verification' })).queryByText(/35%/)).toBeNull();
  });

  it('announces save failure and retry success while preserving edited meter and focus', async () => {
    const onSave = vi.fn().mockRejectedValueOnce(new Error('Synthetic quota')).mockResolvedValue(undefined);
    render(createElement(TripResult, { trip: record(), isSaved: false, onSave }));
    const meter = screen.getByLabelText("Driver's meter") as HTMLInputElement;
    fireEvent.change(meter, { target: { value: '6.000' } });
    const save = screen.getByRole('button', { name: 'Save to history' });
    save.focus();
    fireEvent.click(save);
    await waitFor(() => expect(screen.getAllByRole('status').some(e => e.textContent?.includes('Could not save'))).toBe(true));
    expect(meter.value).toBe('6.000');
    expect(document.activeElement).toBe(save);
    fireEvent.click(save);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Saved ✓' })).toBeTruthy());
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ meter: 6000 }));
  });
});

describe('Manual validation feedback', () => {
  it('retains values, associates field errors, focuses summary once and lets its link focus a field', () => {
    const onResult = vi.fn();
    render(createElement(ManualPage, { onBack: vi.fn(), onResult }));
    const distance = screen.getByLabelText('Distance (km)') as HTMLInputElement;
    const duration = screen.getByLabelText('Total duration (min)') as HTMLInputElement;
    fireEvent.change(distance, { target: { value: '501' } });
    fireEvent.change(duration, { target: { value: '20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }));
    const summary = screen.getByRole('heading', { name: 'Check your entries' }).parentElement!;
    expect(document.activeElement).toBe(summary);
    expect(distance.value).toBe('501');
    expect(duration.value).toBe('20');
    expect(distance.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(distance.getAttribute('aria-describedby')!)?.textContent).toContain('500 km');
    fireEvent.click(within(summary).getByRole('link', { name: /Distance/ }));
    expect(document.activeElement).toBe(distance);
    fireEvent.change(distance, { target: { value: '502' } });
    expect(document.activeElement).toBe(distance);
    expect(onResult).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }));
    expect(document.activeElement).toBe(summary);
  });

  it('associates the existing cross-field moving-time error with distance, duration and stopped time', () => {
    render(createElement(ManualPage, { onBack: vi.fn(), onResult: vi.fn() }));
    for (const [label, value] of [['Distance (km)', '5'], ['Total duration (min)', '20'], ['Stopped / very slow time (min), optional', '20']]) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Calculate' }));
    for (const id of ['manual-distance', 'manual-duration', 'manual-stopped']) {
      expect(document.getElementById(id)?.getAttribute('aria-invalid')).toBe('true');
    }
  });
});

describe('screen focus and Live announcements', () => {
  it('focuses new screen identities without stealing focus on ordinary rerenders', () => {
    const { rerender } = render(createElement(Header, { title: 'First screen', focusKey: 'one', onBack: vi.fn() }));
    const heading = screen.getByRole('heading');
    expect(document.activeElement).toBe(heading);
    const back = screen.getByRole('button', { name: 'Back' });
    back.focus();
    rerender(createElement(Header, { title: 'First screen', focusKey: 'one', onBack: vi.fn() }));
    expect(document.activeElement).toBe(back);
    rerender(createElement(Header, { title: 'First screen', focusKey: 'two', onBack: vi.fn() }));
    expect(document.activeElement).toBe(heading);
  });

  it('keeps clock/fare rerenders outside the GPS status and does not move focus', () => {
    const trip = record();
    const live = { ride: { startMs, samples: [], supplements, gpsStatus: 'waiting', tariffId: tariff.id }, now: startMs,
      live: { estimate: { ...trip.estimate, confidence: 0, warnings: ['Synthetic missing GPS'] }, track: { intervals: [] } },
      storageError: false, end: vi.fn(), cancel: vi.fn(), start: vi.fn() } as unknown as ReturnType<typeof useLiveRide>;
    const props = { live, onEnd: vi.fn(), onCancel: vi.fn() };
    const { rerender } = render(createElement(LivePage, props));
    const status = screen.getByRole('status');
    const previous = status.textContent;
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver(records => mutations.push(...records));
    observer.observe(status, { childList: true, characterData: true, subtree: true });
    const end = screen.getByRole('button', { name: 'END RIDE' });
    end.focus();
    act(() => rerender(createElement(LivePage, { ...props, live: { ...live, now: startMs + 1000,
      live: { ...live.live!, estimate: { ...live.live!.estimate, best: trip.estimate.best + 46 } } } })));
    expect(document.activeElement).toBe(end);
    expect(status.textContent).toBe(previous);
    expect(observer.takeRecords()).toHaveLength(0);
    expect(mutations).toHaveLength(0);
    rerender(createElement(LivePage, { ...props, live: { ...live, ride: { ...live.ride!, gpsStatus: 'denied' } } }));
    expect(status.textContent).not.toBe(previous);
    expect(status.querySelector('.num')).toBeNull();
    observer.disconnect();
  });
});

describe('History feedback', () => {
  it('shows loading, recovers from a read failure through retry and announces empty history', async () => {
    let reject!: (e: Error) => void;
    vi.mocked(tripStore.list).mockImplementationOnce(() => new Promise((_resolve, rejectRead) => { reject = rejectRead; }));
    render(createElement(HistoryPage, { onBack: vi.fn(), onOpen: vi.fn() }));
    expect(screen.getByRole('status').textContent).toContain('Loading');
    await act(async () => reject(new Error('Synthetic read failure')));
    expect(screen.getByRole('alert')).toBeTruthy();
    vi.mocked(tripStore.list).mockResolvedValueOnce([]);
    fireEvent.click(screen.getByRole('button', { name: 'Retry history' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    expect(screen.getByRole('status').textContent).toContain('No saved trips');
    expect(tripStore.list).toHaveBeenCalledTimes(2);
  });
});
