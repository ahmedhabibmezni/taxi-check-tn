import { useMessages } from '../localization';
import { presentConfigurationError } from '../localization/messages';
import { useState } from 'react';
import { Header } from '../components/ui';
import { TripResult } from '../components/TripResult';
import type { TariffStatus } from '../config/tariffs/status';
import type { TripRecord } from '../domain/trip/types';
import { tripStore } from '../storage/tripStore';
import { HistoryPage } from './HistoryPage';

export function TariffErrorPage({ failures }: { failures: Exclude<TariffStatus, { status: 'valid' }>[] }) {
  const en = useMessages();
  const [history, setHistory] = useState(false);
  const [trip, setTrip] = useState<TripRecord | null>(null);
  if (trip) return <main>
    <Header title={en.tariffError.tripComplete} focusKey={trip.id} onBack={() => setTrip(null)} />
    <TripResult key={trip.id} trip={trip} isSaved={true} onSave={t => tripStore.save(t)} />
  </main>;
  if (history) return <HistoryPage estimatesUnavailable onBack={() => setHistory(false)} onOpen={setTrip} />;
  return <main>
    <Header title={en.tariffError.tariffConfigurationError} />
    <div className="error" role="alert">
      <p>{en.tariffError.theAppCannotUseTheConfigured}</p>
      {failures.map(failure => <section key={failure.id}>
        <p><strong>{en.tariffError.tariffID}</strong> <bdi dir="ltr">{failure.id}</bdi></p>
        {failure.status === 'missing' ? <p>{en.tariffError.activeTariffDefinitionIsUnavailable}</p> :
          <ul>{failure.errors.map(error => <li key={error}>{presentConfigurationError(error)}</li>)}</ul>}
      </section>)}
    </div>
    <p>{en.tariffError.thisIsAConfigurationProblemSeparate}</p>
    <p>{en.tariffError.savedTripsCanStillBeViewed}</p>
    <p className="notice">{en.tariffError.existingActiveRideDataAndRecovery}</p>
    <button type="button" className="btn secondary" onClick={() => setHistory(true)}>{en.tariffError.tripHistory}</button>
  </main>;
}
