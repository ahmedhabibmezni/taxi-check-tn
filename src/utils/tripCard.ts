import type { TripRecord } from '../domain/trip/types';
import { compareWithMeter } from '../domain/fare/compare';
import { DEFAULT_THRESHOLDS } from '../config/estimation';
import { catalogs, languages, type Language } from '../localization';
import { formatSignedTnd, formatTnd } from './money';
import { isolate } from '../localization/types';

export type CardOptions = { comparison: boolean; details: boolean };
export type CardBlock = Readonly<{ kind: 'label' | 'fare' | 'range' | 'text' | 'comparison' | 'detail' | 'difference'; text: string }>;
export type CardSnapshot = Readonly<{ language: Language; direction: 'rtl' | 'ltr'; blocks: readonly CardBlock[] }>;
export type RenderedCard = Readonly<{ snapshot: CardSnapshot; blob: Blob; width: number; height: number }>;
const Segmenter = (Intl as unknown as { Segmenter?: new (locale: string, options: { granularity: 'grapheme' }) => {
  segment(text: string): Iterable<{ segment: string }>;
} }).Segmenter;

async function readyWithin<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Card rendering timed out')), 10_000);
  })]); }
  finally { clearTimeout(timer!); }
}

/** Presentation allowlist only; never copy a stored record or raw historical warnings. */
export function snapshotTripCard(trip: TripRecord, language: Language, options: CardOptions): CardSnapshot {
  const copy = catalogs[language];
  const blocks: CardBlock[] = [
    { kind: 'label', text: copy.result.estimatedFare },
    { kind: 'fare', text: `≈ ${copy.shared.money(formatTnd(trip.estimate.best))}` },
    { kind: 'label', text: copy.result.expectedRange },
    { kind: 'range', text: copy.shared.range(formatTnd(trip.estimate.low), formatTnd(trip.estimate.high)) },
    { kind: 'text', text: copy.result.anIndependentEstimateNotAGuaranteed },
    { kind: 'text', text: copy.live.tariffNotOfficiallyVerified },
    { kind: 'text', text: copy.card.fareCaution },
  ];
  if (trip.warnings.length || trip.confidence < DEFAULT_THRESHOLDS.lowConfidence) {
    blocks.push({ kind: 'text', text: copy.card.limitedData });
  }
  if (options.comparison && trip.meter !== null) {
    blocks.push({ kind: 'detail', text: `${copy.result.driversMeter}: ${isolate(copy.shared.money(formatTnd(trip.meter)))}` });
    const comparison = trip.meter > 0 ? compareWithMeter({ ...trip.estimate, confidence: trip.confidence }, trip.meter) : null;
    if (comparison) {
      blocks.push({ kind: 'comparison', text: copy.comparison[comparison.status] });
      blocks.push({ kind: 'difference', text: copy.result.comparisonDifference(formatSignedTnd(comparison.diff),
        `${comparison.diffPct > 0 ? '+' : ''}${comparison.diffPct.toFixed(1)}`) });
    } else blocks.push({ kind: 'comparison', text: copy.comparison.undetermined });
    blocks.push({ kind: 'text', text: copy.card.comparisonCaution });
  }
  if (options.details) {
    blocks.push({ kind: 'detail', text: `${copy.result.distance}: ${copy.shared.kilometers((trip.distanceM / 1000).toFixed(1))}` });
    blocks.push({ kind: 'detail', text: `${copy.result.duration}: ${copy.shared.minutes(Math.round(trip.durationS / 60))}` });
  }
  return Object.freeze({ language, direction: languages[language].dir,
    blocks: Object.freeze(blocks.map(block => Object.freeze(block))) });
}

