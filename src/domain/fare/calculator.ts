import { SingleApplicationStrategy } from './strategies/singleApplication';
import type { FareCalculationStrategy } from './strategies/strategy';
import type { TaxiTariff } from './tariff';
import type { FareEstimate, TripInput } from './types';

export const DEFAULT_STRATEGY: FareCalculationStrategy = new SingleApplicationStrategy();

export function estimateFare(
  trip: TripInput,
  tariff: TaxiTariff,
  strategy: FareCalculationStrategy = DEFAULT_STRATEGY,
): FareEstimate {
  return strategy.calculate(trip, tariff);
}
