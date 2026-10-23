import { getActiveTariff } from '../config/tariffs';
import { crossoverSpeedMps, switchingSpeedMps } from '../domain/fare/tariff';
import { Disclaimer, Header, Row, tnd } from '../components/ui';

export function AboutPage({ onBack }: { onBack: () => void }) {
  const t = getActiveTariff();
  const sw = switchingSpeedMps(t);
  return (
    <main>
      <Header title="About tariff" onBack={onBack} />
      {t.notice && <p className="notice">{t.notice}</p>}
      <section className="card">
        <Row label="Tariff" value={t.name} />
        <Row label="Effective from" value={t.effectiveFrom ?? 'Not confirmed'} />
        <Row label="Last reviewed" value={t.lastReviewed ?? 'Unknown'} />
        <Row label="Initial charge" value={tnd(t.initialFare)} />
        <Row label="Distance" value={`${tnd(t.distanceStepFare)} / ${t.distanceStepMeters} m`} />
        <Row label="Waiting / slow" value={`${tnd(t.waitingStepFare)} / ${t.waitingStepSeconds} s`} />
        <Row label="Night" value={`×${t.nightMultiplier} from ${t.nightStart} to ${t.nightEnd}`} />
        <Row label="Airport departure" value={tnd(t.airportSupplement)} />
        <Row label="Large luggage" value={`${tnd(t.luggageSupplement)} / item`} />
        <Row
          label="Switching speed"
          value={sw.verified ? `${(sw.mps * 3.6).toFixed(1)} km/h` : `Not verified (using ${(crossoverSpeedMps(t) * 3.6).toFixed(1)} km/h crossover)`}
        />
      </section>
      <section className="card">
        <h2>Source</h2>
        <p>{t.source ?? 'No source recorded.'}</p>
        <h2>How the estimate works</h2>
        <p>
          The phone records GPS positions. Noisy positions and impossible jumps are filtered out. When the taxi moves faster
          than the switching speed, distance is charged; when it is slower or stopped, time is charged, never both at once.
          Where data is missing, the app computes the cheapest and most expensive realistic case and shows a range.
        </p>
        <p>Night rate is applied to the part of the ride between {t.nightStart} and {t.nightEnd}.</p>
        <p>Everything stays on this device. No account, no server, no tracking.</p>
      </section>
      <Disclaimer />
    </main>
  );
}
