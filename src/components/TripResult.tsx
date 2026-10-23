import { useState } from 'react';
import { getTariff } from '../config/tariffs';
import { compareWithMeter } from '../domain/fare/compare';
import type { TripRecord } from '../domain/trip/types';
import { downloadFile, tripsToCsv } from '../utils/export';
import { formatSignedTnd, formatTnd, parseTnd } from '../utils/money';
import { Disclaimer, km, minutes, range, Row, tnd, Warnings } from './ui';

type Props = {
  trip: TripRecord;
  isSaved: boolean;
  onSave: (t: TripRecord) => Promise<void>;
};

export function TripResult({ trip, isSaved, onSave }: Props) {
  const [meterText, setMeterText] = useState(trip.meter === null ? '' : formatTnd(trip.meter));
  const [saveState, setSaveState] = useState<'idle' | 'saved' | 'error'>(isSaved ? 'saved' : 'idle');
  const meter = parseTnd(meterText);
  const est = { ...trip.estimate, confidence: trip.confidence };
  const cmp = meter !== null && meter > 0 ? compareWithMeter(est, meter) : null;
  const b = trip.estimate.breakdown;
  const tariff = getTariff(trip.tariffId);

  const save = async () => {
    const updated: TripRecord = cmp
      ? { ...trip, meter: cmp.meter, diff: cmp.diff, diffPct: cmp.diffPct }
      : { ...trip, meter: null, diff: null, diffPct: null };
    try {
      await onSave(updated);
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  };

  return (
    <>
      <section className="card">
        <Row label="Distance" value={km(trip.distanceM)} />
        <Row label="Duration" value={minutes(trip.durationS)} />
        <Row label="Moving / slow" value={`${minutes(trip.movingTimeS)} / ${minutes(trip.slowTimeS)}`} />
        <div className="big-label">Estimated</div>
        <div className="big num">≈ {tnd(trip.estimate.best)}</div>
        <Row label="Expected range" value={range(trip.estimate.low, trip.estimate.high)} />
      </section>

      <Warnings items={trip.warnings} />

      <section className="card">
        <label className="field" htmlFor="meter">Driver's meter</label>
        <div className="meter-input">
          <input
            id="meter"
            inputMode="decimal"
            placeholder="15.000"
            value={meterText}
            onChange={(e) => {
              setMeterText(e.target.value);
              setSaveState('idle');
            }}
          />
          <span>TND</span>
        </div>
        {meterText && meter === null && <p className="error">Enter an amount like 15.000</p>}
        {cmp && (
          <div className={`status status-${cmp.status}`} role="status">
            <div className="num diff">
              {formatSignedTnd(cmp.diff)} TND ({cmp.diffPct > 0 ? '+' : ''}{cmp.diffPct.toFixed(1)}%)
            </div>
            <strong>{cmp.label}</strong>
            {cmp.notes.map((n) => (
              <p key={n}>{n}</p>
            ))}
          </div>
        )}
        <button type="button" className="btn" onClick={save}>
          {saveState === 'saved' ? 'Saved ✓' : isSaved ? 'Update trip' : 'Save to history'}
        </button>
        {saveState === 'error' && <p className="error">Could not save on this device.</p>}
      </section>

      <details className="card">
        <summary>Breakdown</summary>
        <Row label="Initial charge" value={tnd(b.initialFare)} />
        <Row label="Distance" value={tnd(b.distanceCharge)} />
        <Row label="Waiting / slow" value={tnd(b.waitingCharge)} />
        {b.nightSurcharge > 0 && <Row label="…of which night surcharge" value={tnd(b.nightSurcharge)} />}
        {b.airportSupplement > 0 && <Row label="Airport supplement" value={tnd(b.airportSupplement)} />}
        {b.luggageSupplement > 0 && <Row label="Luggage" value={tnd(b.luggageSupplement)} />}
        <Row label="Estimated total" value={<strong>{tnd(b.total)}</strong>} />
        <Row label="Confidence" value={`${Math.round(trip.confidence * 100)}%`} />
        <Row label="Tariff" value={tariff?.name ?? trip.tariffId} />
      </details>

      <div className="actions">
        <button type="button" className="btn secondary" onClick={() => downloadFile(`trip-${trip.id}.json`, JSON.stringify(trip, null, 2), 'application/json')}>
          Export JSON
        </button>
        <button type="button" className="btn secondary" onClick={() => downloadFile(`trip-${trip.id}.csv`, tripsToCsv([trip]), 'text/csv')}>
          Export CSV
        </button>
      </div>
      <Disclaimer />
    </>
  );
}
