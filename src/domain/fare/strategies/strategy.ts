import type { TaxiTariff } from '../tariff';
import type { FareEstimate, TripInput } from '../types';

export interface FareCalculationStrategy {
  readonly id: string;
  calculate(trip: TripInput, tariff: TaxiTariff): FareEstimate;
}
