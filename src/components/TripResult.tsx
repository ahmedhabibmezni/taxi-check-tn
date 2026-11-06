import { useMessages } from '../localization';
import { presentMessage } from '../localization/messages';
import { useEffect, useRef, useState } from 'react';
import { compareWithMeter } from '../domain/fare/compare';
import type { TripRecord } from '../domain/trip/types';
import { readCompletedTrip } from '../storage/completedTrip';
import { TripCardExport } from './TripCardExport';
import { formatSignedTnd, formatTnd, parseTnd } from '../utils/money';
import { Disclaimer, km, minutes, range, Row, TariffDetails, tnd, Warnings } from './ui';

type Props = {
  trip: TripRecord;
  isSaved: boolean;
  onSave: (t: TripRecord) => Promise<void>;
  autoSavePending?: boolean;
  initialMeterText?: string;
  onMeterDraft?: (text: string) => void;
};

export function TripResult(props: Props) {
  const en = useMessages();
  const trip = readCompletedTrip(props.trip);
  if (!trip) return <p className="error" role="alert">{en.historyRead.resultUnreadable}</p>;
  return <ReadableTripResult {...props} trip={trip} />;
}

function ReadableTripResult({ trip, isSaved, onSave, autoSavePending = false, initialMeterText, onMeterDraft }: Props) {
  const en = useMessages();
  const originalMeterText = trip.meter === null ? '' : formatTnd(trip.meter);
  const draftEdited = initialMeterText !== undefined && initialMeterText !== originalMeterText;
  const [meterText, setMeterText] = useState(initialMeterText ?? originalMeterText);
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'error'>(isSaved && !draftEdited ? 'saved' : 'idle');
  const [saving, setSaving] = useState(false);
  const pendingSave = useRef(false);
  const editRevision = useRef(draftEdited ? 1 : 0);
  useEffect(() => {
    if (isSaved && editRevision.current === 0) setSaveState('saved');
  }, [isSaved]);
  const meter = parseTnd(meterText);
  const est = { ...trip.estimate, confidence: trip.confidence };
  const cmp = meter !== null && meter > 0 ? compareWithMeter(est, meter) : null;
  const b = trip.estimate.breakdown;
  const updated: TripRecord = editRevision.current === 0 ? trip : cmp
      ? { ...trip, meter: cmp.meter, diff: cmp.diff, diffPct: cmp.diffPct }
      : { ...trip, meter: null, diff: null, diffPct: null };
  const invalidMeter = meterText.trim() !== '' && (meter === null || meter <= 0)
    && !(editRevision.current === 0 && trip.meter === 0);

  const save = async () => {
    if (pendingSave.current || autoSavePending) return;
    pendingSave.current = true;
    setSaving(true);
    const revision = editRevision.current;
    try {
      await onSave(updated);
      if (editRevision.current === revision) setSaveState('saved');
    } catch {
      setSaveState('error');
    } finally {
      pendingSave.current = false;
      setSaving(false);
    }
  };

  return (
    <>
      <section className="fare-strip">
        <div className="big-label">{en.result.estimatedFare}</div>
        <div className="big num">≈ {tnd(trip.estimate.best)}</div>
        <Row label={en.result.expectedRange} value={range(trip.estimate.low, trip.estimate.high)} />
      </section>
      <p className="small muted">{en.result.anIndependentEstimateNotAGuaranteed}</p>
      <p className="notice small">{en.live.tariffNotOfficiallyVerified}</p>
      <section className="trip-metrics">
        <Row label={en.result.distance} value={km(trip.distanceM)} />
        <Row label={en.result.duration} value={minutes(trip.durationS)} />
        <Row label={en.result.movingSlow} value={en.result.movingSlowValue(minutes(trip.movingTimeS), minutes(trip.slowTimeS))} />
      </section>

      <Warnings items={trip.warnings} />
      <section className="card meter-section">
        <label className="field" htmlFor="meter">{en.result.driversMeter}</label>
        <div className="meter-input">
          <input
            id="meter"
            inputMode="decimal"
            placeholder={en.result.meterExample}
            value={meterText}
            aria-invalid={invalidMeter || undefined}
            aria-describedby={invalidMeter ? 'meter-error' : undefined}
            onChange={(e) => {
              setMeterText(e.target.value);
              onMeterDraft?.(e.target.value);
              editRevision.current++;
              setSaveState('idle');
            }}
          />
          <span>{en.result.currency}</span>
        </div>
        {invalidMeter && <p className="error" id="meter-error">{en.result.enterAPositiveAmountLike15}</p>}
        {cmp && (
          <div className={`status status-${cmp.status}`} role="status">
            <div className="num diff">
              {en.result.comparisonDifference(formatSignedTnd(cmp.diff), `${cmp.diffPct > 0 ? '+' : ''}${cmp.diffPct.toFixed(1)}`)}
            </div>
            <strong>{en.comparison[cmp.status]}</strong>
            {cmp.notes.map((n) => (
              <p key={n}>{presentMessage(n)}</p>
            ))}
          </div>
        )}
        <button type="button" className="btn" onClick={save} disabled={invalidMeter || saving || autoSavePending}>
          {saving || autoSavePending ? en.result.saving : saveState === 'saved' ? en.result.saved : isSaved ? en.result.updateTrip : en.result.saveToHistory}
        </button>
        <p role="status" aria-atomic="true" className={saveState === 'error' ? 'error' : 'small muted'}>
          {saving || autoSavePending ? en.result.savingTripFurtherEditsWillNeed : saveState === 'error' ? en.result.couldNotSaveOnThisDevice : saveState === 'saved' ? en.result.tripSavedInHistoryOnThis : ''}
        </p>
      </section>

      <TripCardExport trip={updated} disabled={invalidMeter} />
      <details className="card">
        <summary>{en.result.breakdown}</summary>
        <Row label={en.result.initialCharge} value={tnd(b.initialFare)} />
        <Row label={en.result.distance} value={tnd(b.distanceCharge)} />
        <Row label={en.result.waitingSlow} value={tnd(b.waitingCharge)} />
        {b.nightSurcharge > 0 && <Row label={en.result.ofWhichNightSurcharge} value={tnd(b.nightSurcharge)} />}
        {b.airportSupplement > 0 && <Row label={en.result.airportSupplement} value={tnd(b.airportSupplement)} />}
        {b.luggageSupplement > 0 && <Row label={en.result.luggage} value={tnd(b.luggageSupplement)} />}
        <Row label={en.result.estimatedTotal} value={<strong>{tnd(b.total)}</strong>} />
        <Row label={en.result.recordedTariffID} value={trip.tariffId} />
      </details>

      <details className="card">
        <summary>{en.shared.tariffVerification}</summary>
        <TariffDetails tariffId={trip.tariffId} />
      </details>
      <details className="card" aria-label={en.result.inputQuality}>
        <summary>{en.result.inputQuality}</summary>
        <Row label={en.result.recordedInputQualityScore} value={en.result.qualityScore(Math.round(trip.confidence * 100))} />
        <p>{en.result.thisExistingScoreReflectsGPSCoverage}</p>
      </details>
      <Disclaimer />
    </>
  );
}