function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, language: string): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/u)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= width) { line = next; continue; }
    if (line) { lines.push(line); line = ''; }
    if (ctx.measureText(word).width <= width) { line = word; continue; }
    // Do not split combining marks from their base when a long token must wrap.
    const segments = new Segmenter!(language, { granularity: 'grapheme' }).segment(word);
    for (const { segment } of segments) {
      if (line && ctx.measureText(line + segment).width > width) { lines.push(line); line = ''; }
      line += segment;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export async function renderTripCard(snapshot: CardSnapshot): Promise<RenderedCard> {
  if (!document.fonts || !Segmenter) throw new Error('Card typography is unavailable');
  const fonts = ['400 24px "Ticket UI"', '700 24px "Ticket UI"', '600 60px "Ticket Display"'];
  if (snapshot.direction === 'rtl') fonts.push('400 24px "Ticket Arabic"', '700 24px "Ticket Arabic"');
  for (const font of fonts) {
    const faces = await readyWithin(document.fonts.load(font));
    if (!faces.length || faces.some(face => face.status !== 'loaded') || !document.fonts.check(font)) {
      throw new Error('Card font could not be loaded');
    }
  }
  const logo = new Image();
  const logoReady = new Promise<void>((resolve, reject) => {
    logo.onload = () => logo.naturalWidth > 0 ? resolve() : reject(new Error('Card logo is empty'));
    logo.onerror = () => reject(new Error('Card logo could not be loaded'));
  });
  logo.src = new URL(`${import.meta.env.BASE_URL}icons/icon.svg`, document.baseURI).href;
  await readyWithin(logoReady);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('PNG rendering is unavailable');
  const width = 600, padding = 40, lineWidth = width - padding * 2;
  const ui = snapshot.direction === 'rtl' ? '"Ticket Arabic"' : '"Ticket UI"';
  let fareSize = 60;
  const fare = snapshot.blocks.find(block => block.kind === 'fare')?.text ?? '';
  while (fareSize > 32) {
    ctx.font = `600 ${fareSize}px "Ticket Display", "Ticket Arabic"`;
    if (ctx.measureText(fare).width <= lineWidth) break;
    fareSize -= 2;
  }
  const fontFor = (block: CardBlock) => block.kind === 'fare' ? `600 ${fareSize}px "Ticket Display", "Ticket Arabic"`
    : `${block.kind === 'comparison' || block.kind === 'detail' || block.kind === 'difference' ? 700 : 400} 24px ${ui}`;
  const rows = snapshot.blocks.map(block => {
    ctx.font = fontFor(block);
    return { block, lines: wrap(ctx, block.text, lineWidth, snapshot.language), lineHeight: block.kind === 'fare' ? 84 : 42 };
  });
  const height = 164 + rows.reduce((sum, row) => sum + row.lines.length * row.lineHeight + (row.block.kind === 'range' ? 46 : 22), 0) + 48;
  if (height * 2 > 16384) throw new Error('Card exceeds the supported image dimensions');
  canvas.width = width * 2; canvas.height = height * 2;
  ctx.scale(2, 2);
  ctx.fillStyle = '#faf8f0'; ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#20261f'; ctx.strokeRect(1, 1, width - 2, height - 2);
  const rtl = snapshot.direction === 'rtl';
  ctx.drawImage(logo, rtl ? width - padding - 42 : padding, 38, 42, 42);
  ctx.direction = 'ltr'; ctx.textAlign = rtl ? 'right' : 'left'; ctx.textBaseline = 'top';
  ctx.font = '700 24px "Ticket UI"'; ctx.fillStyle = '#20261f';
  ctx.fillText('Taxi Check TN', rtl ? width - padding - 58 : padding + 58, 43);
  ctx.strokeStyle = '#bac1b3'; ctx.beginPath(); ctx.moveTo(padding, 108); ctx.lineTo(width - padding, 108); ctx.stroke();
  let y = 142;
  for (const { block, lines, lineHeight } of rows) {
    const strip = block.kind === 'label' || block.kind === 'fare' || block.kind === 'range';
    if (strip) { ctx.fillStyle = '#f5c518'; ctx.fillRect(1, y - 12, width - 2, lines.length * lineHeight + 34); }
    ctx.font = fontFor(block); ctx.fillStyle = '#20261f';
    ctx.direction = block.kind === 'fare' || block.kind === 'range' || block.kind === 'difference' ? 'ltr' : snapshot.direction;
    ctx.textAlign = block.kind === 'fare' || !rtl ? 'left' : 'right';
    for (const line of lines) { ctx.fillText(line, block.kind === 'fare' || !rtl ? padding : width - padding, y); y += lineHeight; }
    y += block.kind === 'range' ? 46 : 22;
  }
  ctx.setLineDash([3, 7]); ctx.strokeStyle = '#737d6f'; ctx.beginPath();
  ctx.moveTo(padding, height - 24); ctx.lineTo(width - padding, height - 24); ctx.stroke();
  const blob = await readyWithin(new Promise<Blob>((resolve, reject) => canvas.toBlob(result => result?.type === 'image/png' && result.size
    ? resolve(result) : reject(new Error('PNG encoding failed')), 'image/png')));
  return Object.freeze({ snapshot, blob, width: canvas.width, height: canvas.height });
}
