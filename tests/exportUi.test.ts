import { selectLanguage } from '../src/localization';
// @vitest-environment jsdom
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TripResult } from '../src/components/TripResult';
import { HistoryPage } from '../src/pages/HistoryPage';
import { downloadFile } from '../src/utils/export';
import { tripStore } from '../src/storage/tripStore';
import { buildRecord } from '../src/domain/trip/buildRecord';
import { estimateFare } from '../src/domain/fare/calculator';
import { compareWithMeter } from '../src/domain/fare/compare';
import { getActiveTariff } from '../src/config/tariffs';
import { manualTripInput } from '../src/domain/trip/tripInput';

vi.mock('../src/utils/export', async original => ({ ...await original<typeof import('../src/utils/export')>(), downloadFile: vi.fn() }));
vi.mock('../src/storage/tripStore', () => ({ tripStore: { list: vi.fn(), save: vi.fn(), remove: vi.fn() } }));

function record() {
  const supplements = { airportDeparture: false, luggageItems: 0 };
  const startMs = Date.parse('2026-10-30T11:00:00Z');
  const input = manualTripInput({ startMs, distanceKm: 5, durationMin: 20, supplements });
  return { ...buildRecord({ mode: 'manual', startMs, endMs: input.endMs, distanceM: 5000,
    estimate: estimateFare(input, getActiveTariff()), supplements }),
    startCoords: { lat: 36.812345, lon: 10.123456 }, endCoords: { lat: 36.912345, lon: 10.223456 } };
}
const choice = () => screen.getByRole('checkbox', { name: 'Include precise start/end coordinates for this export' }) as HTMLInputElement;
beforeEach(() => { vi.resetAllMocks(); vi.mocked(downloadFile).mockResolvedValue('download-requested'); });
afterEach(() => cleanup());

beforeEach(() => { selectLanguage('en'); });

