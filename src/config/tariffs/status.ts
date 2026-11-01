import { getTariff } from './index';
import { validateTariff, type TaxiTariff } from '../../domain/fare/tariff';

export type TariffStatus =
  | { status: 'valid'; tariff: TaxiTariff }
  | { status: 'missing'; id: string }
  | { status: 'invalid'; id: string; errors: string[] };

export function resolveTariff(id: string): TariffStatus {
  const tariff = getTariff(id);
  if (!tariff) return { status: 'missing', id };
  const errors = validateTariff(tariff);
  return errors.length ? { status: 'invalid', id, errors } : { status: 'valid', tariff };
}
