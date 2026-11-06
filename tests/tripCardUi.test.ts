// @vitest-environment jsdom
import { createElement } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Header } from '../src/components/ui';
import { TripResult } from '../src/components/TripResult';
import { renderTripCard, type CardSnapshot, type RenderedCard } from '../src/utils/tripCard';
import { shareCard } from '../src/utils/shareCard';
import { catalogs, selectLanguage, type Language } from '../src/localization';
import { cardFixture } from './fixtures/card';

vi.mock('../src/utils/tripCard', async original => ({ ...await original<typeof import('../src/utils/tripCard')>(), renderTripCard: vi.fn() }));
vi.mock('../src/utils/shareCard', () => ({ canShareCard: () => false, shareCard: vi.fn(async () => 'download-requested'), downloadCard: vi.fn() }));
const rendered = (snapshot: CardSnapshot): RenderedCard => ({ snapshot, blob: new Blob(['synthetic-render'], { type: 'image/png' }), width: 1200, height: 1800 });
beforeEach(() => {
  selectLanguage('en'); vi.clearAllMocks(); localStorage.clear();
  URL.createObjectURL = vi.fn(() => 'blob:preview'); URL.revokeObjectURL = vi.fn();
  vi.mocked(renderTripCard).mockImplementation(async snapshot => rendered(snapshot));
  vi.mocked(shareCard).mockResolvedValue('download-requested');
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function view() {
  const onSave = vi.fn(); const trip = cardFixture();
  render(createElement('main', null, createElement(Header, { title: 'Result' }), createElement(TripResult, { trip, isSaved: true, onSave })));
  return { trip, onSave };
}
it.each(['aeb', 'ar', 'fr', 'en'] as Language[])('offers an accessible %s preview with deliberate extras and untouched stored source', async language => {
  selectLanguage(language); const copy = catalogs[language]; const { onSave, trip } = view(); const original = structuredClone(trip);
  fireEvent.click(screen.getByRole('button', { name: copy.card.open }));
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: copy.card.title }));
  expect((screen.getByRole('checkbox', { name: copy.card.includeMeter }) as HTMLInputElement).checked).toBe(false);
  expect((screen.getByRole('checkbox', { name: copy.card.includeDetails }) as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: copy.card.prepare }));
  await screen.findByRole('img', { name: copy.card.imageAlt });
  fireEvent.click(screen.getByText(copy.card.textVersion));
  expect(screen.getByText(copy.card.previewLanguage(language === 'aeb' ? 'تونسي' : language === 'ar' ? 'العربية' : language === 'fr' ? 'Français' : 'English'))).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: copy.card.download }));
  await screen.findByText(copy.export.downloadRequestedCheckYourBrowserDownloads);
  expect(shareCard).toHaveBeenCalledWith(expect.objectContaining({ type: 'image/png' }));
  expect(trip).toEqual(original); expect(onSave).not.toHaveBeenCalled(); expect(localStorage.getItem('taxi-check.active-ride')).toBeNull();
});
it('keeps the frozen language, edited meter and PNG through asynchronous source/language changes', async () => {
  const { onSave } = view(); let complete!: (card: RenderedCard) => void;
  vi.mocked(renderTripCard).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  fireEvent.change(screen.getByLabelText("Driver's meter"), { target: { value: '9.125' } });
  fireEvent.click(screen.getByRole('button', { name: catalogs.en.card.open }));
  fireEvent.click(screen.getByRole('checkbox', { name: catalogs.en.card.includeMeter }));
  fireEvent.click(screen.getByRole('button', { name: catalogs.en.card.prepare }));
  const snapshot = vi.mocked(renderTripCard).mock.calls[0][0];
  fireEvent.change(screen.getByLabelText("Driver's meter"), { target: { value: '7.000' } });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'fr' } });
  const card = rendered(snapshot); complete(card);
  await screen.findByRole('img', { name: catalogs.fr.card.imageAlt });
  expect(snapshot.language).toBe('en'); expect(JSON.stringify(snapshot)).toContain('9.125'); expect(JSON.stringify(snapshot)).not.toContain('7.000');
  fireEvent.click(screen.getByRole('button', { name: catalogs.fr.card.download }));
  await waitFor(() => expect(shareCard).toHaveBeenCalledWith(card.blob)); expect(onSave).not.toHaveBeenCalled();
});
it('removes the old preview after render failure, then retries without sharing stale content', async () => {
  view(); fireEvent.click(screen.getByRole('button', { name: catalogs.en.card.open }));
  fireEvent.click(screen.getByRole('button', { name: catalogs.en.card.prepare })); await screen.findByRole('img');
  vi.mocked(renderTripCard).mockRejectedValueOnce(Error('font failure'));
  fireEvent.click(screen.getByRole('button', { name: catalogs.en.card.prepare }));
  await screen.findByText(catalogs.en.card.renderError); expect(screen.queryByRole('img')).toBeNull();
  expect(screen.queryByRole('button', { name: catalogs.en.card.download })).toBeNull(); expect(shareCard).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: catalogs.en.card.retryPreview })); await screen.findByRole('img');
  expect(renderTripCard).toHaveBeenCalledTimes(3);
});
it('ignores late rendering after closing and returns focus without a stale share action', async () => {
  view(); let complete!: (card: RenderedCard) => void;
  vi.mocked(renderTripCard).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const trigger = screen.getByRole('button', { name: catalogs.en.card.open }); fireEvent.click(trigger);
  fireEvent.click(screen.getByRole('button', { name: catalogs.en.card.prepare }));
  const snapshot = vi.mocked(renderTripCard).mock.calls[0][0]; fireEvent.click(screen.getByRole('button', { name: catalogs.en.card.close }));
  complete(rendered(snapshot)); await waitFor(() => expect(document.activeElement).toBe(trigger));
  expect(screen.queryByRole('img')).toBeNull(); expect(URL.createObjectURL).not.toHaveBeenCalled(); expect(shareCard).not.toHaveBeenCalled();
});
it('retries sharing the same preview after a failure without another render or save', async () => {
  const { onSave } = view(); vi.mocked(shareCard).mockRejectedValueOnce(Error('Synthetic staging failure'));
  fireEvent.click(screen.getByRole('button', { name: catalogs.en.card.open })); fireEvent.click(screen.getByRole('button', { name: catalogs.en.card.prepare }));
  await screen.findByRole('img'); fireEvent.click(screen.getByRole('button', { name: catalogs.en.card.download }));
  await screen.findByText(catalogs.en.card.shareError); fireEvent.click(screen.getByRole('button', { name: catalogs.en.card.retryShare }));
  await screen.findByText(catalogs.en.export.downloadRequestedCheckYourBrowserDownloads);
  expect(shareCard).toHaveBeenCalledTimes(2); expect(vi.mocked(shareCard).mock.calls[0][0]).toBe(vi.mocked(shareCard).mock.calls[1][0]);
  expect(renderTripCard).toHaveBeenCalledTimes(1); expect(onSave).not.toHaveBeenCalled();
});
it('requires a new preview when an optional inclusion is changed after rendering', async () => {
  view(); fireEvent.click(screen.getByRole('button', { name: catalogs.en.card.open }));
  fireEvent.click(screen.getByRole('button', { name: catalogs.en.card.prepare })); await screen.findByRole('img');
  fireEvent.click(screen.getByRole('checkbox', { name: catalogs.en.card.includeMeter }));
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.queryByRole('button', { name: catalogs.en.card.download })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: catalogs.en.card.prepare })); await screen.findByRole('img');
  expect(JSON.stringify(vi.mocked(renderTripCard).mock.calls[1][0])).toContain('6.125');
});
