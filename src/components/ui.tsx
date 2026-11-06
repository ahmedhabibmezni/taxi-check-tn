import { getMessages, useMessages } from '../localization';
import { LanguageSelector } from './LanguageSelector';
import { SharedLinkManager } from './HostedCard';
import { presentMessage } from '../localization/messages';
import { useEffect, useRef, type ReactNode } from 'react';
import { resolveTariff } from '../config/tariffs/status';
import type { Supplements } from '../domain/fare/types';
import { formatTnd } from '../utils/money';

export function Header({ title, onBack, focusKey }: { title: string; onBack?: () => void; focusKey?: string }) {
  const en = useMessages();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, [focusKey]);
  return (
    <>
    <div className="masthead">
      <span className="brand" dir="ltr"><img src="./icons/icon.svg" alt="" />Taxi Check TN</span>
      <LanguageSelector />
    </div>
    <SharedLinkManager />
    <header className="header">
      {onBack && (
        <button type="button" className="back" onClick={onBack} aria-label={en.shared.back}>
          ‹
        </button>
      )}
      <h1 ref={heading} tabIndex={-1}>{title}</h1>
    </header>
    </>
  );
}

export function TariffDetails({ tariffId }: { tariffId: string }) {
  const en = useMessages();
  const resolved = resolveTariff(tariffId);
  const tariff = resolved.status === 'valid' ? resolved.tariff : null;
  return (
    <section className="card" aria-label={en.shared.tariffVerification}>
      <h2>{en.shared.tariffVerification}</h2>
      <p className="notice">{en.shared.officialVerificationIsNotEstablishedFor}</p>
      <Row label={en.shared.recordedTariffID} value={tariffId} />
      {tariff ? <>
        <Row label={en.shared.tariff} value={tariff.name} />
        <Row label={en.shared.effectiveDate} value={tariff.effectiveFrom ?? en.shared.notConfirmed} />
        <Row label={en.shared.lastReviewed} value={tariff.lastReviewed ?? en.shared.unknown} />
        <p className="small muted">{en.shared.aReviewDateIsNotAn}</p>
        <p><strong>{en.shared.recordedSource}</strong> <bdi dir="auto">{tariff.source ?? en.shared.noSourceRecorded}</bdi></p>
        {tariff.notice && <p className="notice"><bdi dir="auto">{tariff.notice}</bdi></p>}
      </> : resolved.status === 'invalid' ? <p className="notice">{en.shared.recordedTariffConfigurationIsInvalidIt}</p> : <p className="notice">{en.shared.tariffMetadataIsUnavailableForThis}</p>}
    </section>
  );
}

export function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="row">
      <span className="muted">{label}</span>
      <span className="num"><bdi dir="auto">{value}</bdi></span>
    </div>
  );
}

export function Warnings({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <ul className="warnings">
      {items.map((w) => (
        <li key={w}><bdi dir="auto">{presentMessage(w)}</bdi></li>
      ))}
    </ul>
  );
}

export function Disclaimer() {
  const en = useMessages();
  return (
    <p className="disclaimer">
      {en.shared.independentEstimateBasedOnTheConfigured}</p>
  );
}

export const tnd = (m: number) => getMessages().shared.money(formatTnd(m));
export const range = (lo: number, hi: number) => getMessages().shared.range(formatTnd(lo), formatTnd(hi));

export function formatDuration(s: number): string {
  const total = Math.max(0, Math.round(s));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export const minutes = (s: number) => getMessages().shared.minutes(Math.round(s / 60));
export const km = (m: number) => getMessages().shared.kilometers((m / 1000).toFixed(1));

export function SupplementsInput({ value, onChange }: { value: Supplements; onChange: (s: Supplements) => void }) {
  const en = useMessages();
  return (
    <div className="card">
      <label className="check">
        <input
          type="checkbox"
          checked={value.airportDeparture}
          onChange={(e) => onChange({ ...value, airportDeparture: e.target.checked })}
        />
        {en.shared.departureFromTheAirport}</label>
      <div className="field">
        <span>{en.shared.largeLuggageItems}</span>
        <div className="stepper" role="group" aria-label={en.shared.largeLuggageItems}>
          <button type="button" onClick={() => onChange({ ...value, luggageItems: Math.max(0, value.luggageItems - 1) })} aria-label={en.shared.fewerLuggageItems}>−</button>
          <span className="num">{value.luggageItems}</span>
          <button type="button" onClick={() => onChange({ ...value, luggageItems: Math.min(10, value.luggageItems + 1) })} aria-label={en.shared.moreLuggageItems}>+</button>
        </div>
      </div>
    </div>
  );
}
