import type { useLiveRide } from '../hooks/useLiveRide';
import type { TripRecord } from '../domain/trip/types';
import { Disclaimer, formatDuration, Header, km, range, Warnings } from '../components/ui';
import { formatTnd } from '../utils/money';

type Props = {
  live: ReturnType<typeof useLiveRide>;
  onEnd: (t: TripRecord) => void;
  onCancel: () => void;
};

const GPS_TEXT = {
  waiting: 'Waiting for GPS position…',
  ok: 'GPS active',
  denied: 'Location permission denied. The estimate uses time only; use the manual calculator afterwards.',
  unavailable: 'GPS signal unavailable, still recording time.',
};

export function LivePage({ live, onEnd, onCancel }: Props) {
  const { ride, now, live: data } = live;
  if (!ride || !data) return null;
  const e = data.estimate;
  const distance = data.track.intervals.reduce((a, i) => a + i.distanceM, 0);

  return (
    <main>
      <Header title="Ride in progress" />
      <div className="timer num">{formatDuration((now - ride.startMs) / 1000)}</div>
      <p className={`gps gps-${ride.gpsStatus}`}>{GPS_TEXT[ride.gpsStatus]}</p>
      <section className="card center">
        <div className="big-label">Distance</div>
        <div className="big num">{km(distance)}</div>
        <div className="big-label">Estimated fare</div>
        <div className="big num">~ {formatTnd(e.best, 1)} TND</div>
        <div className="big-label">Expected range</div>
        <div className="num">{range(e.low, e.high)}</div>
      </section>
      <Warnings items={e.warnings.filter((w) => !w.startsWith('Estimate has limited') || ride.samples.length > 0)} />
      <p className="muted small">Keep this screen open: browsers pause GPS when the screen is off.</p>
      <button
        type="button"
        className="btn primary huge"
        onClick={() => {
          const t = live.end();
          if (t) onEnd(t);
        }}
      >
        END RIDE
      </button>
      <button
        type="button"
        className="btn link"
        onClick={() => {
          if (confirm('Discard this ride without saving?')) onCancel();
        }}
      >
        Discard ride
      </button>
      <Disclaimer />
    </main>
  );
}
