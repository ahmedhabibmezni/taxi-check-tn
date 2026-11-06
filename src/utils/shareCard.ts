import { Capacitor } from '@capacitor/core';
import { stageNativeExport } from './nativeExport';

export type CardShareOutcome = 'share-returned' | 'download-requested' | 'cancelled';
const cardName = 'taxi-check-trip-card.png';

export function downloadCard(blob: Blob, name = cardName): CardShareOutcome {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name;
  try { anchor.click(); }
  finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
  return 'download-requested';
}

export function canShareCard(blob: Blob, name = cardName): boolean {
  try { return typeof navigator.share === 'function' && typeof navigator.canShare === 'function'
    && navigator.canShare({ files: [new File([blob], name, { type: 'image/png' })] }); }
  catch { return false; }
}

export async function shareCard(blob: Blob, name = cardName): Promise<CardShareOutcome> {
  if (![cardName,'taxi-check-trip-qr.png'].includes(name)) throw new Error('Invalid image filename');
  if (blob.type !== 'image/png' || !blob.size) throw new Error('A PNG card is required');
  if (Capacitor.isNativePlatform()) {
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => typeof reader.result === 'string' && reader.result.startsWith('data:image/png;base64,')
        ? resolve(reader.result.slice(reader.result.indexOf(',') + 1)) : reject(new Error('PNG encoding failed'));
      reader.onerror = () => reject(new Error('PNG read failed'));
      reader.readAsDataURL(blob);
    });
    return stageNativeExport(name, base64);
  }
  if (!canShareCard(blob,name)) return downloadCard(blob,name);
  try {
    await navigator.share({ files: [new File([blob], name, { type: 'image/png' })] });
    return 'share-returned';
  } catch (error) {
    if ((error instanceof Error || error instanceof DOMException) && error.name === 'AbortError') return 'cancelled';
    throw error;
  }
}
