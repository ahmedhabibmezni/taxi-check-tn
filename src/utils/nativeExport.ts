import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem, type Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export async function stageNativeExport(name: string, data: string, encoding?: Encoding): Promise<'share-returned' | 'cancelled'> {
  if (!name || /[\\/]/.test(name) || name === '.' || name === '..') throw new Error('Export requires a filename without directories');
  const snapshot = data;
  const attempt = `taxi-check-export-${crypto.randomUUID()}`;
  await Filesystem.mkdir({ path: attempt, directory: Directory.Cache, recursive: false });
  const path = `${attempt}/${name}`;
  const file = await Filesystem.writeFile({ path, data: snapshot, directory: Directory.Cache, ...(encoding ? { encoding } : {}) });
  if (typeof file?.uri !== 'string') throw new Error('Export staging did not return a file URI');
  const staged = new URL(file.uri);
  if (staged.protocol !== 'file:' || staged.host !== '' || !decodeURIComponent(staged.pathname).endsWith(`/${path}`)) {
    throw new Error('Export staging returned an unexpected file URI');
  }
  try { await Share.share({ title: name, files: [file.uri] }); }
  catch (error) {
    // Both installed native Share implementations reject this exact cancellation message.
    if (['android','ios'].includes(Capacitor.getPlatform()) && error instanceof Error && error.message === 'Share canceled') return 'cancelled';
    throw error;
  }
  return 'share-returned';
}
