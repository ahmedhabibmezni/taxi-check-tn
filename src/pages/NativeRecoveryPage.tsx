import { useMessages } from '../localization';
import { presentMessage } from '../localization/messages';
import { Header } from '../components/ui';

export function NativeRecoveryPage({ error, onAcknowledge, onHome }: {
  error: string | null; onAcknowledge: () => void; onHome: () => void;
}) {
  const en = useMessages();
  return <main>
    <Header title={en.nativeRecovery.androidRecoveryPending} />
    <p className="notice" role="status">{en.nativeRecovery.recordingIsBlockedAPreviousAndroid}</p>
    <section className="card">
      <p>{en.nativeRecovery.toStopThePreviousService}</p>
      <ol>
        <li>{en.nativeRecovery.openAndroidSettingsAppsTaxiCheck}</li>
        <li>{en.nativeRecovery.selectForceStopAndConfirmDo}</li>
        <li>{en.nativeRecovery.reopenTaxiCheckThenConfirmBelow}</li>
      </ol>
      <p>{en.nativeRecovery.thisAppCannotVerifyThatAndroid}</p>
    </section>
    {error && <p className="error" role="alert">{presentMessage(error)}</p>}
    <button type="button" className="btn primary" onClick={onAcknowledge}>{en.nativeRecovery.iForceStoppedAndReopenedThe}</button>
    <button type="button" className="btn secondary" onClick={onHome}>{en.nativeRecovery.goToHomeKeepRecoveryPending}</button>
    <p className="muted">{en.nativeRecovery.manualHistoryAndAboutRemainAvailable}</p>
  </main>;
}
