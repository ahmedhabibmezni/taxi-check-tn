import { describe, expect, it } from 'vitest';
import { parseTariffDateTime, tariffDateTimeInput } from '../src/utils/tariffTime';

describe('manual Tunisian local time', () => {
  it('uses the tariff offset rather than the device time zone', () => {
    const utc = Date.UTC(2026, 9, 22, 20, 0);
    expect(tariffDateTimeInput(utc, 60)).toBe('2026-10-22T21:00');
    expect(parseTariffDateTime('2026-10-22T21:00', 60)).toBe(utc);
  });
  it('rejects invalid dates instead of silently normalizing them', () => {
    expect(parseTariffDateTime('2026-02-30T21:00', 60)).toBeNaN();
    expect(parseTariffDateTime('', 60)).toBeNaN();
  });
});
