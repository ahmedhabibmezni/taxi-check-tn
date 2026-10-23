import type { ComparisonThresholds } from '../../config/estimation';
import { DEFAULT_THRESHOLDS } from '../../config/estimation';
import type { FareEstimate } from './types';

export type ComparisonStatus = 'within' | 'below' | 'slightly_above' | 'significantly_above' | 'undetermined';

export interface Comparison {
  meter: number;
  diff: number;
  diffPct: number;
  status: ComparisonStatus;
  label: string;
  notes: string[];
}

export const STATUS_LABELS: Record<ComparisonStatus, string> = {
  within: 'Within expected range',
  below: 'Below estimate',
  slightly_above: 'Slightly above estimate',
  significantly_above: 'Significantly above estimate',
  undetermined: 'Unable to determine reliably',
};

/** Neutral comparison. Never concludes fraud, only how far the meter is from the estimate. */
export function compareWithMeter(
  est: Pick<FareEstimate, 'best' | 'low' | 'high' | 'confidence'>,
  meter: number,
  th: ComparisonThresholds = DEFAULT_THRESHOLDS,
): Comparison {
  const diff = meter - est.best;
  const diffPct = est.best > 0 ? (diff / est.best) * 100 : 0;
  const notes: string[] = [];
  let status: ComparisonStatus;

  if (est.confidence < th.minConfidence) {
    status = 'undetermined';
    notes.push('Not enough reliable data about this ride to compare.');
  } else if (meter < est.low) {
    status = 'below';
  } else if (meter <= est.high) {
    status = 'within';
  } else {
    const overPct = est.best > 0 ? ((meter - est.high) / est.best) * 100 : Infinity;
    status = overPct <= th.slightlyAbovePct ? 'slightly_above' : 'significantly_above';
    notes.push('Check that supplements (airport, luggage) and the night tariff were applied as expected.');
  }
  if (status !== 'undetermined' && est.confidence < th.lowConfidence) {
    notes.push('Estimate has limited accuracy, treat this comparison with caution.');
  }
  return { meter, diff, diffPct, status, label: STATUS_LABELS[status], notes };
}
