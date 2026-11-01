import { useMessages } from '../localization';
import { getActiveTariff } from '../config/tariffs';
import { crossoverSpeedMps, switchingSpeedMps } from '../domain/fare/tariff';
import { Disclaimer, Header, Row, TariffDetails, tnd } from '../components/ui';

export function AboutPage({ onBack }: { onBack: () => void }) {
  const en = useMessages();
  const t = getActiveTariff();
  const sw = switchingSpeedMps(t);
  return (
    <main>
      <Header title={en.about.aboutTariff} onBack={onBack} />
      <TariffDetails tariffId={t.id} />
      <section className="card">
        <Row label={en.about.tariff} value={t.name} />
        <Row label={en.about.initialCharge} value={tnd(t.initialFare)} />
        <Row label={en.about.distance} value={en.about.distanceRate(tnd(t.distanceStepFare), t.distanceStepMeters)} />
        <Row label={en.about.waitingSlow} value={en.about.waitingRate(tnd(t.waitingStepFare), t.waitingStepSeconds)} />
        <Row label={en.about.night} value={en.about.nightWindow(t.nightMultiplier, t.nightStart, t.nightEnd)} />
        <Row label={en.about.airportDeparture} value={tnd(t.airportSupplement)} />
        <Row label={en.about.largeLuggage} value={en.about.luggageRate(tnd(t.luggageSupplement))} />
        <Row
          label={en.about.switchingSpeed}
          value={sw.verified ? en.about.speed((sw.mps * 3.6).toFixed(1)) : en.about.unverifiedSpeed((crossoverSpeedMps(t) * 3.6).toFixed(1))}
        />
      </section>
      <section className="card">
        <h2>{en.about.howTheEstimateWorks}</h2>
        <p>
          {en.about.thePhoneRecordsGPSPositionsNoisy}</p>
        <p>{en.about.nightExplanation(t.nightStart, t.nightEnd)}</p>
        <h2>{en.about.unverifiedModellingAssumptions}</h2>
        <p>{en.about.distanceOrWaitingTimeIsCharged}</p>
        <p>{en.about.initialNightExplanation(t.nightAppliesToInitialFare)}</p>
        <p>{en.about.dayNightDistanceAndWaitingSteps}</p>
      </section>
      <details className="card">
        <summary>{en.privacy.title}</summary>
        <p>{en.privacy.platformServices}</p>
        <p>{en.privacy.activeData}</p>
        <p>{en.privacy.historyRetention(en.history.delete)}</p>
        <p>{en.privacy.exportCache}</p>
        <p>{en.privacy.recipientCopies}</p>
      </details>
      <Disclaimer />
    </main>
  );
}
