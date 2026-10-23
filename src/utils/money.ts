/** Formats integer millimes as "15.000". */
export function formatTnd(millimes: number, decimals: 1 | 3 = 3): string {
  const sign = millimes < 0 ? '-' : '';
  const abs = Math.abs(Math.round(millimes));
  if (decimals === 1) return `${sign}${(Math.round(abs / 100) / 10).toFixed(1)}`;
  return `${sign}${Math.floor(abs / 1000)}.${String(abs % 1000).padStart(3, '0')}`;
}

export function formatSignedTnd(millimes: number): string {
  return millimes > 0 ? `+${formatTnd(millimes)}` : formatTnd(millimes);
}

/**
 * Parses "15", "15.000", "15,5" or "15.5" into millimes without floating point.
 * Comma is a decimal separator. Returns null for invalid input.
 */
export function parseTnd(input: string): number | null {
  const s = input.trim().replace(',', '.');
  const match = /^(\d{1,4})(?:\.(\d{0,3}))?$/.exec(s);
  if (!match) return null;
  return Number(match[1]) * 1000 + Number((match[2] ?? '').padEnd(3, '0'));
}
