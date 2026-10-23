import { useState } from 'react';
import { getActiveTariff } from './config/tariffs';
import type { Supplements } from './domain/fare/types';
import type { TripRecord } from './domain/trip/types';
import { useLiveRide } from './hooks/useLiveRide';
import { AboutPage } from './pages/AboutPage';
import { HistoryPage } from './pages/HistoryPage';
import { LivePage } from './pages/LivePage';
import { ManualPage } from './pages/ManualPage';
import { tripStore } from './storage/tripStore';
import { Header, SupplementsInput } from './components/ui';
import { TripResult } from './components/TripResult';

type Screen =
  | { name: 'home' }
  | { name: 'manual' }
  | { name: 'history' }
  | { name: 'about' }
  | { name: 'result'; trip: TripRecord; isSaved: boolean; from: 'home' | 'history' };

export function App() {
  const live = useLiveRide();
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [supp, setSupp] = useState<Supplements>({ airportDeparture: false, luggageItems: 0 });
  const [saveError, setSaveError] = useState<string | null>(null);

  const showResult = async (trip: TripRecord, autoSave: boolean) => {
    let isSaved = false;
    if (autoSave) {
      try {
        await tripStore.save(trip);
        isSaved = true;
      } catch {
        setSaveError('This trip could not be saved automatically. Use "Save to history".');
      }
    }
    setScreen({ name: 'result', trip, isSaved, from: 'home' });
  };

  if (live.ride) {
    return (
      <LivePage
        live={live}
        onEnd={(t) => {
          setSupp({ airportDeparture: false, luggageItems: 0 });
          void showResult(t, true);
        }}
        onCancel={live.cancel}
      />
    );
  }

  const home = () => setScreen({ name: 'home' });
  switch (screen.name) {
    case 'manual':
      return <ManualPage onBack={home} onResult={(t) => setScreen({ name: 'result', trip: t, isSaved: false, from: 'home' })} />;
    case 'history':
      return <HistoryPage onBack={home} onOpen={(t) => setScreen({ name: 'result', trip: t, isSaved: true, from: 'history' })} />;
    case 'about':
      return <AboutPage onBack={home} />;
    case 'result':
      return (
        <main>
          <Header title="Trip complete" onBack={() => setScreen(screen.from === 'history' ? { name: 'history' } : { name: 'home' })} />
          {saveError && <p className="error">{saveError}</p>}
          <TripResult key={screen.trip.id} trip={screen.trip} isSaved={screen.isSaved} onSave={(t) => tripStore.save(t)} />
        </main>
      );
    default:
      return <Home supp={supp} setSupp={setSupp} onStart={() => live.start(supp)} go={setScreen} />;
  }
}

function Home({ supp, setSupp, onStart, go }: {
  supp: Supplements;
  setSupp: (s: Supplements) => void;
  onStart: () => void;
  go: (s: Screen) => void;
}) {
  const tariff = getActiveTariff();
  return (
    <main>
      <Header title="TAXI CHECK" />
      <p className="ready">Ready</p>
      <button type="button" className="btn primary huge" onClick={onStart}>
        START RIDE
      </button>
      <p className="muted small center">Location permission is requested when you start a ride.</p>
      <SupplementsInput value={supp} onChange={setSupp} />
      <nav className="menu">
        <button type="button" className="btn secondary" onClick={() => go({ name: 'manual' })}>Manual calculator</button>
        <button type="button" className="btn secondary" onClick={() => go({ name: 'history' })}>Trip history</button>
        <button type="button" className="btn secondary" onClick={() => go({ name: 'about' })}>About tariff</button>
      </nav>
      {tariff.notice && <p className="notice small">{tariff.notice}</p>}
    </main>
  );
}
