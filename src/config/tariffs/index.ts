import type { TaxiTariff } from '../../domain/fare/tariff';
import { validateTariff } from '../../domain/fare/tariff';

/**
 * ===== UPDATE THE TUNISIAN TARIFF HERE =====
 *
 * Add a new object to TARIFFS (keep old ones so saved trips stay explainable),
 * then point ACTIVE_TARIFF_ID at it. Money is in integer millimes:
 * 0.900 TND = 900, 0.046 TND = 46.
 */
export const TARIFFS: readonly TaxiTariff[] = [
  {
    id: 'tn-individual-user-2026-10',
    name: 'Taxi individuel, values supplied by the user',
    effectiveFrom: null,
    initialFare: 900,
    distanceStepMeters: 79,
    distanceStepFare: 46,
    waitingStepSeconds: 18,
    waitingStepFare: 46,
    nightMultiplier: 1.5,
    nightStart: '21:00',
    nightEnd: '05:00',
    nightAppliesToInitialFare: true,
    airportSupplement: 4500,
    luggageSupplement: 1000,
    // switchingSpeedKmh intentionally unset: no verified official value.
    utcOffsetMinutes: 60,
    source: 'Last values verified by the user. No official decree reference recorded in the app.',
    lastReviewed: '2026-10-23',
    notice:
      'A 2026 fare increase was reported but its entry into force is not confirmed. ' +
      'If the meter starts above 0.900 TND, this tariff is probably outdated.',
  },
];

export const ACTIVE_TARIFF_ID = 'tn-individual-user-2026-10';

export function getTariff(id: string): TaxiTariff | undefined {
  return TARIFFS.find((t) => t.id === id);
}

export function getActiveTariff(): TaxiTariff {
  const tariff = getTariff(ACTIVE_TARIFF_ID);
  if (!tariff) throw new Error(`Active tariff "${ACTIVE_TARIFF_ID}" not found`);
  const errors = validateTariff(tariff);
  if (errors.length) throw new Error(`Invalid tariff ${tariff.id}: ${errors.join('; ')}`);
  return tariff;
}
