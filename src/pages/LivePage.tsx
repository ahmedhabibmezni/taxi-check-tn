import { useMessages } from '../localization';
import type { useLiveRide } from '../hooks/useLiveRide';
import type { TripRecord } from '../domain/trip/types';
import { Disclaimer, formatDuration, Header, km, range, Row, Warnings } from '../components/ui';
import { getTariff } from '../config/tariffs';
import { formatTnd } from '../utils/money';
import { Capacitor } from '@capacitor/core';

type Props = {
  live: ReturnType<typeof useLiveRide>;
  onEnd: (t: TripRecord) => void;
  onCancel: () => void;
};



export function LivePage({ live, onEnd, onCancel }: Props) {
  const en = useMessages();
  const GPS_TEXT = {
  waiting: en.live.waitingForGPSPositionDistanceMay,
  ok: en.live.receivingGPSFixesGPSReceptionDoes,
  denied: en.live.locationPermissionDeniedNoNewGPS,
  unavailable: en.live.locationUnavailableNoNewGPSFixes,
};
  const { ride, now, live: data } = live;
  if (!ride || !data) return null;
  const e = data.estimate;
  const distance = data.track.intervals.reduce((a, i) => a + i.distanceM, 0);
  const tariff = getTariff(ride.tariffId ?? e.tariffId);

  return (
    <main>
      <Header title={en.live.rideInProgress} />
      <section className="card center">
        <div className="big-label">{en.live.estimatedFare}</div>
        <div className="big num">~ {en.shared.money(formatTnd(e.best, 1))}</div>
        <div className="big-label">{en.live.expectedRange}</div>
        <div className="num">{range(e.low, e.high)}</div>
        <p className="notice small">{en.live.tariffNotOfficiallyVerified}</p>
        <p className="small muted">{en.live.thisRangeIsAnEstimateNot}</p>
        <Row label={en.live.duration} value={formatDuration((now - ride.startMs) / 1000)} />
        <Row label={en.live.distance} value={km(distance)} />
      </section>
      <p className={`gps gps-${ride.gpsStatus}`} role="status" aria-atomic="true">{GPS_TEXT[ride.gpsStatus]}</p>
      {live.storageError && <p className="error" role="alert">{en.live.theRideIsRecordingInMemory}</p>}
      <Warnings items={e.warnings.filter((w) => !w.startsWith('Estimate has limited') || ride.samples.length > 0)} />
      <button
        type="button"
        className="btn primary huge"
        onClick={() => {
          const t = live.end();
          if (t) onEnd(t);
        }}
      >
        {en.live.endRide}</button>
      <button
        type="button"
        className="btn link"
        onClick={() => {
          if (confirm(en.live.discardThisRideWithoutSaving)) onCancel();
        }}
      >
        {en.live.discardRide}</button>
      <p className="notice">{en.shared.tariffNotice(tariff ? tariff.notice : en.live.metadataIsUnavailableForTheRide)}</p>
      <p className="muted small">{Capacitor.isNativePlatform()
        ? en.live.routeRecordingUsesAnAndroidLocation
        : en.live.keepThisScreenOpenBrowsersPause}</p>
      <Disclaimer />
    </main>
  );
}
