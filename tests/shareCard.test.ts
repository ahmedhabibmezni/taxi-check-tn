// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { shareCard, downloadCard } from '../src/utils/shareCard';

const platform = vi.hoisted(() => ({ native: true, name: 'android', mkdir: vi.fn(), write: vi.fn(), share: vi.fn() }));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => platform.native, getPlatform: () => platform.name } }));
vi.mock('@capacitor/filesystem', () => ({ Directory: { Cache: 'CACHE' }, Filesystem: { mkdir: platform.mkdir, writeFile: platform.write } }));
vi.mock('@capacitor/share', () => ({ Share: { share: platform.share } }));
const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 255, 17, 128]);
const png = () => new Blob([bytes], { type: 'image/png' });
const files = new Map<string, string>();
beforeEach(() => {
  vi.resetAllMocks(); files.clear(); platform.native = true; platform.name = 'android';
  platform.mkdir.mockResolvedValue(undefined);
  platform.write.mockImplementation(async ({ path, data }) => { files.set(path, data); return { uri: `file:///private/cache/${path}` }; });
  platform.share.mockResolvedValue({});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('stages binary PNG without UTF8 encoding, unique paths and no identifiers in visible names', async () => {
  await expect(shareCard(png())).resolves.toBe('share-returned');
  const first = platform.write.mock.calls[0][0]; const original = files.get(first.path);
  expect(first).not.toHaveProperty('encoding'); expect(atob(first.data)).toBe(String.fromCharCode(...bytes));
  await shareCard(new Blob([bytes, 'later'], { type: 'image/png' }));
  const next = platform.write.mock.calls[1][0];
  expect(next.path).not.toBe(first.path); expect(next.path.endsWith('/taxi-check-trip-card.png')).toBe(true);
  expect(files.get(first.path)).toBe(original); expect(platform.share.mock.calls[0][0].files).toEqual([`file:///private/cache/${first.path}`]);
});
it('shares QR snapshots under a separate visible filename with the same immutable binary staging',async()=>{
  await shareCard(png(),'taxi-check-trip-qr.png');await shareCard(png(),'taxi-check-trip-qr.png');
  const paths=platform.write.mock.calls.map(c=>c[0].path);expect(paths[0]).not.toBe(paths[1]);expect(paths.every(p=>p.endsWith('/taxi-check-trip-qr.png'))).toBe(true);
  await expect(shareCard(png(),'../other.png')).rejects.toThrow('filename');expect(platform.share).toHaveBeenCalledTimes(2);
});
it('keeps concurrent PNG attempts separate and waits for each successful write before sharing', async () => {
  let finish!: () => void; const gate = new Promise<void>(resolve => { finish = resolve; });
  const write = platform.write.getMockImplementation()!;
  platform.write.mockImplementationOnce(async options => { await gate; return write(options); });
  const first = shareCard(png()); await vi.waitFor(() => expect(platform.write).toHaveBeenCalledTimes(1));
  expect(platform.share).not.toHaveBeenCalled();
  await shareCard(new Blob([bytes, 'second'], { type: 'image/png' }));
  expect(platform.share).toHaveBeenCalledTimes(1); finish(); await first;
  expect(platform.share).toHaveBeenCalledTimes(2); expect(files.size).toBe(2);
  expect(new Set(platform.share.mock.calls.map(c => c[0].files[0])).size).toBe(2);
});
it.each(['mkdir', 'write', 'uri'])('does not share an old file after %s failure and allocates fresh retry', async failure => {
  await shareCard(png()); const original = [...files.entries()][0];
  if (failure === 'mkdir') platform.mkdir.mockRejectedValueOnce(Error('allocation failure'));
  if (failure === 'write') platform.write.mockRejectedValueOnce(Error('write failure'));
  if (failure === 'uri') platform.write.mockResolvedValueOnce({ uri: 'file:///private/cache/stale.png' });
  await expect(shareCard(png())).rejects.toThrow(); expect(platform.share).toHaveBeenCalledTimes(1);
  expect(files.get(original[0])).toBe(original[1]);
  await shareCard(png()); expect(platform.share).toHaveBeenCalledTimes(2);
  expect(platform.mkdir.mock.calls[2][0].path).not.toBe(platform.mkdir.mock.calls[1][0].path);
});
it.each(['android', 'ios'])('reports %s native chooser cancellation without claiming delivery', async name => {
  platform.name = name; platform.share.mockRejectedValueOnce(Error('Share canceled'));
  await expect(shareCard(png())).resolves.toBe('cancelled');
});
it('rejects PNG reads and invalid content before staging', async () => {
  await expect(shareCard(new Blob(['not PNG'], { type: 'text/plain' }))).rejects.toThrow('PNG');
  vi.stubGlobal('FileReader', class { onerror?: () => void; readAsDataURL() { queueMicrotask(() => this.onerror?.()); } });
  await expect(shareCard(png())).rejects.toThrow('read failed'); expect(platform.mkdir).not.toHaveBeenCalled();
});
function browser(supported: boolean) {
  platform.native = false;
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: vi.fn(() => supported) });
  Object.defineProperty(navigator, 'share', { configurable: true, value: vi.fn(async () => {}) });
  URL.createObjectURL = vi.fn(() => 'blob:synthetic-png'); URL.revokeObjectURL = vi.fn();
  return vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
}
it('uses supported browser file sharing with the exact ready PNG and no download', async () => {
  const click = browser(true); await expect(shareCard(png())).resolves.toBe('share-returned');
  const file = vi.mocked(navigator.share).mock.calls[0][0]!.files![0];
  expect(file.name).toBe('taxi-check-trip-card.png'); expect(file.type).toBe('image/png'); expect(file.size).toBe(bytes.length);
  expect(click).not.toHaveBeenCalled(); expect(platform.write).not.toHaveBeenCalled();
});
it('downloads when browser file sharing is unsupported and permits an explicit fallback after failure', async () => {
  const click = browser(false); await expect(shareCard(png())).resolves.toBe('download-requested'); expect(click).toHaveBeenCalledTimes(1);
  expect(navigator.share).not.toHaveBeenCalled();
  vi.mocked(navigator.canShare).mockReturnValue(true); vi.mocked(navigator.share).mockRejectedValueOnce(Error('Synthetic denied'));
  await expect(shareCard(png())).rejects.toThrow('denied'); expect(click).toHaveBeenCalledTimes(1);
  expect(downloadCard(png())).toBe('download-requested'); expect(click).toHaveBeenCalledTimes(2);
});
it('does not silently download after browser cancellation', async () => {
  const click = browser(true); vi.mocked(navigator.share).mockRejectedValueOnce(new DOMException('cancelled', 'AbortError'));
  await expect(shareCard(png())).resolves.toBe('cancelled'); expect(click).not.toHaveBeenCalled();
});

it('keeps iOS private PNG snapshots immutable across repeated successful sharing',async()=>{
 platform.name='ios';await expect(shareCard(png())).resolves.toBe('share-returned');const first=[...files.entries()][0];
 await expect(shareCard(new Blob([bytes,'changed'],{type:'image/png'}))).resolves.toBe('share-returned');
 expect(files.get(first[0])).toBe(first[1]);expect(files.size).toBe(2);expect(platform.share.mock.calls[0][0].files[0]).not.toBe(platform.share.mock.calls[1][0].files[0]);
});