describe('single-trip export interaction', () => {
  it('does not steal focus from a newer CSV interaction when an earlier JSON request returns', async () => {
    let finish!: (value: 'download-requested') => void;
    vi.mocked(downloadFile).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(createElement(TripResult, { trip: record(), isSaved: true, onSave: vi.fn() }));
    fireEvent.click(screen.getByRole('button', { name: 'Export JSON' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue export' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    const csv = screen.getByRole('region', { name: 'Export CSV options' });
    const checkbox = within(csv).getByRole('checkbox'); checkbox.focus();
    await act(async () => finish('download-requested'));
    expect(document.activeElement).toBe(checkbox);
  });
  it.each(['JSON', 'CSV'])('discloses privacy before %s export; excludes endpoints and uses the current meter/comparison without saving', async format => {
    const trip = record(); const before = JSON.stringify(trip); const onSave = vi.fn();
    render(createElement(TripResult, { trip, isSaved: true, onSave }));
    fireEvent.change(screen.getByLabelText("Driver's meter"), { target: { value: '9.123' } });
    fireEvent.click(screen.getByRole('button', { name: `Export ${format}` }));
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: `Export ${format} options` }));
    expect(choice().checked).toBe(false);
    expect(screen.getByText(/Coordinates can reveal/).textContent).toContain('may be sensitive');
    expect(downloadFile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Continue export' }));
    await waitFor(() => expect(downloadFile).toHaveBeenCalledTimes(1));
    const content = vi.mocked(downloadFile).mock.calls[0][1];
    const comparison = compareWithMeter({ ...trip.estimate, confidence: trip.confidence }, 9123);
    if (format === 'JSON') expect(JSON.parse(content)).toEqual({ ...trip, startCoords: null, endCoords: null,
      meter: 9123, diff: comparison.diff, diffPct: comparison.diffPct });
    else {
      expect(content.split('\n')[1]).toContain(',"","","","",');
      expect(content).toContain('"9.123"'); expect(content).toContain(`"${(comparison.diff / 1000).toFixed(3)}"`);
    }
    await waitFor(() => expect(screen.getByText(/Download requested/)).toBeTruthy());
    expect(JSON.stringify(trip)).toBe(before); expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close export options' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: `Export ${format}` }));
  });

  it.each(['JSON', 'CSV'])('includes endpoints only by deliberate choice, then resets a new %s interaction', async format => {
    const trip = record();
    render(createElement(TripResult, { trip, isSaved: true, onSave: vi.fn() }));
    fireEvent.click(screen.getByRole('button', { name: `Export ${format}` }));
    fireEvent.click(choice()); fireEvent.click(screen.getByRole('button', { name: 'Continue export' }));
    await waitFor(() => expect(screen.getByText(/Download requested/)).toBeTruthy());
    const content = vi.mocked(downloadFile).mock.calls[0][1];
    if (format === 'JSON') expect(JSON.parse(content).startCoords).toEqual(trip.startCoords);
    else expect(content).toContain('"36.812345","10.123456","36.912345","10.223456"');
    fireEvent.click(screen.getByRole('button', { name: 'Close export options' }));
    fireEvent.click(screen.getByRole('button', { name: `Export ${format}` }));
    expect(choice().checked).toBe(false);
  });

  it('retains inclusion after failure/cancellation for retries, never announcing success before an adapter outcome', async () => {
    vi.mocked(downloadFile).mockRejectedValueOnce(new Error('Synthetic failure'))
      .mockResolvedValueOnce('cancelled').mockResolvedValueOnce('share-returned');
    render(createElement(TripResult, { trip: record(), isSaved: true, onSave: vi.fn() }));
    fireEvent.click(screen.getByRole('button', { name: 'Export JSON' })); fireEvent.click(choice());
    fireEvent.click(screen.getByRole('button', { name: 'Continue export' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Delivery is not confirmed'));
    expect(screen.queryByText(/Download requested/)).toBeNull(); expect(choice().checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Retry export' }));
    await waitFor(() => expect(screen.getByText(/Android reported/)).toBeTruthy()); expect(choice().checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Retry export' }));
    await waitFor(() => expect(screen.getByText(/Delivery to the recipient is not confirmed/)).toBeTruthy());
    expect(vi.mocked(downloadFile).mock.calls.every(call => JSON.parse(call[1]).startCoords.lat === 36.812345)).toBe(true);
  });

  it('prevents duplicate pending export and retains the choice until the request returns', async () => {
    let complete!: (value: 'download-requested') => void;
    vi.mocked(downloadFile).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    render(createElement(TripResult, { trip: record(), isSaved: true, onSave: vi.fn() }));
    fireEvent.click(screen.getByRole('button', { name: 'Export JSON' })); fireEvent.click(choice());
    const submit = screen.getByRole('button', { name: 'Continue export' });
    fireEvent.click(submit); fireEvent.click(submit);
    expect(downloadFile).toHaveBeenCalledTimes(1); expect(choice().disabled).toBe(true);
    expect(screen.queryByText(/Download requested/)).toBeNull();
    complete('download-requested'); await waitFor(() => expect(screen.getByText(/Download requested/)).toBeTruthy());
  });
});

describe('bulk-history export', () => {
  it.each([false, true])('applies choice to all records without changing history (include=%s)', async include => {
    const first = record(); const second = { ...record(), id: 'second' }; const records = [first, second];
    const stored = JSON.stringify(records); vi.mocked(tripStore.list).mockResolvedValue(records);
    render(createElement(HistoryPage, { onBack: vi.fn(), onOpen: vi.fn() }));
    fireEvent.click(await screen.findByRole('button', { name: 'Export all as CSV' }));
    expect(choice().checked).toBe(false); if (include) fireEvent.click(choice());
    fireEvent.click(screen.getByRole('button', { name: 'Continue export' }));
    await waitFor(() => expect(downloadFile).toHaveBeenCalledTimes(1));
    const lines = vi.mocked(downloadFile).mock.calls[0][1].split('\n'); expect(lines).toHaveLength(3);
    for (const row of lines.slice(1)) expect(row).toContain(include ? '"36.812345","10.123456","36.912345","10.223456"' : ',"","","","",');
    expect(JSON.stringify(records)).toBe(stored); expect(tripStore.save).not.toHaveBeenCalled(); expect(tripStore.remove).not.toHaveBeenCalled();
  });
});
