// @vitest-environment jsdom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createElement} from 'react';
import {act,cleanup,fireEvent,render,renderHook,screen} from '@testing-library/react';
import {App} from '../src/App';
import {useLiveRide} from '../src/hooks/useLiveRide';
import {NativeRecoveryPage} from '../src/pages/NativeRecoveryPage';
import {getMessages,selectLanguage,type Language} from '../src/localization';
import {iosCopy} from '../src/localization/ios';
import {getActiveTariff} from '../src/config/tariffs';
const platform=vi.hoisted(()=>({name:'ios',watch:vi.fn(()=>vi.fn()),stop:vi.fn(),back:vi.fn(async()=>({remove:vi.fn()})),minimize:vi.fn(),save:vi.fn(async()=>{}),list:vi.fn(async()=>[])}));
vi.mock('@capacitor/core',()=>({Capacitor:{isNativePlatform:()=>platform.name!=='web',getPlatform:()=>platform.name}}));
vi.mock('@capacitor/app',()=>({App:{addListener:platform.back,minimizeApp:platform.minimize}}));
vi.mock('../src/services/geolocation/watcher',()=>({watchPosition:platform.watch,stopKnownPositionWatches:platform.stop,requestWakeLock:vi.fn(async()=>null)}));
vi.mock('../src/storage/tripStore',()=>({tripStore:{list:platform.list,save:platform.save}}));
const key='taxi-check.active-ride',guard='taxi-check.native-recovery';
const active=(tariffId:unknown=getActiveTariff().id)=>JSON.stringify({tariffId,startMs:Date.now()-60000,samples:[],supplements:{airportDeparture:false,luggageItems:0},gpsStatus:'waiting'});
beforeEach(()=>{localStorage.clear();selectLanguage('en');platform.name='ios';vi.clearAllMocks();});
afterEach(()=>{cleanup();vi.restoreAllMocks();});
it.each(['aeb','ar','fr','en'] as Language[])('shows %s iOS recovery without Android instructions or an assertion bypass',language=>{
 selectLanguage(language);const acknowledge=vi.fn();render(createElement(NativeRecoveryPage,{error:null,onAcknowledge:acknowledge,onHome:vi.fn()}));
 expect(screen.getByRole('heading',{name:iosCopy[language].title})).toBeTruthy();
 expect(screen.getByText(iosCopy[language].noAcknowledgment)).toBeTruthy();
 expect(screen.queryByRole('button',{name:getMessages().nativeRecovery.iForceStoppedAndReopenedThe})).toBeNull();expect(document.querySelector('ol')).toBeNull();
 expect(document.body.textContent).not.toMatch(/Android|أندرويد|Force stop/i);expect(acknowledge).not.toHaveBeenCalled();
});
it.each([true,false])('preserves compatible restored iOS bytes and guard across discard cancellation, navigation and remount (gpsStatus=%s)',async hasGpsStatus=>{
 const record=JSON.parse(active());if(!hasGpsStatus)delete record.gpsStatus;const raw=JSON.stringify(record);localStorage.setItem(key,raw);const view=render(createElement(App));
 expect(platform.watch).not.toHaveBeenCalled();expect(localStorage.getItem(key)).toBe(raw);expect(localStorage.getItem(guard)).toBe('1');
 fireEvent.click(screen.getByRole('button',{name:'Discard stored active data'}));
 fireEvent.click(screen.getByRole('button',{name:'Keep recovered ride'}));expect(localStorage.getItem(key)).toBe(raw);
 fireEvent.click(screen.getByRole('button',{name:'Go to Home: keep recovered ride'}));
 for(const page of ['Manual calculator','Trip history']){fireEvent.click(screen.getByRole('button',{name:page}));expect(screen.getByRole('heading',{name:page})).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'Back'}));}
 expect(localStorage.getItem(key)).toBe(raw);view.unmount();render(createElement(App));expect(platform.watch).not.toHaveBeenCalled();expect(localStorage.getItem(guard)).toBe('1');
});
it('discards only after existing confirmation, retaining the iOS durable guard and denying direct acknowledgment',()=>{
 localStorage.setItem(key,active());const {result,unmount}=renderHook(useLiveRide);
 act(()=>{expect(result.current.discardRecovery()).toBe(true);});expect(localStorage.getItem(key)).toBeNull();expect(localStorage.getItem(guard)).toBe('1');
 act(()=>{expect(result.current.acknowledgeNativeRecovery()).toBe(false);result.current.start({airportDeparture:false,luggageItems:0});});expect(platform.watch).not.toHaveBeenCalled();unmount();
 const again=renderHook(useLiveRide);expect(again.result.current.nativeRestartBlocked).toBe(true);
});
it('keeps unresolved tariff restoration on its original recovery path',()=>{
 const raw=active('unavailable-historical-id');localStorage.setItem(key,raw);const {result}=renderHook(useLiveRide);
 expect(result.current.recovery?.kind).toBe('tariff');expect(localStorage.getItem(key)).toBe(raw);expect(platform.watch).not.toHaveBeenCalled();
});
it('keeps Android compatible restoration and explicit acknowledgment behavior',()=>{
 platform.name='android';localStorage.setItem(key,active());const view=renderHook(useLiveRide);expect(view.result.current.ride).not.toBeNull();expect(platform.watch).toHaveBeenCalledTimes(1);view.unmount();
 localStorage.clear();localStorage.setItem(guard,'1');const guarded=renderHook(useLiveRide);act(()=>{expect(guarded.result.current.acknowledgeNativeRecovery()).toBe(true);});expect(localStorage.getItem(guard)).toBeNull();
});
it.each(['ios','android'])('limits hardware Back registration to Android (%s)',name=>{
 platform.name=name;render(createElement(App));expect(platform.back).toHaveBeenCalledTimes(name==='android'?1:0);expect(platform.minimize).not.toHaveBeenCalled();
});
it('keeps fresh iOS start/end separate from storage, without claiming physical stop',()=>{
 const {result}=renderHook(useLiveRide);act(()=>result.current.start({airportDeparture:false,luggageItems:0}));expect(platform.watch).toHaveBeenCalledTimes(1);
 let trip;act(()=>{trip=result.current.end();});expect(trip).not.toBeNull();expect(localStorage.getItem(key)).toBeNull();expect(result.current.cleanup).toBeNull();
 expect(getMessages().privacy.endLive('End ride')).toContain('does not verify');expect(getMessages().privacy.activeData).toContain('instead of automatically resuming');
});

