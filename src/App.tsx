import { useMessages } from './localization';
import { presentMessage } from './localization/messages';
import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { App as NativeApp } from '@capacitor/app';
import { ACTIVE_TARIFF_ID, getActiveTariff } from './config/tariffs';
import { resolveTariff, type TariffStatus } from './config/tariffs/status';
import { loadActiveRide } from './storage/activeRide';
import { TariffErrorPage } from './pages/TariffErrorPage';
import type { Supplements } from './domain/fare/types';
import type { TripRecord } from './domain/trip/types';
import { useLiveRide } from './hooks/useLiveRide';
import { AboutPage } from './pages/AboutPage';
import { HistoryPage } from './pages/HistoryPage';
import { LivePage } from './pages/LivePage';
import { RideRecoveryPage, CleanupFeedback } from './pages/RideRecoveryPage';
import { NativeRecoveryPage } from './pages/NativeRecoveryPage';
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
  const stored = loadActiveRide();
  const active = resolveTariff(ACTIVE_TARIFF_ID);
  const failures: Exclude<TariffStatus, { status: 'valid' }>[] = active.status === 'valid' ? [] : [active];
  const recordedId = stored.status === 'valid' ? stored.ride.tariffId : undefined;
  if (typeof recordedId === 'string' && recordedId !== ACTIVE_TARIFF_ID) {
    const recorded = resolveTariff(recordedId);
    if (recorded.status === 'invalid') failures.push(recorded);
  }
  return failures.length ? <TariffErrorPage failures={failures} /> : <RideApp initialRead={stored} />;
}

function RideApp({ initialRead }: { initialRead: ReturnType<typeof loadActiveRide> }) {
  const en = useMessages();
  const live = useLiveRide(initialRead);
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [supp, setSupp] = useState<Supplements>({ airportDeparture: false, luggageItems: 0 });
  const [autoSave, setAutoSave] = useState<{ tripId: string; status: 'pending' | 'saved' | 'error' } | null>(null);
  const [showRecovery, setShowRecovery] = useState(true);
  const [endedResult, setEndedResult] = useState<{ trip: TripRecord; meterText?: string } | null>(null);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const listener = NativeApp.addListener('backButton', () => {
      if ((live.ride && !live.nativeRestartBlocked) || screen.name === 'home') { void NativeApp.minimizeApp(); return; }
      setScreen(screen.name === 'result' && screen.from === 'history' ? { name: 'history' } : { name: 'home' });
    });
    return () => { void listener.then((handle) => handle.remove()); };
  }, [screen, live.ride !== null, live.nativeRestartBlocked]);

  const showResult = async (trip: TripRecord, autoSave: boolean) => {
    setScreen({ name: 'result', trip, isSaved: false, from: 'home' });
    setAutoSave(autoSave ? { tripId: trip.id, status: 'pending' } : null);
    if (autoSave) {
      try {
        await tripStore.save(trip);
        setAutoSave(current => current?.tripId === trip.id ? { tripId: trip.id, status: 'saved' } : current);
      } catch {
        setAutoSave(current => current?.tripId === trip.id ? { tripId: trip.id, status: 'error' } : current);
      }
    }
  };

  if (live.ride && !live.nativeRestartBlocked) {
    return (
      <LivePage
        live={live}
        onEnd={(t) => {
          setSupp({ airportDeparture: false, luggageItems: 0 });
          setEndedResult({ trip: t });
          setShowRecovery(false);
          void showResult(t, true);
        }}
        onCancel={() => { live.cancel(); setShowRecovery(true); }}
      />
    );
  }

  if (live.recovery && showRecovery) {
    return <RideRecoveryPage recovery={live.recovery} nativeRestartBlocked={live.nativeRestartBlocked}
      cleanup={live.cleanup} onRetryCleanup={() => { live.retryCleanup(); }}
      storageError={live.recoveryStorageError}
      guardError={live.nativeRecoveryError}
      onHome={() => { setShowRecovery(false); setScreen({ name: 'home' }); }}
      onDiscard={() => {
        if (!live.discardRecovery()) return;
        setShowRecovery(live.nativeRestartBlocked);
        setScreen({ name: 'home' });
        if (!live.nativeRestartBlocked) live.start(supp);
      }} />;
  }

  if (live.nativeRestartBlocked && !live.recovery && showRecovery) {
    return <NativeRecoveryPage error={live.nativeRecoveryError}
      onHome={() => { setShowRecovery(false); setScreen({ name: 'home' }); }}
      onAcknowledge={() => { if (live.acknowledgeNativeRecovery()) { setShowRecovery(false); setScreen({ name: 'home' }); } }} />;
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
          <Header title={en.app.tripComplete} focusKey={`${screen.trip.id}:${live.cleanup ? 'cleanup' : 'ready'}`} onBack={() => setScreen(screen.from === 'history' ? { name: 'history' } : { name: 'home' })} />
          {live.cleanup && <>
            <CleanupFeedback cleanup={live.cleanup} onRetry={() => { live.retryCleanup(); }} />
            {endedResult?.trip.id === screen.trip.id && <p className="notice">{en.cleanup.resultSeparate}</p>}
          </>}
          {autoSave?.tripId === screen.trip.id && autoSave.status === 'error' && <p className="error" role="alert">{en.app.thisTripCouldNotBeSaved}</p>}
          <TripResult key={screen.trip.id} trip={screen.trip}
            initialMeterText={endedResult?.trip.id === screen.trip.id ? endedResult.meterText : undefined}
            onMeterDraft={text => setEndedResult(current => current?.trip.id === screen.trip.id ? { ...current, meterText: text } : current)}
            isSaved={screen.isSaved || (autoSave?.tripId === screen.trip.id && autoSave.status === 'saved')}
            autoSavePending={autoSave?.tripId === screen.trip.id && autoSave.status === 'pending'}
            onSave={async t => {
              await tripStore.save(t);
              setEndedResult(current => current?.trip.id === t.id ? { ...current, trip: t } : current);
              setAutoSave(current => current?.tripId === t.id ? { tripId: t.id, status: 'saved' } : current);
            }} />
        </main>
      );
    default:
      return <Home supp={supp} setSupp={setSupp} hasRecovery={live.recovery !== null} storageRecovery={live.recovery?.kind === 'storage'} restartBlocked={live.nativeRestartBlocked}
        onRecovery={() => setShowRecovery(true)} guardError={live.nativeRecoveryError}
        onEndedResult={endedResult ? () => { setShowRecovery(false); setScreen({ name: 'result', trip: endedResult.trip, isSaved: false, from: 'home' }); } : undefined}
        onStart={() => { if (live.recovery) setShowRecovery(true); else live.start(supp); }} go={setScreen} />;
  }
}

