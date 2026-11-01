import { useMessages } from '../localization';
import { presentMessage } from '../localization/messages';
import { useEffect, useRef, useState } from 'react';
import { getActiveTariff } from '../config/tariffs';
import { estimateFare } from '../domain/fare/calculator';
import type { Supplements } from '../domain/fare/types';
import { buildRecord } from '../domain/trip/buildRecord';
import { manualTripInput, validateManual } from '../domain/trip/tripInput';
import type { TripRecord } from '../domain/trip/types';
import { Header, SupplementsInput } from '../components/ui';
import { parseTariffDateTime, tariffDateTimeInput } from '../utils/tariffTime';

type Props = { onBack: () => void; onResult: (t: TripRecord) => void };

const ERROR_FIELDS: Record<string, string[]> = {
  'Distance is required.': ['distance'],
  'Distance must be between 0 and 500 km.': ['distance'],
  'Duration is required.': ['duration'],
  'Duration must be between 1 and 600 minutes.': ['duration'],
  'Stopped time must be between 0 and the total duration.': ['stopped', 'duration'],
  'A trip with distance must include some moving time.': ['stopped', 'duration', 'distance'],
  'Start date/time is invalid.': ['start'],
  'Luggage items must be a whole number from 0 to 10.': ['supplements'],
};

function localNowInput(): string {
  return tariffDateTimeInput(Date.now(), getActiveTariff().utcOffsetMinutes);
}

export function ManualPage({ onBack, onResult }: Props) {
  const en = useMessages();
  const [distance, setDistance] = useState('');
  const [duration, setDuration] = useState('');
  const [stopped, setStopped] = useState('');
  const [start, setStart] = useState(localNowInput);
  const [supp, setSupp] = useState<Supplements>({ airportDeparture: false, luggageItems: 0 });
  const [errors, setErrors] = useState<string[]>([]);
  const [failedSubmissions, setFailedSubmissions] = useState(0);
  const summary = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (failedSubmissions > 0) summary.current?.focus();
  }, [failedSubmissions]);
  const fieldErrors = (field: string) => errors.filter((error) => ERROR_FIELDS[error]?.includes(field));
  const errorProps = (field: string) => ({
    id: `manual-${field}`,
    'aria-invalid': fieldErrors(field).length > 0 || undefined,
    'aria-describedby': fieldErrors(field).length ? `manual-${field}-error` : undefined,
  });
  const fieldError = (field: string) => fieldErrors(field).length > 0 &&
    <p id={`manual-${field}-error`} className="error">{fieldErrors(field).map(presentMessage).join(' ')}</p>;

  const num = (s: string) => Number(s.replace(',', '.'));

  const submit = () => {
    const data = {
      distanceKm: num(distance),
      durationMin: num(duration),
      startMs: parseTariffDateTime(start, getActiveTariff().utcOffsetMinutes),
      stoppedMin: stopped.trim() === '' ? null : num(stopped),
      supplements: supp,
    };
    const errs = [
      ...(distance.trim() === '' ? ['Distance is required.'] : []),
      ...(duration.trim() === '' ? ['Duration is required.'] : []),
      ...validateManual(data),
    ];
    setErrors(errs);
    if (errs.length) { setFailedSubmissions((count) => count + 1); return; }
    const input = manualTripInput(data);
    const estimate = estimateFare(input, getActiveTariff());
    onResult(buildRecord({ mode: 'manual', startMs: input.startMs, endMs: input.endMs, distanceM: data.distanceKm * 1000, estimate, supplements: supp }));
  };

  return (
    <main>
      <Header title={en.manual.manualCalculator} onBack={onBack} />
      {errors.length > 0 && (
        <div className="errors" tabIndex={-1} ref={summary} aria-labelledby="manual-errors-title">
          <h2 id="manual-errors-title">{en.manual.checkYourEntries}</h2>
          <ul>
            {errors.map((error) => (
              <li key={error}>{ERROR_FIELDS[error]?.length ?
                <a href={`#manual-${ERROR_FIELDS[error][0]}`} onClick={(event) => {
                  event.preventDefault();
                  document.getElementById(`manual-${ERROR_FIELDS[error][0]}`)?.focus();
                }}>{presentMessage(error)}</a> : presentMessage(error)}</li>
            ))}
          </ul>
        </div>
      )}
      <section className="card">
        <label className="field" htmlFor="manual-distance">
          {en.manual.distanceKm}</label>
        <input {...errorProps('distance')} inputMode="decimal" value={distance} onChange={(e) => setDistance(e.target.value)} placeholder={en.manual.distanceExample} />
        {fieldError('distance')}
        <label className="field" htmlFor="manual-duration">
          {en.manual.totalDurationMin}</label>
        <input {...errorProps('duration')} inputMode="decimal" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder={en.manual.durationExample} />
        {fieldError('duration')}
        <label className="field" htmlFor="manual-start">
          {en.manual.startDateAndTimeTunisia}</label>
        <input {...errorProps('start')} type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
        {fieldError('start')}
        <label className="field" htmlFor="manual-stopped">
          {en.manual.stoppedVerySlowTimeMinOptional}</label>
        <input {...errorProps('stopped')} inputMode="decimal" value={stopped} onChange={(e) => setStopped(e.target.value)} placeholder={en.manual.unknown} />
        {fieldError('stopped')}
      </section>
      <div id="manual-supplements" tabIndex={-1} aria-describedby={fieldErrors('supplements').length ? 'manual-supplements-error' : undefined}>
        <SupplementsInput value={supp} onChange={setSupp} />
        {fieldError('supplements')}
      </div>
      <button type="button" className="btn primary huge" onClick={submit}>
        {en.manual.calculate}</button>
      <p className="muted small">{en.manual.leaveStoppedTimeEmptyIfYou}</p>
    </main>
  );
}