it('keeps independent Manual result and offline card controls available while iOS recovery is pending',()=>{
 localStorage.setItem(guard,'1');render(createElement(App));fireEvent.click(screen.getByRole('button',{name:'Go to Home: keep recovery pending'}));
 fireEvent.click(screen.getByRole('button',{name:'Manual calculator'}));fireEvent.change(screen.getByLabelText('Distance (km)'),{target:{value:'5'}});fireEvent.change(screen.getByLabelText('Total duration (min)'),{target:{value:'20'}});fireEvent.click(screen.getByRole('button',{name:'Calculate'}));
 fireEvent.click(screen.getByRole('button',{name:'Share trip'}));expect(screen.getByRole('button',{name:'Prepare PNG preview'}).hasAttribute('disabled')).toBe(false);expect(platform.watch).not.toHaveBeenCalled();expect(localStorage.getItem(guard)).toBe('1');
});
it('requires the existing UI discard confirmation and leaves iOS recovery blocked afterward',()=>{
 localStorage.setItem(key,active());render(createElement(App));const original=localStorage.getItem(key);
 fireEvent.click(screen.getByRole('button',{name:'Discard stored active data'}));expect(localStorage.getItem(key)).toBe(original);
 fireEvent.click(screen.getByRole('button',{name:'Confirm discard'}));expect(localStorage.getItem(key)).toBeNull();expect(localStorage.getItem(guard)).toBe('1');
 expect(screen.getByRole('heading',{name:'iOS recovery pending'})).toBeTruthy();expect(platform.watch).not.toHaveBeenCalled();
});
