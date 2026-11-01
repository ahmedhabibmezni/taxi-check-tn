/** datetime-local inputs represent tariff local time, independently of the phone. */
export function tariffDateTimeInput(epochMs: number, offsetMinutes: number): string {
  return new Date(epochMs + offsetMinutes * 60_000).toISOString().slice(0, 16);
}

export function parseTariffDateTime(input: string, offsetMinutes: number): number {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input)) return NaN;
  const utc = Date.parse(`${input}:00Z`);
  if (!Number.isFinite(utc) || new Date(utc).toISOString().slice(0, 16) !== input) return NaN;
  return utc - offsetMinutes * 60_000;
}
