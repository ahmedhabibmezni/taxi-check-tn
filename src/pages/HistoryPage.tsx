import { useEffect, useState } from 'react';
import type { TripRecord } from '../domain/trip/types';
import { tripStore } from '../storage/tripStore';
import { downloadFile, tripsToCsv } from '../utils/export';
import { formatTnd } from '../utils/money';
import { Header, km, minutes } from '../components/ui';

type Props = { onBack: () => void; onOpen: (t: TripRecord) => void };

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

export function HistoryPage({ onBack, onOpen }: Props) {
  const [trips, setTrips] = useState<TripRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    tripStore.list().then(setTrips, () => setError('Could not read the trip history on this device.'));
  useEffect(() => {
    void load();
  }, []);

  const remove = async (t: TripRecord) => {
    if (!confirm('Delete this trip?')) return;
    try {
      await tripStore.remove(t.id);
      await load();
    } catch {
      setError('Could not delete the trip.');
    }
  };

  return (
    <main>
      <Header title="Trip history" onBack={onBack} />
      {error && <p className="error">{error}</p>}
      {trips === null && !error && <p className="muted">Loading…</p>}
      {trips?.length === 0 && <p className="muted">No saved trips yet.</p>}
      {trips?.map((t) => (
        <article key={t.id} className="card trip">
          <button type="button" className="trip-open" onClick={() => onOpen(t)}>
            <strong>{dateFmt.format(t.startMs)}</strong> <span className="muted">{timeFmt.format(t.startMs)} · {t.mode}</span>
            <div>{km(t.distanceM)} • {minutes(t.durationS)}</div>
            <div>Estimated: {formatTnd(t.estimate.best, 1)} TND</div>
            {t.meter !== null && (
              <div>
                Meter: {formatTnd(t.meter, 1)} TND · Difference: {t.diffPct! > 0 ? '+' : ''}{t.diffPct!.toFixed(1)}%
              </div>
            )}
          </button>
          <button type="button" className="btn link danger" onClick={() => remove(t)}>Delete</button>
        </article>
      ))}
      {trips && trips.length > 0 && (
        <button type="button" className="btn secondary" onClick={() => downloadFile('taxi-trips.csv', tripsToCsv(trips), 'text/csv')}>
          Export all as CSV
        </button>
      )}
    </main>
  );
}
