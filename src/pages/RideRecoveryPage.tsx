import { useMessages } from '../localization';
import { presentMessage } from '../localization/messages';
import { useEffect, useRef, useState } from 'react';
import type { ActiveRideRecovery } from '../storage/activeRide';
import { Header, Row } from '../components/ui';
import type { RideCleanup } from '../hooks/useLiveRide';

export function CleanupFeedback({ cleanup, onRetry }: { cleanup: RideCleanup; onRetry: () => void }) {
  const en = useMessages();
  return <section className="card">
    <p role="alert" className="error">{en.cleanup[cleanup.storage]}</p>
    {!cleanup.guardReady && <p className="error">{en.cleanup.guardUnverified}</p>}
    <p>{en.cleanup.stopRequested}</p>
    <p>{en.cleanup.explanation}</p>
    <button type="button" className="btn secondary" onClick={onRetry}>{en.cleanup.retry}</button>
  </section>;
}

type Props = {
  recovery: ActiveRideRecovery;
  nativeRestartBlocked: boolean;
  storageError: boolean;
  guardError: string | null;
  onDiscard: () => void;
  onHome: () => void;
  cleanup?: RideCleanup | null;
  onRetryCleanup?: () => void;
};

export function RideRecoveryPage({ recovery, nativeRestartBlocked, storageError, guardError, onDiscard, onHome, cleanup, onRetryCleanup }: Props) {
  const en = useMessages();
  const [confirming, setConfirming] = useState(false);
  const confirmation = useRef<HTMLHeadingElement>(null);
  const discard = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  useEffect(() => {
    if (confirming) confirmation.current?.focus();
    else if (wasConfirming.current) discard.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);
  const stored = recovery.kind === 'tariff' ? recovery.ride : null;
  const identity = stored?.tariffId === undefined ? en.rideRecovery.notRecordedLegacyRide
    : typeof stored.tariffId !== 'string' || !stored.tariffId.trim() ? en.rideRecovery.malformedTariffID
    : stored.tariffId;
  const unavailable = recovery.kind === 'storage' && recovery.reason === 'unavailable';
  if (cleanup && onRetryCleanup) return <main>
    <Header title={en.cleanup.title} />
    <CleanupFeedback cleanup={cleanup} onRetry={onRetryCleanup} />
    <button type="button" className="btn secondary" onClick={onHome}>{en.cleanup.home}</button>
  </main>;
  return (
    <main>
      <Header title={stored ? en.rideRecovery.rideNeedsRecovery : en.activeStorage.title} />
      <p className="notice" role="status">{stored ? en.rideRecovery.theOriginalTariffCannotBeResolved
        : unavailable ? en.activeStorage.unavailable
        : recovery.kind === 'storage' && recovery.reason === 'present' ? en.activeStorage.present : en.activeStorage.invalid}</p>
      <section className="card">
        {stored && <Row label={en.rideRecovery.recordedTariffID} value={identity} />}
        <p>{stored ? en.rideRecovery.retainedData(storageError) : en.activeStorage.blocked}</p>
        <p>{en.rideRecovery.goToHomeToUseManual}</p>
        {unavailable && <p>{en.activeStorage.reopen}</p>}
      </section>
      {nativeRestartBlocked && <p className="notice">{en.rideRecovery.aPreviousAndroidLocationServiceMay}</p>}
      {guardError && <p role="alert" className="error">{presentMessage(guardError)}</p>}
      {storageError && <p role="alert" className="error">{stored ? en.rideRecovery.removalOfTheRecoveredRideCould : en.activeStorage.removalFailed}</p>}
      {!unavailable && (confirming ? <section className="card" aria-labelledby="discard-recovery-title">
        <h2 id="discard-recovery-title" ref={confirmation} tabIndex={-1}>{stored ? en.rideRecovery.discardTheRecoveredRide : en.activeStorage.discardTitle}</h2>
        <p>{stored ? en.rideRecovery.thisPermanentlyRemovesThisUnfinishedRide : en.activeStorage.discardExplanation}</p>
        {nativeRestartBlocked && <p>{en.rideRecovery.youMustForceStopAndReopen}</p>}
        <button type="button" className="btn danger" onClick={onDiscard}>{nativeRestartBlocked ? en.rideRecovery.confirmDiscard : en.rideRecovery.confirmDiscardAndStartAgain}</button>
        <button type="button" className="btn secondary" onClick={() => setConfirming(false)}>{en.rideRecovery.keepRecoveredRide}</button>
      </section> : <button type="button" className="btn danger" ref={discard} onClick={() => setConfirming(true)}>{stored
        ? nativeRestartBlocked ? en.rideRecovery.discardRecoveredRide : en.rideRecovery.discardAndStartAgain
        : nativeRestartBlocked ? en.activeStorage.discard : en.activeStorage.discardAndStart}</button>)}
      <button type="button" className="btn secondary" onClick={onHome}>{en.rideRecovery.goToHomeKeepRecoveredRide}</button>
    </main>
  );
}