function Home({ supp, setSupp, onStart, go, hasRecovery, storageRecovery, restartBlocked, onRecovery, guardError, onEndedResult }: {
  supp: Supplements;
  setSupp: (s: Supplements) => void;
  onStart: () => void;
  go: (s: Screen) => void;
  hasRecovery: boolean;
  storageRecovery: boolean;
  restartBlocked: boolean;
  onRecovery: () => void;
  guardError: string | null;
  onEndedResult?: () => void;
}) {
  const en = useMessages();
  const tariff = getActiveTariff();
  return (
    <main>
      <Header title={en.app.brand} />
      <p>{en.app.independentFareEstimatesForIndividualTaxis}</p>
      <p className="notice">{en.shared.tariffNotice(tariff.notice)}</p>
      {hasRecovery && <p className="notice">{storageRecovery ? en.activeStorage.blocked : en.app.anUnfinishedRideNeedsRecoveryIts}</p>}
      {restartBlocked && <p className="notice" role="status">{en.app.androidServiceShutdownIsUnconfirmedForce}</p>}
      {guardError && <p className="error" role="alert">{presentMessage(guardError)}</p>}
      {restartBlocked && !hasRecovery && <button type="button" className="btn secondary" onClick={onRecovery}>{en.app.reviewAndroidRecovery}</button>}
      <p className="small">{en.app.locationPermissionIsRequestedWhenYou}</p>
      <p className="small">{en.privacy.endLive(en.live.endRide)}</p>
      <p className="small">{en.privacy.manualAlternative}</p>
      <button type="button" className="btn primary huge" onClick={onStart} disabled={restartBlocked && !hasRecovery}>
        {hasRecovery ? storageRecovery ? en.activeStorage.review : en.app.reviewRecoveredRide : en.app.startRide}
      </button>
      {onEndedResult && <button type="button" className="btn secondary" onClick={onEndedResult}>{en.cleanup.viewResult}</button>}
      <button type="button" className="btn secondary" onClick={() => go({ name: 'manual' })}>{en.app.manualCalculator}</button>
      <SupplementsInput value={supp} onChange={setSupp} />
      <nav className="menu">
        <button type="button" className="btn secondary" onClick={() => go({ name: 'history' })}>{en.app.tripHistory}</button>
        <button type="button" className="btn secondary" onClick={() => go({ name: 'about' })}>{en.app.aboutTariff}</button>
      </nav>
    </main>
  );
}
