import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stopKnownPositionWatches, watchPosition } from '../src/services/geolocation/watcher';
import { selectLanguage } from '../src/localization';

const native = vi.hoisted(() => ({
  os:'android', addWatcher: vi.fn(), removeWatcher: vi.fn(async () => undefined),
  checkPermissions: vi.fn(async () => ({ display: 'granted' })),
  requestPermissions: vi.fn(async () => ({ display: 'granted' })),
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true, getPlatform: () => native.os }, registerPlugin: () => native }));
vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: native }));

beforeEach(() => { native.os='android'; selectLanguage('en'); vi.clearAllMocks(); native.addWatcher.mockResolvedValue('gps-1'); });
afterEach(() => { stopKnownPositionWatches(); vi.restoreAllMocks(); });
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

describe('Android GPS adapter', () => {
  it('keeps an active notification unchanged on selection and uses the new language at the next normal start', async () => {
    selectLanguage('fr'); const stop = watchPosition(vi.fn(), vi.fn()); await flush();
    const first = native.addWatcher.mock.calls[0][0];
    expect(first.backgroundTitle).toBe('Taxi Check: trajet en cours');
    selectLanguage('aeb'); await flush(); expect(native.addWatcher).toHaveBeenCalledTimes(1);
    expect(first.backgroundTitle).toBe('Taxi Check: trajet en cours');
    stop(); watchPosition(vi.fn(), vi.fn()); await flush();
    expect(native.addWatcher.mock.calls[1][0].backgroundTitle).toBe('Taxi Check: الرحلة قاعدة تصير');
  });
  it('recovery cleanup removes known running native watchers and suppresses late callbacks', async () => {
    const sample = vi.fn();
    watchPosition(sample, vi.fn());
    await flush();
    const callback = native.addWatcher.mock.calls[0][1];
    stopKnownPositionWatches();
    callback({ time: 1000, latitude: 36.8, longitude: 10, accuracy: 5 });
    expect(sample).not.toHaveBeenCalled();
    expect(native.removeWatcher).toHaveBeenCalledWith({ id: 'gps-1' });
    stopKnownPositionWatches();
    expect(native.removeWatcher).toHaveBeenCalledTimes(1);
  });

  it('recovery cleanup cancels pending native startup and removes the eventual ID', async () => {
    let resolve!: (id: string) => void;
    native.addWatcher.mockImplementationOnce(() => new Promise<string>(r => { resolve = r; }));
    watchPosition(vi.fn(), vi.fn());
    await flush();
    stopKnownPositionWatches();
    resolve('recovery-late-id');
    await flush();
    expect(native.removeWatcher).toHaveBeenCalledWith({ id: 'recovery-late-id' });
  });
  it('converts native locations and stops the foreground watcher', async () => {
    const sample = vi.fn(); const error = vi.fn();
    const stop = watchPosition(sample, error);
    await flush();
    expect(native.addWatcher.mock.calls[0][0].backgroundMessage).toContain('this phone');
    const callback = native.addWatcher.mock.calls[0][1];
    callback({ time: 1000, latitude: 36.8, longitude: 10, accuracy: 5, speed: null });
    expect(sample).toHaveBeenCalledWith({ t: 1000, lat: 36.8, lon: 10, accuracy: 5, speed: null });
    stop();
    expect(native.removeWatcher).toHaveBeenCalledWith({ id: 'gps-1' });
    callback({ time: 2000, latitude: 36.8, longitude: 10, accuracy: 5, speed: null });
    expect(sample).toHaveBeenCalledTimes(1);
  });

  it('removes a watcher that finishes starting after the ride ended', async () => {
    let resolve!: (id: string) => void;
    native.addWatcher.mockImplementationOnce(() => new Promise<string>((r) => { resolve = r; }));
    const stop = watchPosition(vi.fn(), vi.fn());
    await flush();
    stop(); resolve('late-watcher'); await flush();
    expect(native.removeWatcher).toHaveBeenCalledWith({ id: 'late-watcher' });
  });

  it('reports denied location permission without throwing', async () => {
    native.addWatcher.mockRejectedValueOnce({ code: 'NOT_AUTHORIZED' });
    const error = vi.fn();
    watchPosition(vi.fn(), error);
    await flush();
    expect(error).toHaveBeenCalledWith('denied');
  });
});

it('iOS starts location without requesting unrelated notification permission',async()=>{
 native.os='ios';const stop=watchPosition(vi.fn(),vi.fn());await flush();
 expect(native.checkPermissions).not.toHaveBeenCalled();expect(native.requestPermissions).not.toHaveBeenCalled();
 expect(native.addWatcher).toHaveBeenCalledWith(expect.objectContaining({requestPermissions:true,backgroundMessage:expect.any(String)}),expect.any(Function));
 stop();expect(native.removeWatcher).toHaveBeenCalledWith({id:'gps-1'});
});
it('iOS removes a late-starting watcher and suppresses callbacks after cancellation',async()=>{
 native.os='ios';let complete!:(id:string)=>void;native.addWatcher.mockImplementationOnce(()=>new Promise<string>(resolve=>{complete=resolve;}));
 const sample=vi.fn(),stop=watchPosition(sample,vi.fn());await flush();const callback=native.addWatcher.mock.calls[0][1];stop();complete('ios-late');await flush();
 callback({time:1000,latitude:36,longitude:10,accuracy:5});expect(sample).not.toHaveBeenCalled();expect(native.removeWatcher).toHaveBeenCalledWith({id:'ios-late'});
});
it('Android still requests notification permission only when prompted',async()=>{
 native.checkPermissions.mockResolvedValueOnce({display:'prompt'});watchPosition(vi.fn(),vi.fn());await flush();
 expect(native.requestPermissions).toHaveBeenCalledTimes(1);expect(native.addWatcher).toHaveBeenCalledTimes(1);
});
