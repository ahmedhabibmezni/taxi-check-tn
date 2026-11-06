// @vitest-environment jsdom
import {createElement} from 'react';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {TripResult} from '../src/components/TripResult';
import {HistoryPage} from '../src/pages/HistoryPage';
import {tripStore} from '../src/storage/tripStore';
import {catalogs,selectLanguage,type Language} from '../src/localization';
import {renderTripCard} from '../src/utils/tripCard';
import {shareCard} from '../src/utils/shareCard';
import {cardFixture} from './fixtures/card';
vi.mock('../src/storage/tripStore',()=>({tripStore:{list:vi.fn(),save:vi.fn(),remove:vi.fn()}}));
vi.mock('../src/utils/tripCard',async original=>({...await original<typeof import('../src/utils/tripCard')>(),renderTripCard:vi.fn(async snapshot=>({snapshot,blob:new Blob(['png'],{type:'image/png'}),width:1200,height:1600}))}));
vi.mock('../src/utils/shareCard',()=>({shareCard:vi.fn(async()=> 'download-requested'),canShareCard:()=>false}));
beforeEach(()=>{selectLanguage('en');localStorage.clear();vi.clearAllMocks();URL.createObjectURL=vi.fn(()=> 'blob:card');URL.revokeObjectURL=vi.fn();});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it.each(['en','aeb','ar','fr'] as Language[])('uses only individual passenger card sharing in %s without saving edited meter',async lang=>{
  selectLanguage(lang);const copy=catalogs[lang],trip=cardFixture(),before=JSON.stringify(trip),save=vi.fn();
  render(createElement(TripResult,{trip,isSaved:true,onSave:save}));
  expect(screen.queryByRole('button',{name:/JSON|CSV/})).toBeNull();
  fireEvent.change(screen.getByLabelText(copy.result.driversMeter),{target:{value:'9.125'}});
  fireEvent.click(screen.getByRole('button',{name:copy.card.open}));fireEvent.click(screen.getByRole('checkbox',{name:copy.card.includeMeter}));
  fireEvent.click(screen.getByRole('button',{name:copy.card.prepare}));await screen.findByRole('img',{name:copy.card.imageAlt});
  const snapshot=vi.mocked(renderTripCard).mock.calls[0][0];expect(JSON.stringify(snapshot)).toContain('9.125');
  expect(JSON.stringify(snapshot)).not.toContain(trip.id);expect(JSON.stringify(snapshot)).not.toContain('startCoords');
  fireEvent.click(screen.getByRole('button',{name:copy.card.download}));await waitFor(()=>expect(shareCard).toHaveBeenCalledTimes(1));
  expect(JSON.stringify(trip)).toBe(before);expect(save).not.toHaveBeenCalled();expect(tripStore.save).not.toHaveBeenCalled();
});
it.each(['en','aeb','ar','fr'] as Language[])('keeps valid mixed History usable and never invents bulk sharing in %s',async lang=>{
  selectLanguage(lang);const copy=catalogs[lang],trip=cardFixture(),rows=[null,trip,{}],before=JSON.stringify(rows),open=vi.fn();
  vi.mocked(tripStore.list).mockResolvedValue(rows);
  render(createElement(HistoryPage,{onBack:vi.fn(),onOpen:open}));await screen.findByText(copy.historyRead.partial(2));
  expect(screen.queryByRole('button',{name:/JSON|CSV|Share|شارك|مشاركة|Partager/})).toBeNull();
  fireEvent.click(screen.getByText(copy.history.estimated('4.1')));expect(open).toHaveBeenCalledWith(trip);
  const confirm=vi.spyOn(window,'confirm').mockReturnValue(false);fireEvent.click(screen.getByRole('button',{name:copy.history.delete}));expect(tripStore.remove).not.toHaveBeenCalled();
  confirm.mockReturnValue(true);vi.mocked(tripStore.remove).mockResolvedValue();fireEvent.click(screen.getByRole('button',{name:copy.history.delete}));
  await waitFor(()=>expect(tripStore.remove).toHaveBeenCalledWith(trip.id));expect(JSON.stringify(rows)).toBe(before);expect(tripStore.save).not.toHaveBeenCalled();
});
it('does not offer a card for malformed Result or call the renderer with fabricated content',()=>{
  render(createElement(TripResult,{trip:{} as ReturnType<typeof cardFixture>,isSaved:true,onSave:vi.fn()}));
  expect(screen.getByRole('alert')).toBeTruthy();expect(screen.queryByRole('button')).toBeNull();expect(renderTripCard).not.toHaveBeenCalled();
});
