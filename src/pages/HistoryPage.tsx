import { useMessages } from '../localization';
import { en as english } from '../localization/en';
import { presentMessage } from '../localization/messages';
import { useEffect, useState } from 'react';
import type { TripRecord } from '../domain/trip/types';
import { tripStore } from '../storage/tripStore';
import { readCompletedHistory } from '../storage/completedTrip';
import { TripExport } from '../components/TripExport';
import { formatTnd } from '../utils/money';
import { Header, km, minutes } from '../components/ui';

type Props = { onBack: () => void; onOpen: (t: TripRecord) => void; estimatesUnavailable?: boolean };

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

export function HistoryPage({ onBack, onOpen, estimatesUnavailable = false }: Props) {
  const en = useMessages();
  const [trips, setTrips] = useState<TripRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [unreadable, setUnreadable] = useState(0);

  const load = () => {
    setLoading(true);
    setError(null);
    setTrips(null);
    setUnreadable(0);
    return tripStore.list().then(values => {
      const read = readCompletedHistory(values);
      setTrips(read.trips);
      setUnreadable(read.unreadable);
    }).catch(() => setError(english.history.couldNotReadTheTripHistory)).finally(() => setLoading(false));
  };
  useEffect(() => {
    void load();
  }, []);

  const remove = async (t: TripRecord) => {
    if (!confirm(en.history.deleteThisTrip)) return;
    try {
      await tripStore.remove(t.id);
      await load();
    } catch {
      setError(english.history.couldNotDeleteTheTrip);
    }
  };

  return (
    <main>
      <Header title={en.history.tripHistory} onBack={onBack} />
      <p className="small">{en.privacy.historyRetention(en.history.delete)}</p>
      <details className="small">
        <summary>{en.privacy.deletionLimits}</summary>
        <p>{en.privacy.recipientCopies}</p>
      </details>
      {error && <div>
        <p className="error" role="alert">{presentMessage(error)}</p>
        <button type="button" className="btn secondary" onClick={() => { void load(); }}>{en.history.retryHistory}</button>
      </div>}
      <p role="status" aria-atomic="true" className="muted">
        {loading ? en.history.loadingTripHistory : !error && trips?.length === 0 && unreadable === 0 ? estimatesUnavailable
          ? en.history.noSavedTripsOnThisDevice
          : en.history.noSavedTripsYetReturnTo : ''}
      </p>
      {unreadable > 0 && <p className="notice" role="status" aria-atomic="true">
        {trips?.length ? en.historyRead.partial(unreadable) : en.historyRead.allUnreadable(unreadable)}
      </p>}
      {trips?.map((t) => (
        <article key={t.id} className="card trip">
          <button type="button" className="trip-open" onClick={() => onOpen(t)}>
            <strong><bdi dir="ltr">{dateFmt.format(t.startMs)}</bdi></strong> <span className="muted"><bdi dir="ltr">{timeFmt.format(t.startMs)}</bdi> · {en.history.modes[t.mode] ?? t.mode}</span>
            <div>{km(t.distanceM)} • {minutes(t.durationS)}</div>
            <div>{en.history.estimated(formatTnd(t.estimate.best, 1))}</div>
            {t.meter !== null && (
              <div>
                {t.diffPct === null ? en.historyRead.meterWithoutComparison(formatTnd(t.meter, 1))
                  : en.history.meterComparison(formatTnd(t.meter, 1), `${t.diffPct > 0 ? '+' : ''}${t.diffPct.toFixed(1)}`)}
              </div>
            )}
          </button>
          <button type="button" className="btn link danger" onClick={() => remove(t)}>{en.history.delete}</button>
        </article>
      ))}
      {unreadable > 0 && trips && trips.length > 0 && <p className="notice">{en.historyRead.bulkBlocked(unreadable)}</p>}
      {trips && trips.length > 0 && unreadable === 0 && (
        <TripExport label={en.history.exportAllAsCSV} name="taxi-trips.csv" format="csv" trips={trips} />
      )}
    </main>
  );
}
