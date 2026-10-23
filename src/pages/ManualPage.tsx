import { useState } from 'react';
import { getActiveTariff } from '../config/tariffs';
import { estimateFare } from '../domain/fare/calculator';
import type { Supplements } from '../domain/fare/types';
import { buildRecord } from '../domain/trip/buildRecord';
import { manualTripInput, validateManual } from '../domain/trip/tripInput';
import type { TripRecord } from '../domain/trip/types';
import { Header, SupplementsInput } from '../components/ui';

type Props = { onBack: () => void; onResult: (t: TripRecord) => void };

function localNowInput(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function ManualPage({ onBack, onResult }: Props) {
  const [distance, setDistance] = useState('');
  const [duration, setDuration] = useState('');
  const [stopped, setStopped] = useState('');
  const [start, setStart] = useState(localNowInput);
  const [supp, setSupp] = useState<Supplements>({ airportDeparture: false, luggageItems: 0 });
  const [errors, setErrors] = useState<string[]>([]);

  const num = (s: string) => Number(s.replace(',', '.'));

  const submit = () => {
    const data = {
      distanceKm: num(distance),
      durationMin: num(duration),
      // datetime-local is parsed in the device time zone.
      startMs: new Date(start).getTime(),
      stoppedMin: stopped.trim() === '' ? null : num(stopped),
      supplements: supp,
    };
    const errs = [
      ...(distance.trim() === '' ? ['Distance is required.'] : []),
      ...(duration.trim() === '' ? ['Duration is required.'] : []),
      ...validateManual(data),
    ];
    setErrors(errs);
    if (errs.length) return;
    const input = manualTripInput(data);
    const estimate = estimateFare(input, getActiveTariff());
    onResult(buildRecord({ mode: 'manual', startMs: input.startMs, endMs: input.endMs, distanceM: data.distanceKm * 1000, estimate, supplements: supp }));
  };

  return (
    <main>
      <Header title="Manual calculator" onBack={onBack} />
      <section className="card">
        <label className="field">
          Distance (km)
          <input inputMode="decimal" value={distance} onChange={(e) => setDistance(e.target.value)} placeholder="20" />
        </label>
        <label className="field">
          Total duration (min)
          <input inputMode="decimal" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="48" />
        </label>
        <label className="field">
          Start date and time
          <input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="field">
          Stopped / very slow time (min), optional
          <input inputMode="decimal" value={stopped} onChange={(e) => setStopped(e.target.value)} placeholder="unknown" />
        </label>
      </section>
      <SupplementsInput value={supp} onChange={setSupp} />
      {errors.length > 0 && (
        <ul className="errors">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <button type="button" className="btn primary huge" onClick={submit}>
        Calculate
      </button>
      <p className="muted small">Leave stopped time empty if you don't know it: the result will be a range, not an exact fare.</p>
    </main>
  );
}
